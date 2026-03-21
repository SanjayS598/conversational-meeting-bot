"""
Redis-backed session manager.

All session state is stored under key `brain:session:{session_id}` with a
4-hour TTL. Session data is JSON-serialized Pydantic models.

Raises:
    SessionNotFoundError: When a session does not exist in Redis.
    redis.RedisError: Propagated on Redis I/O failures (fail fast).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Optional

import redis.asyncio as aioredis

from ..schemas.session import (
    AgentResponse,
    MeetingState,
    SessionConfig,
    SessionState,
    SessionStatus,
    TranscriptSegment,
)

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 4 * 60 * 60  # 4 hours
KEY_PREFIX = "brain:session:"


class SessionNotFoundError(Exception):
    """Raised when a session does not exist in Redis."""

    def __init__(self, session_id: str) -> None:
        super().__init__(f"Session not found: {session_id}")
        self.session_id = session_id


def _session_key(session_id: str) -> str:
    return f"{KEY_PREFIX}{session_id}"


class SessionManager:
    """
    Manages meeting session lifecycle backed by Redis.

    All reads validate with Pydantic schemas.
    All writes use JSON serialization.
    """

    def __init__(self, redis_client: aioredis.Redis) -> None:
        self._redis = redis_client

    async def create(self, config: SessionConfig) -> SessionState:
        """Create a new session and persist to Redis."""
        meeting = MeetingState(
            session_id=config.session_id,
            current_topic=config.meeting_objective,  # pre-seed topic so UI notes pane activates
        )
        state = SessionState(
            config=config,
            meeting=meeting,
            transcript=[],
            pending_response=None,
            started_at=int(time.time() * 1000),
            status=SessionStatus.active,
        )
        await self._save(state)
        logger.info("Created session session_id=%s", config.session_id)
        return state

    async def get(self, session_id: str) -> Optional[SessionState]:
        """Retrieve a session from Redis. Returns None if not found."""
        raw = await self._redis.get(_session_key(session_id))
        if raw is None:
            return None
        try:
            data = json.loads(raw)
            return SessionState.model_validate(data)
        except Exception as exc:
            logger.error("Failed to deserialize session session_id=%s: %s", session_id, exc)
            return None

    async def get_or_raise(self, session_id: str) -> SessionState:
        """Retrieve a session or raise SessionNotFoundError."""
        state = await self.get(session_id)
        if state is None:
            raise SessionNotFoundError(session_id)
        return state

    async def update(self, session_id: str, **kwargs) -> SessionState:
        """
        Apply a partial update to a session and persist.

        Keyword args can be any top-level SessionState fields
        (config, meeting, pending_response, status, etc.)
        """
        state = await self.get_or_raise(session_id)
        updated = state.model_copy(update=kwargs)
        await self._save(updated)
        return updated

    async def end(self, session_id: str) -> None:
        """Mark a session as ended."""
        await self.update(session_id, status=SessionStatus.ended)
        logger.info("Ended session session_id=%s", session_id)

    async def append_transcript_segment(
        self, session_id: str, seg: TranscriptSegment
    ) -> None:
        """Append a TranscriptSegment to the session's transcript list."""
        state = await self.get_or_raise(session_id)
        updated_transcript = state.transcript + [seg]
        await self.update(session_id, transcript=updated_transcript)

    async def set_pending_response(
        self, session_id: str, response: Optional[AgentResponse]
    ) -> None:
        """Set or clear the pending AgentResponse for a session."""
        await self.update(session_id, pending_response=response)

    async def update_meeting_state(
        self, session_id: str, meeting: MeetingState
    ) -> None:
        """Replace the full MeetingState for a session."""
        await self.update(session_id, meeting=meeting)

    # ── Private ───────────────────────────────────────────────────────────────

    async def _save(self, state: SessionState) -> None:
        """Serialize and persist the full SessionState to Redis with TTL."""
        key = _session_key(state.config.session_id)
        data = state.model_dump_json()
        await self._redis.setex(key, SESSION_TTL_SECONDS, data)
