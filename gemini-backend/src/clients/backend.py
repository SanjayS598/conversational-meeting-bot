"""
HTTP client for the Control Backend API.

Calls the Control Backend to:
  - Persist transcript segments
  - Persist meeting state snapshots
  - Read user session config
  - Notify when a response candidate is ready

All calls use the internal service token from env (Bearer auth).
Uses httpx async client for all requests.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

from ..schemas.session import AgentResponse, MeetingState, SessionConfig, TranscriptSegment

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 10.0  # seconds


class BackendClientError(Exception):
    """Raised when the Control Backend returns a non-2xx response."""


class BackendClient:
    """Async HTTP client for the Control Backend."""

    def __init__(self, base_url: str, service_token: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {service_token}",
            "Content-Type": "application/json",
        }
        # Shared async client — caller must call aclose() on shutdown
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=DEFAULT_TIMEOUT,
        )

    async def save_transcript_segment(self, seg: TranscriptSegment) -> None:
        """POST a TranscriptSegment to the Control Backend."""
        await self._post(
            f"/sessions/{seg.session_id}/transcript",
            data=seg.model_dump(),
        )

    async def save_meeting_state(self, state: MeetingState) -> None:
        """POST the current MeetingState snapshot to the Control Backend."""
        await self._post(
            f"/sessions/{state.session_id}/state",
            data=state.model_dump(),
        )

    async def get_user_config(self, user_id: str) -> Optional[SessionConfig]:
        """
        GET user session configuration from the Control Backend.
        Returns None if the user is not found.
        """
        try:
            response = await self._client.get(f"/users/{user_id}/config")
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return SessionConfig.model_validate(response.json())
        except httpx.HTTPStatusError as exc:
            logger.error("get_user_config failed user_id=%s: %s", user_id, exc)
            raise BackendClientError(str(exc)) from exc
        except httpx.RequestError as exc:
            logger.error("get_user_config network error user_id=%s: %s", user_id, exc)
            raise BackendClientError(f"Network error: {exc}") from exc

    async def notify_response_ready(
        self, session_id: str, response: AgentResponse
    ) -> None:
        """
        POST a notification to the Control Backend when a response candidate is ready.
        The backend will forward this to the Voice Runtime if auto_speak is enabled.
        """
        await self._post(
            f"/sessions/{session_id}/response-ready",
            data=response.model_dump(),
        )

    async def aclose(self) -> None:
        """Close the underlying HTTP client. Call during app shutdown."""
        await self._client.aclose()

    # ── Private ───────────────────────────────────────────────────────────────

    async def _post(self, path: str, data: dict) -> dict:
        try:
            response = await self._client.post(path, json=data)
            response.raise_for_status()
            return response.json() if response.content else {}
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Backend POST %s failed status=%d: %s",
                path,
                exc.response.status_code,
                exc,
            )
            raise BackendClientError(str(exc)) from exc
        except httpx.RequestError as exc:
            logger.error("Backend POST %s network error: %s", path, exc)
            raise BackendClientError(f"Network error: {exc}") from exc
