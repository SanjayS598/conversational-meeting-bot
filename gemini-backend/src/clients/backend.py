"""
HTTP client for the Control Backend (ui-auth Next.js) API.

All events are pushed via POST /api/internal/events:
  { "type": "<event_type>", "payload": { ... } }

Protected by the INTERNAL_SERVICE_TOKEN Bearer header.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

from ..schemas.session import AgentResponse, MeetingState, TranscriptSegment

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 10.0  # seconds
EVENTS_PATH = "/api/internal/events"


class BackendClientError(Exception):
    """Raised when the Control Backend returns a non-2xx response."""


class BackendClient:
    """Async HTTP client for the Control Backend (ui-auth Next.js)."""

    def __init__(self, base_url: str, service_token: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {service_token}",
            "Content-Type": "application/json",
        }
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=DEFAULT_TIMEOUT,
        )

    async def save_transcript_segment(self, seg: TranscriptSegment) -> None:
        """Push a TranscriptSegment to the Control Backend events endpoint."""
        await self._emit(
            event_type="transcript.segment",
            payload={
                "session_id": seg.session_id,
                "speaker": seg.speaker_label,
                "text": seg.text,
                "start_ms": seg.start_ms,
                "end_ms": seg.end_ms,
                "confidence": seg.confidence,
            },
        )

    async def save_meeting_state(self, state: MeetingState) -> None:
        """Push the current MeetingState to the Control Backend events endpoint."""
        parts: list[str] = []
        if state.current_topic:
            parts.append(state.current_topic)
        if state.decisions:
            parts.append("Decisions:\n" + "\n".join(f"- {d}" for d in state.decisions))
        summary = "\n\n".join(parts)

        await self._emit(
            event_type="notes.update",
            payload={
                "session_id": state.session_id,
                "summary": summary,
                "decisions_json": state.decisions,
                "questions_json": state.open_questions,
            },
        )

        for item in state.action_items:
            await self._emit(
                event_type="action_item.create",
                payload={
                    "session_id": state.session_id,
                    "owner": item.owner,
                    "description": item.description,
                    "due_date": item.due_hint,
                },
            )

    async def notify_response_ready(
        self, session_id: str, response: AgentResponse
    ) -> None:
        """Notify the Control Backend that a response candidate is ready."""
        await self._emit(
            event_type="agent.event",
            payload={
                "session_id": session_id,
                "event_type": "response.ready",
                "payload_json": {
                    "text": response.text,
                    "reason": response.reason,
                    "priority": response.priority,
                    "requires_approval": response.requires_approval,
                    "confidence": response.confidence,
                },
            },
        )

    async def aclose(self) -> None:
        """Close the underlying HTTP client. Call during app shutdown."""
        await self._client.aclose()

    # ── Private ───────────────────────────────────────────────────────────────

    async def _emit(self, event_type: str, payload: dict) -> None:
        """POST a typed event to the Control Backend internal events endpoint."""
        try:
            response = await self._client.post(
                EVENTS_PATH,
                json={"type": event_type, "payload": payload},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Backend event '%s' failed status=%d: %s",
                event_type,
                exc.response.status_code,
                exc,
            )
            raise BackendClientError(str(exc)) from exc
        except httpx.RequestError as exc:
            logger.error("Backend event '%s' network error: %s", event_type, exc)
            raise BackendClientError(f"Network error: {exc}") from exc
