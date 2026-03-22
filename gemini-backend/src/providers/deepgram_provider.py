"""
Deepgram Nova-2 streaming STT provider.

Replaces Whisper batch processing with a real-time WebSocket stream to Deepgram.
Segments are finalized at speech pauses (~300 ms silence) giving near-instant
transcript updates instead of waiting 10+ seconds for a buffer to fill.

Audio format requirements (identical to the rest of the pipeline):
    - 16-bit PCM, 16 kHz, mono (LINEAR16)

State updates and meeting summary continue to use Gemini 2.5 Flash.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from .gemini import GeminiProvider
from .interface import (
    AIProvider,
    AudioChunk,
    DeltaCallback,
    StateUpdatePayload,
    StateUpdateResult,
    SummaryPayload,
    SummaryResult,
    TranscriptDelta,
)

logger = logging.getLogger(__name__)

# Deepgram streaming endpoint configuration:
#   model=nova-2       — state-of-the-art accuracy / speed balance
#   endpointing=120    — finalize smaller chunks quickly for lower transcript latency
#   smart_format=true  — adds punctuation & capitalisation automatically
#   interim_results=true — let Deepgram emit frequent is_final chunks during speech
#   filler_words=false — strip "um", "uh", etc. from results
_DG_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-2"
    "&language=en"
    "&encoding=linear16"
    "&sample_rate=16000"
    "&channels=1"
    "&interim_results=true"
    "&endpointing=120"
    "&smart_format=true"
    "&filler_words=false"
)


class DeepgramProvider(AIProvider):
    """
    Real-time streaming STT via Deepgram Nova-2.

    Each finalized chunk from Deepgram is emitted immediately as a
    is_final=True TranscriptDelta. This keeps transcript latency low without
    depending on Zoom captions or large local audio buffers.

    Gemini 2.5 Flash is still used for meeting state updates and end-of-meeting
    summary generation (delegated to an embedded GeminiProvider).
    """

    def __init__(
        self,
        deepgram_api_key: str,
        gemini_api_key: str,
        openai_api_key: str = "",
        whisper_model: str = "whisper-1",
    ) -> None:
        self._dg_key = deepgram_api_key
        # Delegate state/summary calls to the existing Gemini provider.
        # The inner GeminiProvider is never used for audio — only for its
        # update_state_and_maybe_respond / generate_meeting_summary methods.
        self._gemini = GeminiProvider(
            api_key=gemini_api_key,
            openai_api_key=openai_api_key,
            whisper_model=whisper_model,
        )
        # handle → { session_id, ws, reader_task, on_delta }
        self._sessions: dict[str, dict] = {}

    # ── AIProvider interface ──────────────────────────────────────────────────

    async def start_live_session(self, session_id: str, config: dict) -> str:
        """Open a Deepgram streaming WebSocket for this meeting session."""
        import websockets  # lazy import — only needed when Deepgram is active

        handle = str(uuid.uuid4())

        try:
            ws = await websockets.connect(
                _DG_URL,
                additional_headers=[("Authorization", f"Token {self._dg_key}")],
                open_timeout=10,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Failed to connect to Deepgram: {exc}"
            ) from exc

        info: dict = {
            "session_id": session_id,
            "ws": ws,
            "on_delta": None,
            "reader_task": None,
        }
        self._sessions[handle] = info

        # Background task reads Deepgram responses and routes them to on_delta.
        task = asyncio.create_task(
            self._reader(handle, info),
            name=f"deepgram-reader-{handle[:8]}",
        )
        info["reader_task"] = task

        logger.info(
            "Deepgram streaming session started handle=%s session_id=%s",
            handle,
            session_id,
        )
        return handle

    async def send_audio_chunk(
        self,
        handle: str,
        chunk: AudioChunk,
        on_delta: DeltaCallback,
    ) -> None:
        """Forward a raw PCM chunk to Deepgram.  No buffering — sent immediately."""
        info = self._sessions.get(handle)
        if info is None:
            return

        # Register on_delta from the first chunk (same callback for entire session).
        if info["on_delta"] is None:
            info["on_delta"] = on_delta

        ws = info["ws"]
        try:
            await ws.send(chunk.data)
        except Exception as exc:
            logger.warning("Deepgram send error handle=%s: %s", handle, exc)

    async def end_live_session(
        self, handle: str, on_delta: DeltaCallback | None = None
    ) -> None:
        """
        Gracefully close the Deepgram WebSocket.

        Sending {"type":"CloseStream"} tells Deepgram to flush remaining audio
        and emit any final speech_final result before closing the connection.
        """
        info = self._sessions.get(handle)
        if info is None:
            return

        # Use the provided callback so any final utterance reaches audio_processor.
        if on_delta is not None:
            info["on_delta"] = on_delta

        ws = info["ws"]

        # Request Deepgram to flush remaining audio
        try:
            await ws.send(json.dumps({"type": "CloseStream"}))
        except Exception:
            pass

        # Wait for the reader to drain the remaining results (up to 5 s)
        task: asyncio.Task | None = info.get("reader_task")
        if task and not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

        try:
            await ws.close()
        except Exception:
            pass

        self._sessions.pop(handle, None)
        logger.info("Deepgram streaming session ended handle=%s", handle)

    # ── Gemini delegation ─────────────────────────────────────────────────────

    async def update_state_and_maybe_respond(
        self, payload: StateUpdatePayload
    ) -> StateUpdateResult:
        return await self._gemini.update_state_and_maybe_respond(payload)

    async def generate_meeting_summary(self, payload: SummaryPayload) -> SummaryResult:
        return await self._gemini.generate_meeting_summary(payload)

    # ── Private ───────────────────────────────────────────────────────────────

    async def _reader(self, handle: str, info: dict) -> None:
        """
        Background task: reads Deepgram JSON responses and calls on_delta
        whenever Deepgram finalizes a chunk.
        """
        import websockets.exceptions as ws_exc  # lazy import

        ws = info["ws"]
        session_id = info["session_id"]

        try:
            msg_count = 0
            async for raw in ws:
                if not isinstance(raw, (str, bytes)):
                    continue
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    continue

                msg_count += 1
                msg_type = msg.get("type", "?")
                if msg_count <= 5 or msg_count % 50 == 0:
                    # Log first few + periodic messages to confirm Deepgram is responding
                    logger.info(
                        "Deepgram msg #%d type=%s is_final=%s speech_final=%s handle=%s",
                        msg_count, msg_type,
                        msg.get("is_final"), msg.get("speech_final"),
                        handle[:8],
                    )

                if msg_type != "Results":
                    continue

                # Log ANY non-empty interim result so we can confirm speech detection
                _interim_text = ((msg.get("channel") or {}).get("alternatives") or [{}])[0].get("transcript", "").strip()
                if _interim_text and not msg.get("is_final") and not msg.get("speech_final"):
                    logger.info(
                        "Deepgram interim text=%r handle=%s",
                        _interim_text[:80], handle[:8],
                    )

                if not (msg.get("is_final") or msg.get("speech_final")):
                    continue

                alternatives = (msg.get("channel") or {}).get("alternatives") or []
                if not alternatives:
                    continue

                best = alternatives[0]
                text = (best.get("transcript") or "").strip()
                logger.info(
                    "Deepgram is_final text=%r confidence=%.2f handle=%s on_delta_set=%s",
                    text[:80] if text else "(empty)",
                    best.get("confidence", 0.0),
                    handle[:8],
                    info.get("on_delta") is not None,
                )
                if not text:
                    continue

                start_s: float = msg.get("start", 0.0)
                duration_s: float = msg.get("duration", 0.0)
                confidence: float = best.get("confidence", 0.9)

                delta = TranscriptDelta(
                    text=text,
                    speaker_label="Participant",
                    start_ms=int(start_s * 1000),
                    end_ms=int((start_s + duration_s) * 1000),
                    confidence=min(max(confidence, 0.0), 1.0),
                    is_final=True,
                )

                on_delta = info.get("on_delta")
                if on_delta:
                    try:
                        await on_delta(delta)
                    except Exception as exc:
                        logger.warning(
                            "on_delta callback raised handle=%s: %s", handle, exc
                        )
                else:
                    logger.debug(
                        "Deepgram result ready but no callback registered handle=%s text=%r",
                        handle,
                        text[:60],
                    )

        except ws_exc.ConnectionClosed:
            logger.info(
                "Deepgram WS closed (normal) handle=%s session_id=%s", handle, session_id
            )
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning(
                "Deepgram reader error handle=%s session_id=%s: %s",
                handle,
                session_id,
                exc,
            )
