"""
State updater — orchestrates the LangGraph pipeline after each transcript segment.

Called after every finalized TranscriptSegment. It:
1. Builds the MeetingAgentState from the current session
2. Runs the LangGraph graph (update_state → policy_gate)
3. Persists updated MeetingState and optional AgentResponse to Redis
4. Pushes TranscriptSegment and MeetingState to the Control Backend
5. If the session has conversational AI active, debounces and generates a reply.
"""

from __future__ import annotations

import asyncio
import logging
import time

from langchain_core.runnables import RunnableConfig

from ..agent.graph import meeting_graph
from ..clients.backend import BackendClient
from ..providers.interface import AIProvider
from ..schemas.session import TranscriptSegment
from ..sessions.manager import SessionManager, SessionNotFoundError

logger = logging.getLogger(__name__)

# How many recent segments to include in the rolling transcript context
ROLLING_WINDOW = 20

# Debounce delay before triggering a conversational response (seconds).
# Lower is snappier; 0.8s gives the user time to finish a sentence without
# the bot interrupting on brief mid-sentence pauses.
CONV_DEBOUNCE_S = 0.8

# Per-session debounce task handle
_debounce_tasks: dict[str, asyncio.Task] = {}  # type: ignore[type-arg]
# Per-session last transcript seen (for debounce stale-check)
_last_transcript: dict[str, str] = {}


class StateUpdater:
    """
    Orchestrates the LangGraph meeting intelligence graph for each new segment.

    Wire it into the AudioProcessor's on_segment_ready callback.
    """

    def __init__(
        self,
        provider: AIProvider,
        session_manager: SessionManager,
        backend_client: BackendClient,
    ) -> None:
        self._provider = provider
        self._session_manager = session_manager
        self._backend_client = backend_client

    async def process(self, session_id: str, new_segment: TranscriptSegment) -> None:
        """
        Process a new transcript segment through the full intelligence pipeline.

        Steps:
          1. Load session from Redis
          2. Immediately persist transcript segment to DB (fast path — unblocks UI)
          3. Run LangGraph / Gemini graph for notes update (slow path — background)
          4. Persist updated meeting state and push to Control Backend
          5. If conversational AI is active, debounce + respond
        """
        try:
            session = await self._session_manager.get_or_raise(session_id)
        except SessionNotFoundError:
            logger.warning("StateUpdater: session not found session_id=%s", session_id)
            return

        # ── Fast path: save transcript segment immediately ─────────────────────
        # This runs BEFORE Gemini so the transcript appears in the UI as soon as
        # possible, regardless of how long the AI notes update takes.
        await self._session_manager.append_transcript_segment(session_id, new_segment)
        try:
            await self._backend_client.save_transcript_segment(new_segment)
        except Exception as exc:
            logger.warning(
                "Failed to push transcript segment session_id=%s: %s", session_id, exc
            )

        # ── Conversational AI: debounce started immediately ───────────────────
        # Trigger the conversational debounce NOW, before the slow LangGraph
        # notes pipeline, so the response latency is debounce-time only (1.2s)
        # instead of debounce + Gemini notes call.
        recent_for_conv = session.transcript[-(ROLLING_WINDOW - 1):]
        if not recent_for_conv or recent_for_conv[-1].segment_id != new_segment.segment_id:
            recent_for_conv = [*recent_for_conv, new_segment]
        self._maybe_trigger_conv_response(session_id, new_segment, recent_for_conv)

        # ── Slow path: Gemini notes update ────────────────────────────────────
        # Build rolling transcript text including the segment that just arrived.
        recent = session.transcript[-(ROLLING_WINDOW - 1):] if ROLLING_WINDOW > 1 else []
        if not recent or recent[-1].segment_id != new_segment.segment_id:
            recent = [*recent, new_segment]
        recent_text = "\n".join(
            f"[{seg.speaker_label}] {seg.text}" for seg in recent
        )

        # Build the initial LangGraph state
        initial_state = {
            "session_id": session_id,
            "new_segment": new_segment,
            "session_config": session.config,
            "current_meeting_state": session.meeting,
            "recent_transcript_text": recent_text,
            "messages": [],
        }

        # Inject the provider via RunnableConfig (keeps graph provider-agnostic)
        graph_config = RunnableConfig(
            configurable={"provider": self._provider}
        )

        try:
            result = await meeting_graph.ainvoke(initial_state, config=graph_config)
        except Exception as exc:
            logger.error(
                "LangGraph pipeline failed session_id=%s: %s", session_id, exc
            )
            # Conversational debounce was already triggered above; nothing extra to do.
            return

        # ── Persist AI results to Redis ────────────────────────────────────────

        updated_meeting = result.get("updated_meeting_state") or session.meeting
        final_response = result.get("final_response")

        # Update last_agent_response_at if a response was approved
        if final_response is not None:
            updated_meeting.last_agent_response_at = int(time.time() * 1000)

        await self._session_manager.update_meeting_state(session_id, updated_meeting)
        await self._session_manager.set_pending_response(session_id, final_response)

        if final_response is not None:
            logger.info(
                "Response candidate set session_id=%s priority=%s requires_approval=%s",
                session_id,
                final_response.priority,
                final_response.requires_approval,
            )
        else:
            reason = result.get("policy_reason", "unknown")
            logger.debug(
                "No response for session_id=%s reason=%s", session_id, reason
            )

        # ── Push notes + optional response to Control Backend ─────────────────

        try:
            await self._backend_client.save_meeting_state(updated_meeting, recent_text)
        except Exception as exc:
            logger.warning(
                "Failed to push meeting state to backend session_id=%s: %s",
                session_id,
                exc,
            )

        if final_response is not None:
            try:
                await self._backend_client.notify_response_ready(
                    session_id, final_response
                )
            except Exception as exc:
                logger.warning(
                    "Failed to notify backend of response session_id=%s: %s",
                    session_id,
                    exc,
                )

    def _maybe_trigger_conv_response(
        self,
        session_id: str,
        segment: TranscriptSegment,
        recent_segments: list[TranscriptSegment],
    ) -> None:
        """Debounce and schedule a conversational reply if the session is in conv mode."""
        from ..voice import conversation as conv

        if not conv.is_attached(session_id):
            return

        text = segment.text.strip()
        if not text:
            return

        recent_transcript = "\n".join(
            f"{item.speaker_label}: {item.text.strip()}"
            for item in recent_segments[-6:]
            if item.text.strip()
        )

        # Cancel any pending debounce task for this session
        existing = _debounce_tasks.get(session_id)
        if existing and not existing.done():
            existing.cancel()

        _last_transcript[session_id] = recent_transcript

        async def _respond_after_debounce() -> None:
            await asyncio.sleep(CONV_DEBOUNCE_S)

            # Stale-check: if new speech arrived while we were waiting, abort
            if _last_transcript.get(session_id) != recent_transcript:
                logger.debug(
                    "Conv debounce stale session_id=%s — skipping", session_id
                )
                return

            from ..voice import injector

            reply = await asyncio.get_event_loop().run_in_executor(
                None,
                conv.get_response,
                session_id,
                text,
                segment.speaker_label,
                recent_transcript,
            )

            if reply:
                logger.info(
                    "Conversational reply session_id=%s: %s", session_id, reply[:80]
                )
                session_state = await self._session_manager.get(session_id)
                provider_voice_id = session_state.config.provider_voice_id if session_state else None
                await injector.inject_text(session_id, reply, provider_voice_id)

        task = asyncio.create_task(_respond_after_debounce())
        _debounce_tasks[session_id] = task

    async def _persist_segment_only(
        self, session_id: str, segment: TranscriptSegment
    ) -> None:
        """Fallback: persist only the raw segment when the AI pipeline fails."""
        try:
            await self._session_manager.append_transcript_segment(session_id, segment)
            await self._backend_client.save_transcript_segment(segment)
        except Exception as exc:
            logger.error(
                "Fallback segment persist failed session_id=%s: %s", session_id, exc
            )
