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

from ..schemas.session import AgentResponse, MeetingState, MeetingSummary, TranscriptSegment

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 10.0  # seconds
EVENTS_PATH = "/api/internal/events"


def _format_summary_markdown(summary: MeetingSummary) -> str:
    lines: list[str] = [f"# {summary.title}"]

    if summary.executive_summary:
        lines.extend(["", "## Executive Summary", summary.executive_summary])
    if summary.key_decisions:
        lines.extend(["", "## Key Decisions", *[f"- {item}" for item in summary.key_decisions]])
    if summary.action_items:
        lines.append("")
        lines.append("## Action Items")
        for item in summary.action_items:
            owner = f" ({item.owner})" if item.owner else ""
            due = f" - due {item.due_hint}" if item.due_hint else ""
            lines.append(f"- {item.description}{owner}{due}")
    if summary.open_questions:
        lines.extend(["", "## Open Questions", *[f"- {item}" for item in summary.open_questions]])
    if summary.next_steps:
        lines.extend(["", "## Next Steps", *[f"- {item}" for item in summary.next_steps]])
    if summary.topics_discussed:
        lines.append("")
        lines.append("## Topics Discussed")
        for t in summary.topics_discussed:
            topic = t.get("topic", "") if isinstance(t, dict) else str(t)
            detail = t.get("summary", "") if isinstance(t, dict) else ""
            lines.append(f"### {topic}")
            if detail:
                lines.append(detail)
    if summary.notable_quotes:
        lines.extend(["", "## Notable Quotes", *[f'> "{q}"' for q in summary.notable_quotes]])

    return "\n".join(lines).strip()


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

    async def save_meeting_state(self, state: MeetingState, recent_transcript: str = "") -> None:
        """Push the current MeetingState to the Control Backend events endpoint."""
        lines: list[str] = []
        if state.current_topic:
            lines.extend(["## Current Topic", state.current_topic, ""])
        if state.decisions:
            lines.extend(["## Decisions", *[f"- {d}" for d in state.decisions], ""])
        if state.open_questions:
            lines.extend(["## Open Questions", *[f"- {q}" for q in state.open_questions], ""])
        if state.action_items:
            lines.append("## Action Items")
            for item in state.action_items:
                owner = f" ({item.owner})" if item.owner else ""
                lines.append(f"- {item.description}{owner}")
            lines.append("")
        if recent_transcript:
            lines.extend(["## Recent Discussion", recent_transcript])
        summary = "\n".join(lines).strip()

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

    async def push_summary(self, summary: MeetingSummary) -> None:
        """Push a generated meeting summary to the Control Backend."""
        await self._emit(
            event_type="notes.update",
            payload={
                "session_id": summary.session_id,
                "summary": _format_summary_markdown(summary),
                "decisions_json": summary.key_decisions,
                "questions_json": summary.open_questions,
            },
        )

        await self._emit(
            event_type="agent.event",
            payload={
                "session_id": summary.session_id,
                "event_type": "summary.generated",
                "payload_json": summary.model_dump(mode="json"),
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
