"""
Abstract AI provider interface — swappable adapter pattern.
All AI calls go through this interface so the provider can be replaced.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional


@dataclass
class AudioChunk:
    data: bytes
    sequence: int
    timestamp_ms: int


@dataclass
class TranscriptDelta:
    text: str
    speaker_label: str
    start_ms: int
    end_ms: int
    confidence: float
    is_final: bool


@dataclass
class StateUpdatePayload:
    transcript_so_far: str          # rolling window of recent transcript text
    current_meeting_state: str      # JSON-stringified MeetingState
    session_config: str             # JSON-stringified SessionConfig


@dataclass
class StateUpdateResult:
    updated_state: str              # JSON-stringified MeetingState
    response_candidate: Optional[str]  # JSON-stringified AgentResponse or None


@dataclass
class SummaryPayload:
    session_id: str
    full_transcript: str            # all segments joined as "[Speaker] text\n"
    meeting_objective: str          # from SessionConfig
    current_state: str              # JSON-stringified MeetingState (incremental notes)


@dataclass
class SummaryResult:
    title: str
    executive_summary: str
    key_decisions: list
    action_items: list              # list of dicts with description/owner/due_hint
    open_questions: list
    next_steps: list


# Callback type for streaming transcript deltas
DeltaCallback = Callable[[TranscriptDelta], Awaitable[None]]


class AIProvider(ABC):
    """Interface for AI providers. Implement this to swap out Gemini."""

    @abstractmethod
    async def start_live_session(self, session_id: str, config: dict) -> str:
        """Start a live session for real-time audio transcription.
        Returns a provider session handle string."""
        ...

    @abstractmethod
    async def send_audio_chunk(
        self,
        handle: str,
        chunk: AudioChunk,
        on_delta: DeltaCallback,
    ) -> None:
        """Push an audio chunk; calls on_delta for each transcript delta produced."""
        ...

    @abstractmethod
    async def update_state_and_maybe_respond(
        self, payload: StateUpdatePayload
    ) -> StateUpdateResult:
        """Stateless structured call to update MeetingState and optionally generate a response."""
        ...

    @abstractmethod
    async def generate_meeting_summary(self, payload: SummaryPayload) -> SummaryResult:
        """Generate a comprehensive end-of-meeting summary from the full transcript."""
        ...

    @abstractmethod
    async def end_live_session(self, handle: str) -> None:
        """End a live session cleanly."""
        ...
