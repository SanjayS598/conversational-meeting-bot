"""
LangGraph nodes for the meeting intelligence pipeline.

Each node is a pure async function that receives the current MeetingAgentState,
does exactly one job, and returns a partial state update dict.

Graph topology:
  [entry] → update_state_node → policy_gate_node → [end]

  update_state_node: Calls Gemini to update MeetingState + generate candidate
  policy_gate_node:  Applies response policy rules (no AI, pure logic)
"""

from __future__ import annotations

import json
import logging

from langchain_core.runnables import RunnableConfig

from ..providers.interface import AIProvider, StateUpdatePayload
from ..schemas.session import AgentResponse, MeetingState
from .policy import evaluate_response_policy
from .state import MeetingAgentState

logger = logging.getLogger(__name__)


# ─── Node: update_state ───────────────────────────────────────────────────────


async def update_state_node(
    state: MeetingAgentState,
    config: RunnableConfig,
) -> dict:
    """
    Call the AI provider to:
    1. Update the MeetingState from the new transcript segment
    2. Generate an AgentResponse candidate if appropriate

    Returns partial state with `updated_meeting_state` and `response_candidate`.
    """
    provider: AIProvider = config["configurable"]["provider"]

    # Build rolling transcript text
    transcript_text = state["recent_transcript_text"]
    new_seg = state["new_segment"]
    full_transcript = (
        transcript_text + f"\n[{new_seg.speaker_label}] {new_seg.text}"
    ).strip()

    payload = StateUpdatePayload(
        transcript_so_far=full_transcript,
        current_meeting_state=state["current_meeting_state"].model_dump_json(),
        session_config=state["session_config"].model_dump_json(),
    )

    try:
        result = await provider.update_state_and_maybe_respond(payload)

        updated_meeting = MeetingState.model_validate_json(result.updated_state)
        # Ensure session_id is preserved (model might strip it)
        updated_meeting.session_id = state["session_id"]

        response_candidate: AgentResponse | None = None
        if result.response_candidate:
            response_candidate = AgentResponse.model_validate_json(
                result.response_candidate
            )

        return {
            "updated_meeting_state": updated_meeting,
            "response_candidate": response_candidate,
        }

    except Exception as exc:
        logger.error(
            "update_state_node failed session_id=%s: %s", state["session_id"], exc
        )
        # Don't crash the pipeline — return the existing state unchanged
        return {
            "updated_meeting_state": state["current_meeting_state"],
            "response_candidate": None,
        }


# ─── Node: policy_gate ────────────────────────────────────────────────────────


async def policy_gate_node(
    state: MeetingAgentState,
    config: RunnableConfig,
) -> dict:
    """
    Apply the response policy engine to the candidate (if any).
    Pure logic — no AI calls, no I/O.

    Returns partial state with `policy_allowed`, `policy_reason`, and
    `final_response`.
    """
    candidate = state.get("response_candidate")

    if candidate is None:
        return {
            "policy_allowed": False,
            "policy_reason": "no candidate generated",
            "final_response": None,
        }

    decision = evaluate_response_policy(candidate, state)

    if decision["allowed"]:
        return {
            "policy_allowed": True,
            "policy_reason": "approved",
            "final_response": candidate,
        }
    else:
        return {
            "policy_allowed": False,
            "policy_reason": decision["reason"],
            "final_response": None,
        }
