"""
Response policy engine — pure logic, no AI calls, no I/O.

This is the decision gate that determines whether an AgentResponse candidate
is allowed to proceed based on session mode, confidence, and cooldown rules.

Decision table:
┌────────────┬─────────────┬──────────────────┬──────────────────────────────────────┐
│ mode       │ confidence  │ user directly    │ action                               │
│            │             │ asked            │                                      │
├────────────┼─────────────┼──────────────────┼──────────────────────────────────────┤
│ notes_only │ any         │ any              │ Never speak                          │
│ suggest    │ < threshold │ any              │ No candidate                         │
│ suggest    │ ≥ threshold │ yes              │ Candidate, requires_approval=True    │
│ auto_speak │ < threshold │ any              │ No candidate                         │
│ auto_speak │ ≥ threshold │ yes              │ Candidate, requires_approval=False   │
│ any        │ any         │ no               │ No candidate                         │
└────────────┴─────────────┴──────────────────┴──────────────────────────────────────┘
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, TypedDict

from ..schemas.session import AgentResponse, SessionMode

if TYPE_CHECKING:
    from .state import MeetingAgentState


class PolicyDecision(TypedDict):
    allowed: bool
    reason: str


def evaluate_response_policy(
    candidate: AgentResponse,
    state: "MeetingAgentState",
) -> PolicyDecision:
    """
    Gate an AgentResponse candidate through the response policy rules.

    Returns a PolicyDecision with `allowed` bool and a `reason` string.
    Mutates `candidate.requires_approval` to enforce suggest-mode semantics.
    """
    config = state["session_config"]
    meeting = state.get("updated_meeting_state") or state["current_meeting_state"]
    policy = config.response_policy
    mode = config.mode

    # Rule 1: notes_only mode never speaks
    if mode == SessionMode.notes_only:
        return PolicyDecision(allowed=False, reason="mode=notes_only")

    # Rule 2: confidence gate
    if candidate.confidence < policy.min_confidence:
        return PolicyDecision(
            allowed=False,
            reason=(
                f"confidence {candidate.confidence:.2f} < "
                f"threshold {policy.min_confidence:.2f}"
            ),
        )

    # Rule 3: cooldown — ensure minimum gap between agent responses
    if meeting.last_agent_response_at is not None:
        elapsed_ms = int(time.time() * 1000) - meeting.last_agent_response_at
        if elapsed_ms < policy.cooldown_ms:
            return PolicyDecision(
                allowed=False,
                reason=(
                    f"cooldown: {elapsed_ms}ms elapsed of {policy.cooldown_ms}ms required"
                ),
            )

    # Rule 4: suggest mode always requires explicit approval
    if mode == SessionMode.suggest:
        candidate.requires_approval = True

    # Rule 5: auto_speak mode never requires approval
    if mode == SessionMode.auto_speak:
        candidate.requires_approval = False

    return PolicyDecision(allowed=True, reason="approved")
