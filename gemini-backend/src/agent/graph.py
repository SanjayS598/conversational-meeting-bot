"""
LangGraph meeting intelligence graph.

Compiles the stateful graph that processes a single TranscriptSegment through:
  1. update_state_node  — Gemini state update + response generation
  2. policy_gate_node   — Confidence + mode + cooldown gating

Usage:
    from src.agent.graph import build_graph

    graph = build_graph()
    result = await graph.ainvoke(initial_state, config={"configurable": {"provider": provider}})
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from .nodes import policy_gate_node, update_state_node
from .state import MeetingAgentState


def build_graph() -> StateGraph:
    """
    Build and compile the meeting intelligence LangGraph.

    The graph is intentionally linear for v1:
      START → update_state → policy_gate → END

    The provider is injected via RunnableConfig so the graph itself
    has no hard dependency on Gemini — it's fully swappable.
    """
    builder = StateGraph(MeetingAgentState)

    # Register nodes
    builder.add_node("update_state", update_state_node)
    builder.add_node("policy_gate", policy_gate_node)

    # Wire edges
    builder.add_edge(START, "update_state")
    builder.add_edge("update_state", "policy_gate")
    builder.add_edge("policy_gate", END)

    return builder.compile()


# Module-level singleton — compiled once, reused for all invocations
meeting_graph = build_graph()
