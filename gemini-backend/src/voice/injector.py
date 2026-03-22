"""Audio injector — sends base64 MP3 audio to zoom-gateway over HTTP."""

from __future__ import annotations

import asyncio
import logging

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


async def inject_audio(session_id: str, b64_mp3: str) -> None:
    """Send base64 MP3 audio to zoom-gateway for Recall.ai playback."""
    if not b64_mp3:
        return

    gateway_url = settings.zoom_gateway_url.rstrip("/")
    url = f"{gateway_url}/sessions/{session_id}/audio-out"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                url,
                json={"b64_mp3": b64_mp3},
                headers={"x-internal-token": settings.internal_service_token},
            )

        if resp.status_code >= 400:
            logger.error(
                "audio-out injection failed session_id=%s status=%s body=%s",
                session_id,
                resp.status_code,
                resp.text[:300],
            )
            return

        logger.info("audio-out injected session_id=%s", session_id)

    except Exception as exc:
        logger.error("audio-out injection failed session_id=%s: %s", session_id, exc)


async def inject_text(session_id: str, text: str) -> None:
    """Convert text to MP3 audio and inject into the meeting."""
    if not text.strip():
        return

    from .tts import text_to_speech_mp3_b64

    try:
        b64_mp3 = await asyncio.get_event_loop().run_in_executor(
            None, text_to_speech_mp3_b64, text
        )
    except Exception as exc:
        logger.error("TTS failed session_id=%s: %s", session_id, exc)
        return

    await inject_audio(session_id, b64_mp3)
