"""
Audio injector — sends PCM audio bytes to the zoom-gateway audio-out WebSocket.

The zoom-gateway expects raw int16 PCM, 16 kHz, mono (little-endian).
ElevenLabs with output_format=pcm_16000 produces exactly this format.
"""

from __future__ import annotations

import asyncio
import logging

import websockets

from ..config import settings

logger = logging.getLogger(__name__)


async def inject_audio(session_id: str, pcm_bytes: bytes) -> None:
    """Send *pcm_bytes* to the zoom-gateway audio-out WebSocket for *session_id*.

    Uses the internal service token for authentication.
    This is a fire-and-forget call; errors are logged but not re-raised so that
    a TTS failure never crashes the conversational pipeline.
    """
    if not pcm_bytes:
        return

    # zoom-gateway runs on port 3001 (same host as gemini-backend in development)
    gateway_url = settings.zoom_gateway_url.rstrip("/")
    ws_url = (
        gateway_url.replace("http://", "ws://").replace("https://", "wss://")
        + f"/sessions/{session_id}/audio-out"
        + f"?token={settings.internal_service_token}"
    )

    try:
        async with websockets.connect(  # type: ignore[attr-defined]
            ws_url,
            ping_interval=None,
            ping_timeout=None,
            open_timeout=10,
        ) as ws:
            # Wait for the 'connected' text frame from the gateway
            connected_msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            logger.debug(
                "audio-out connected session_id=%s msg=%s", session_id, connected_msg
            )

            # Send all PCM bytes in one frame (gateway handles chunking internally)
            await ws.send(pcm_bytes)
            logger.info(
                "audio-out injected session_id=%s bytes=%d", session_id, len(pcm_bytes)
            )

    except Exception as exc:
        logger.error(
            "audio-out injection failed session_id=%s: %s", session_id, exc
        )


async def inject_text(session_id: str, text: str) -> None:
    """Convert *text* to PCM audio and inject into the meeting.

    Convenience wrapper: TTS + inject in one call.
    """
    if not text.strip():
        return

    from .tts import text_to_speech_pcm

    try:
        pcm = await asyncio.get_event_loop().run_in_executor(
            None, text_to_speech_pcm, text
        )
    except Exception as exc:
        logger.error("TTS failed session_id=%s: %s", session_id, exc)
        return

    await inject_audio(session_id, pcm)
