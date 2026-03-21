"""
Voice Runtime client.

Sends AgentResponse.text to the ElevenLabs Voice Runtime service to be spoken.
Called only from the /brain/sessions/:id/respond endpoint after approval.
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 10.0


class VoiceClientError(Exception):
    """Raised when the Voice Runtime returns an error."""


class VoiceClient:
    """Async HTTP client for the Voice Runtime (ElevenLabs TTS service)."""

    def __init__(self, base_url: str, service_token: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={
                "Authorization": f"Bearer {service_token}",
                "Content-Type": "application/json",
            },
            timeout=DEFAULT_TIMEOUT,
        )

    async def speak(
        self,
        session_id: str,
        text: str,
        max_speak_seconds: float = 15.0,
    ) -> None:
        """
        POST text to the Voice Runtime to be spoken aloud in the meeting.

        The Voice Runtime handles TTS generation and audio playback scheduling.
        """
        try:
            response = await self._client.post(
                "/voice/speak",
                json={
                    "session_id": session_id,
                    "text": text,
                    "max_speak_seconds": max_speak_seconds,
                },
            )
            response.raise_for_status()
            logger.info(
                "Voice speak dispatched session_id=%s chars=%d", session_id, len(text)
            )
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Voice speak failed session_id=%s status=%d: %s",
                session_id,
                exc.response.status_code,
                exc,
            )
            raise VoiceClientError(str(exc)) from exc
        except httpx.RequestError as exc:
            logger.error(
                "Voice speak network error session_id=%s: %s", session_id, exc
            )
            raise VoiceClientError(f"Network error: {exc}") from exc

    async def aclose(self) -> None:
        await self._client.aclose()
