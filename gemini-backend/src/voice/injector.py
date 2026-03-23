"""Audio injector — sends base64 MP3 audio to zoom-gateway over HTTP."""

from __future__ import annotations

import asyncio
import logging

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

SCREENSHARE_MARKER = "[START_SCREENSHARE]"
_screenshare_started: set[str] = set()


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


async def start_screenshare(session_id: str) -> None:
    """Tell zoom-gateway/Recall.ai to start screensharing for this session."""
    gateway_url = settings.zoom_gateway_url.rstrip("/")
    url = f"{gateway_url}/sessions/{session_id}/screenshare-start"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                url,
                headers={"x-internal-token": settings.internal_service_token},
            )

        if resp.status_code >= 400:
            logger.error(
                "screenshare-start failed session_id=%s status=%s body=%s",
                session_id,
                resp.status_code,
                resp.text[:300],
            )
            return

        _screenshare_started.add(session_id)
        logger.info("screenshare-start accepted session_id=%s", session_id)

    except Exception as exc:
        logger.error("screenshare-start failed session_id=%s: %s", session_id, exc)


async def inject_text(session_id: str, text: str, provider_voice_id: str | None = None) -> None:
    """Convert text to MP3 audio and inject into the meeting."""
    cleaned_text = text.strip()
    if not cleaned_text:
        return

    wants_screenshare = SCREENSHARE_MARKER in cleaned_text
    if wants_screenshare:
        cleaned_text = cleaned_text.replace(SCREENSHARE_MARKER, "").strip()
        if session_id not in _screenshare_started:
            await start_screenshare(session_id)

    if not cleaned_text:
        return

    from .tts import text_to_speech_mp3_b64

    try:
        b64_mp3 = await asyncio.get_event_loop().run_in_executor(
            None, text_to_speech_mp3_b64, cleaned_text, provider_voice_id
        )
    except Exception as exc:
        logger.error("TTS failed session_id=%s: %s", session_id, exc)
        return

    await inject_audio(session_id, b64_mp3)
