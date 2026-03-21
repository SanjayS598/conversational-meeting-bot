"""
LangGraph agent state definition.

The MeetingAgentState is the typed state object that flows through the
LangGraph graph nodes. It holds everything needed to process one
TranscriptSegment through the full pipeline.
"""

from __future__ import annotations

from typing import Optional

from langchain_core.messages import BaseMessage
from langgraph.graph import MessagesState

from ..schemas.session import (
    AgentResponse,
    MeetingState,
    SessionConfig,
    TranscriptSegment,
)


class MeetingAgentState(MessagesState):
    """
    State passed through the LangGraph meeting intelligence graph.

    Extends MessagesState (which provides the `messages` list) with
    meeting-specific fields needed by each graph node.
    """

    # ── Inputs (set before graph entry) ──────────────────────────────────────
    session_id: str
    new_segment: TranscriptSegment
    session_config: SessionConfig
    current_meeting_state: MeetingState
    recent_transcript_text: str  # rolling window, pre-formatted

    # ── Intermediate / outputs (set by graph nodes) ───────────────────────────
    updated_meeting_state: Optional[MeetingState] = None
    response_candidate: Optional[AgentResponse] = None
    policy_allowed: bool = False
    policy_reason: str = ""
    final_response: Optional[AgentResponse] = None  # post-policy candidate
