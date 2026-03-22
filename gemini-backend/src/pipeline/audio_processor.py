"""
Audio processor — hot path for real-time audio ingestion.

Receives raw PCM audio chunks from the Meeting Gateway WebSocket,
forwards them to the Gemini Live session, and accumulates TranscriptDelta
objects into finalized TranscriptSegment objects.

Audio format requirements (from Meeting Gateway):
  - 16-bit PCM, 16 kHz, mono (LINEAR16)
  - Chunks should be ~100ms (1600 bytes each)
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Awaitable, Callable, Optional

from ..providers.interface import AIProvider, AudioChunk, TranscriptDelta
from ..schemas.session import SessionConfig, TranscriptSegment
from ..sessions.manager import SessionManager

logger = logging.getLogger(__name__)

# Max gap between deltas before we forcibly finalize the pending buffer (ms)
FINALIZATION_GAP_MS = 2000
# Exponential backoff for live session reconnection
MAX_RECONNECT_ATTEMPTS = 5


SegmentCallback = Callable[[TranscriptSegment], Awaitable[None]]


class AudioProcessor:
    """
    Hot path for meeting audio ingestion.

    Lifecycle:
        await processor.start(session_id, config)   # open Gemini Live session
        await processor.ingest(session_id, chunk)   # for each audio chunk
        await processor.stop(session_id)            # close Gemini Live session
    """

    def __init__(
        self,
        provider: AIProvider,
        session_manager: SessionManager,
        on_segment_ready: SegmentCallback,
    ) -> None:
        self._provider = provider
        self._session_manager = session_manager
        self._on_segment_ready = on_segment_ready

        # Maps session_id → live provider handle
        self._handles: dict[str, str] = {}
        # Maps session_id → accumulated unfinalized deltas
        self._pending_deltas: dict[str, list[TranscriptDelta]] = {}
        # Maps session_id → timestamp (ms) of last received delta
        self._last_delta_at: dict[str, int] = {}

    async def start(self, session_id: str, config: SessionConfig) -> None:
        """
        Open a Gemini Live session for this meeting session.
        Implements exponential backoff on connection failure.
        """
        for attempt in range(1, MAX_RECONNECT_ATTEMPTS + 1):
            try:
                handle = await self._provider.start_live_session(
                    session_id, config.model_dump()
                )
                self._handles[session_id] = handle
                self._pending_deltas[session_id] = []
                self._last_delta_at[session_id] = 0
                logger.info(
                    "AudioProcessor started session_id=%s handle=%s", session_id, handle
                )
                return
            except Exception as exc:
                wait = 2**attempt
                logger.warning(
                    "Failed to start live session attempt=%d/%d session_id=%s: %s — retrying in %ds",
                    attempt,
                    MAX_RECONNECT_ATTEMPTS,
                    session_id,
                    exc,
                    wait,
                )
                if attempt == MAX_RECONNECT_ATTEMPTS:
                    raise RuntimeError(
                        f"Could not start Gemini Live session after {MAX_RECONNECT_ATTEMPTS} attempts"
                    ) from exc
                await asyncio.sleep(wait)

    async def ingest(self, session_id: str, chunk: AudioChunk) -> None:
        """
        Process a single audio chunk.

        Forwards the chunk to Gemini Live and handles any transcript deltas.
        Auto-finalizes the pending buffer if the gap exceeds FINALIZATION_GAP_MS.
        """
        handle = self._handles.get(session_id)
        if handle is None:
            logger.warning("ingest called on unknown session_id=%s", session_id)
            return

        # Check if we need to force-finalize a stale buffer
        last_at = self._last_delta_at.get(session_id, 0)
        if last_at > 0:
            gap_ms = int(time.time() * 1000) - last_at
            if gap_ms > FINALIZATION_GAP_MS and self._pending_deltas.get(session_id):
                logger.debug(
                    "Force-finalizing stale buffer session_id=%s gap_ms=%d",
                    session_id,
                    gap_ms,
                )
                await self._finalize_pending(session_id)

        async def on_delta(delta: TranscriptDelta) -> None:
            await self._handle_delta(session_id, delta)

        try:
            await self._provider.send_audio_chunk(handle, chunk, on_delta)
        except Exception as exc:
            logger.error(
                "Audio chunk send failed session_id=%s: %s", session_id, exc
            )
            # Don't propagate — best effort; next chunk may succeed

    async def stop(self, session_id: str) -> None:
        """Close the Gemini Live session and finalize any remaining buffer."""
        # Finalize any pending deltas accumulated so far
        if self._pending_deltas.get(session_id):
            await self._finalize_pending(session_id)

        handle = self._handles.pop(session_id, None)

        if handle:
            # Pass on_delta so end_live_session can flush the PCM buffer and
            # emit any final transcript segment (avoids losing the last ~10s of audio).
            async def on_delta(delta: TranscriptDelta) -> None:
                await self._handle_delta(session_id, delta)

            try:
                await self._provider.end_live_session(handle, on_delta)
            except Exception as exc:
                logger.warning(
                    "Error stopping live session session_id=%s: %s", session_id, exc
                )

        # Clean up after the flush so any segment emitted above is already sent
        self._pending_deltas.pop(session_id, None)
        self._last_delta_at.pop(session_id, None)

        logger.info("AudioProcessor stopped session_id=%s", session_id)

    # ── Private ───────────────────────────────────────────────────────────────

    async def _handle_delta(self, session_id: str, delta: TranscriptDelta) -> None:
        """Accumulate a delta and finalize if it's marked as final."""
        self._last_delta_at[session_id] = int(time.time() * 1000)
        pending = self._pending_deltas.setdefault(session_id, [])
        pending.append(delta)

        if delta.is_final:
            await self._finalize_pending(session_id)

    async def _finalize_pending(self, session_id: str) -> None:
        """
        Flush pending deltas into a single TranscriptSegment and emit it.

        Groups all buffered deltas into one segment, validates the schema,
        then calls on_segment_ready.
        """
        deltas = self._pending_deltas.get(session_id, [])
        if not deltas:
            return

        # Clear immediately to avoid double-finalization
        self._pending_deltas[session_id] = []

        combined_text = " ".join(d.text for d in deltas).strip()
        if not combined_text:
            return

        # Average confidence across all deltas
        avg_confidence = sum(d.confidence for d in deltas) / len(deltas)
        speaker_label = deltas[0].speaker_label  # use first delta's speaker

        try:
            segment = TranscriptSegment(
                segment_id=str(uuid.uuid4()),
                session_id=session_id,
                speaker_label=speaker_label,
                start_ms=deltas[0].start_ms,
                end_ms=deltas[-1].end_ms,
                text=combined_text,
                confidence=round(avg_confidence, 4),
            )
            await self._on_segment_ready(segment)
        except Exception as exc:
            logger.error(
                "Failed to finalize transcript segment session_id=%s: %s",
                session_id,
                exc,
            )
