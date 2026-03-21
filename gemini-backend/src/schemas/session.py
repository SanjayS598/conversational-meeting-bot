"""
Canonical Pydantic schemas for the Gemini Intelligence Service.
These are the contract for the entire system - define them first.
"""

from __future__ import annotations

import uuid
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ─── Enums ────────────────────────────────────────────────────────────────────


class SessionMode(str, Enum):
    notes_only = "notes_only"
    suggest = "suggest"
    auto_speak = "auto_speak"


class SessionStatus(str, Enum):
    active = "active"
    paused = "paused"
    ended = "ended"


class ResponsePriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


# ─── Core Objects ─────────────────────────────────────────────────────────────


class TranscriptSegment(BaseModel):
    segment_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    speaker_label: str  # e.g. "User", "Participant_1"
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str
    confidence: float = Field(ge=0.0, le=1.0)

    @field_validator("end_ms")
    @classmethod
    def end_after_start(cls, v: int, info) -> int:
        if "start_ms" in info.data and v < info.data["start_ms"]:
            raise ValueError("end_ms must be >= start_ms")
        return v


class ActionItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    owner: Optional[str] = None
    description: str
    due_hint: Optional[str] = None


class MeetingState(BaseModel):
    session_id: str
    current_topic: str = ""
    participants: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    last_agent_response_at: Optional[int] = None  # unix ms


class AgentResponse(BaseModel):
    text: str
    reason: str  # why the agent wants to speak
    priority: ResponsePriority = ResponsePriority.medium
    requires_approval: bool
    max_speak_seconds: float = Field(default=15.0, gt=0)
    confidence: float = Field(ge=0.0, le=1.0)


# ─── Session Config ───────────────────────────────────────────────────────────


class ResponsePolicyConfig(BaseModel):
    min_confidence: float = Field(default=0.75, ge=0.0, le=1.0)
    max_speak_seconds: float = Field(default=15.0, gt=0)
    cooldown_ms: int = Field(default=30_000, ge=0)  # min gap between responses


class SessionConfig(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    mode: SessionMode = SessionMode.suggest
    user_tone: str = "professional"  # e.g. "casual", "technical"
    meeting_objective: str
    prep_notes: Optional[str] = None
    allowed_topics: list[str] = Field(default_factory=list)
    response_policy: ResponsePolicyConfig = Field(default_factory=ResponsePolicyConfig)


class SessionState(BaseModel):
    config: SessionConfig
    meeting: MeetingState
    transcript: list[TranscriptSegment] = Field(default_factory=list)
    pending_response: Optional[AgentResponse] = None
    started_at: int  # unix ms
    status: SessionStatus = SessionStatus.active


# ─── API Request/Response Shapes ─────────────────────────────────────────────


class StartSessionRequest(BaseModel):
    session_id: Optional[str] = None
    mode: SessionMode = SessionMode.suggest
    user_tone: str = "professional"
    meeting_objective: str
    prep_notes: Optional[str] = None
    allowed_topics: list[str] = Field(default_factory=list)
    response_policy: ResponsePolicyConfig = Field(default_factory=ResponsePolicyConfig)


class StartSessionResponse(BaseModel):
    session_id: str
    status: SessionStatus


class SessionContextResponse(BaseModel):
    session_id: str
    status: SessionStatus
    config: SessionConfig
    meeting: MeetingState
    started_at: int


class SessionNotesResponse(BaseModel):
    meeting_state: MeetingState
    transcript_count: int
    transcript: list[TranscriptSegment] = Field(default_factory=list)
    pending_response: Optional[AgentResponse] = None


class RespondRequest(BaseModel):
    approved: bool


class RespondResponse(BaseModel):
    session_id: str
    spoken: bool
    text: Optional[str] = None
    reason: Optional[str] = None
