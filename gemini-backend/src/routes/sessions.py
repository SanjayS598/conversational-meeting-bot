"""
FastAPI router for all /brain/sessions/:id/* endpoints.

Endpoints:
  POST   /brain/sessions/{id}/start    — create session, start live audio
  WS     /brain/sessions/{id}/audio    — stream raw PCM audio chunks
  POST   /brain/sessions/{id}/audio    — single audio chunk (non-WS fallback)
  GET    /brain/sessions/{id}/context  — current session config + meeting state
  GET    /brain/sessions/{id}/notes    — meeting state, transcript count, pending response
  POST   /brain/sessions/{id}/respond  — approve/reject pending response (triggers TTS)
  POST   /brain/sessions/{id}/summary  — generate (or return cached) meeting summary
  GET    /brain/sessions/{id}/summary  — return previously generated meeting summary
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status

from ..clients.backend import BackendClient, BackendClientError
from ..clients.voice import VoiceClient, VoiceClientError
from ..pipeline.audio_processor import AudioProcessor
from ..providers.interface import AIProvider, AudioChunk, SummaryPayload
from ..schemas.session import (
    MeetingSummary,
    RespondRequest,
    RespondResponse,
    SessionConfig,
    SessionContextResponse,
    SessionNotesResponse,
    SessionStatus,
    StartSessionRequest,
    StartSessionResponse,
    SummaryResponse,
)
from ..sessions.manager import SessionManager, SessionNotFoundError
from ..config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/brain/sessions", tags=["brain"])


# ─── Dependency helpers ───────────────────────────────────────────────────────


def get_session_manager(request: Request) -> SessionManager:
    return request.app.state.session_manager


def get_audio_processor(request: Request) -> AudioProcessor:
    return request.app.state.audio_processor


def get_backend_client(request: Request) -> BackendClient:
    return request.app.state.backend_client


def get_voice_client(request: Request) -> VoiceClient:
    return request.app.state.voice_client


def get_provider(request: Request) -> AIProvider:
    return request.app.state.provider


def _join_transcript_lines(transcript: list[object]) -> str:
    lines: list[str] = []
    for segment in transcript:
        text = getattr(segment, "text", "")
        if not text:
            continue
        speaker_label = getattr(segment, "speaker_label", "Participant")
        lines.append(f"[{speaker_label}] {text}")
    return "\n".join(lines)


def _clean_string_list(values: list[object]) -> list[str]:
    cleaned: list[str] = []
    for value in values:
        text = str(value).strip()
        if text:
            cleaned.append(text)
    return cleaned


def _clean_action_items(values: list[object]) -> list[dict[str, str | None]]:
    cleaned: list[dict[str, str | None]] = []
    for value in values:
        if not isinstance(value, dict):
            continue
        description = str(value.get("description", "")).strip()
        if not description:
            continue
        owner = value.get("owner")
        due_hint = value.get("due_hint")
        cleaned.append(
            {
                "description": description,
                "owner": str(owner).strip() if owner else None,
                "due_hint": str(due_hint).strip() if due_hint else None,
            }
        )
    return cleaned


def _build_summary_model(session_id: str, result, generated_at: int) -> MeetingSummary:
    return MeetingSummary(
        session_id=session_id,
        title=result.title.strip() or "Meeting Summary",
        executive_summary=result.executive_summary.strip(),
        key_decisions=_clean_string_list(result.key_decisions),
        action_items=_clean_action_items(result.action_items),
        open_questions=_clean_string_list(result.open_questions),
        next_steps=_clean_string_list(result.next_steps),
        generated_at=generated_at,
    )


async def _ensure_summary(
    session_id: str,
    session_manager: SessionManager,
    provider: AIProvider,
    backend_client: BackendClient,
) -> SummaryResponse:
    session = await session_manager.get_or_raise(session_id)
    if session.summary is not None:
        return SummaryResponse(
            session_id=session_id,
            summary=session.summary,
            transcript_count=len(session.transcript),
        )

    payload = SummaryPayload(
        session_id=session_id,
        full_transcript=_join_transcript_lines(session.transcript),
        meeting_objective=session.config.meeting_objective,
        current_state=session.meeting.model_dump_json(),
    )
    result = await provider.generate_meeting_summary(payload)
    summary = _build_summary_model(
        session_id=session_id,
        result=result,
        generated_at=int(time.time() * 1000),
    )
    await session_manager.save_summary(session_id, summary)

    try:
        await backend_client.push_summary(summary)
    except BackendClientError as exc:
        logger.warning("Failed to push summary to backend session_id=%s: %s", session_id, exc)

    return SummaryResponse(
        session_id=session_id,
        summary=summary,
        transcript_count=len(session.transcript),
    )


# ─── POST /brain/sessions/{session_id}/start ─────────────────────────────────


@router.post("/{session_id}/start", response_model=StartSessionResponse)
async def start_session(
    session_id: str,
    body: StartSessionRequest,
    session_manager: Annotated[SessionManager, Depends(get_session_manager)],
    audio_processor: Annotated[AudioProcessor, Depends(get_audio_processor)],
) -> StartSessionResponse:
    """
    Create a new meeting session.
    Starts the Gemini Live audio transcription session.
    """
    # Allow caller to override session_id
    final_id = session_id if session_id != "new" else str(uuid.uuid4())

    config = SessionConfig(
        session_id=final_id,
        mode=body.mode,
        user_tone=body.user_tone,
        meeting_objective=body.meeting_objective,
        prep_notes=body.prep_notes,
        allowed_topics=body.allowed_topics,
        response_policy=body.response_policy,
        voice_profile_id=body.voice_profile_id,
    )

    existing = await session_manager.get(final_id)
    if existing is not None and existing.status == SessionStatus.active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Session {final_id} is already active.",
        )

    await session_manager.create(config)

    try:
        await audio_processor.start(final_id, config)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to start live audio session: {exc}",
        ) from exc

    return StartSessionResponse(session_id=final_id, status=SessionStatus.active)


# ─── WebSocket /brain/sessions/{session_id}/audio ────────────────────────────


@router.websocket("/{session_id}/audio")
async def audio_stream(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(default=""),
) -> None:
    """
    WebSocket endpoint for streaming raw PCM audio.

    The Meeting Gateway connects here and sends audio as binary frames.
    Each frame is a raw 16-bit PCM, 16 kHz mono chunk (~100ms = ~3200 bytes).

    Optional text frames are treated as control messages:
      {"type": "stop"} — graceful session end
    """
    # Validate internal service token before accepting the connection
    if token != settings.internal_service_token:
        await websocket.close(code=4401, reason="Unauthorized")
        return

    audio_processor: AudioProcessor = websocket.app.state.audio_processor
    session_manager: SessionManager = websocket.app.state.session_manager

    # Validate session exists
    session = await session_manager.get(session_id)
    if session is None:
        await websocket.close(code=4404, reason="Session not found")
        return

    await websocket.accept()
    logger.info("WebSocket audio stream opened session_id=%s", session_id)

    sequence = 0
    ws_start_ms = int(time.time() * 1000)  # epoch anchor for relative timestamps
    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            # Binary frame → audio chunk
            if "bytes" in message and message["bytes"]:
                chunk = AudioChunk(
                    data=message["bytes"],
                    sequence=sequence,
                    timestamp_ms=int(time.time() * 1000) - ws_start_ms,  # ms since stream start
                )
                sequence += 1
                await audio_processor.ingest(session_id, chunk)

            # Text frame → control message
            elif "text" in message and message["text"]:
                import json as _json
                try:
                    ctrl = _json.loads(message["text"])
                    if ctrl.get("type") == "stop":
                        logger.info("Stop control received session_id=%s", session_id)
                        break
                except Exception:
                    pass  # ignore malformed control messages

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected session_id=%s", session_id)
    except Exception as exc:
        logger.error("WebSocket error session_id=%s: %s", session_id, exc)
    finally:
        await audio_processor.stop(session_id)
        await session_manager.end(session_id)
        try:
            await _ensure_summary(
                session_id=session_id,
                session_manager=session_manager,
                provider=websocket.app.state.provider,
                backend_client=websocket.app.state.backend_client,
            )
        except SessionNotFoundError:
            logger.warning("Summary skipped for missing session_id=%s", session_id)
        except Exception as exc:
            logger.warning("Automatic summary generation failed session_id=%s: %s", session_id, exc)
        try:
            await websocket.close()
        except Exception:
            pass


# ─── POST /brain/sessions/{session_id}/audio (HTTP fallback) ─────────────────


@router.post("/{session_id}/audio", status_code=status.HTTP_202_ACCEPTED)
async def audio_chunk_http(
    session_id: str,
    request: Request,
    audio_processor: Annotated[AudioProcessor, Depends(get_audio_processor)],
    session_manager: Annotated[SessionManager, Depends(get_session_manager)],
) -> dict:
    """
    HTTP fallback for sending a single audio chunk.
    Prefer the WebSocket endpoint for streaming.

    Body: raw PCM bytes (Content-Type: audio/pcm or application/octet-stream)
    """
    session = await session_manager.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio body")

    chunk = AudioChunk(
        data=raw,
        sequence=0,
        timestamp_ms=int(time.time() * 1000),
    )
    await audio_processor.ingest(session_id, chunk)
    return {"accepted": True}


# ─── GET /brain/sessions/{session_id}/context ────────────────────────────────


@router.get("/{session_id}/context", response_model=SessionContextResponse)
async def get_context(
    session_id: str,
    session_manager: Annotated[SessionManager, Depends(get_session_manager)],
) -> SessionContextResponse:
    """Return the current session config and meeting state (no full transcript)."""
    try:
        session = await session_manager.get_or_raise(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    return SessionContextResponse(
        session_id=session_id,
        status=session.status,
        config=session.config,
        meeting=session.meeting,
        started_at=session.started_at,
    )


# ─── GET /brain/sessions/{session_id}/notes ──────────────────────────────────


@router.get("/{session_id}/notes", response_model=SessionNotesResponse)
async def get_notes(
    session_id: str,
    session_manager: Annotated[SessionManager, Depends(get_session_manager)],
) -> SessionNotesResponse:
    """Return structured meeting notes, transcript count, and any pending response."""
    try:
        session = await session_manager.get_or_raise(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    return SessionNotesResponse(
        meeting_state=session.meeting,
        transcript_count=len(session.transcript),
        transcript=session.transcript,
        pending_response=session.pending_response,
    )


# ─── POST /brain/sessions/{session_id}/respond ───────────────────────────────


@router.post("/{session_id}/respond", response_model=RespondResponse)
async def respond(
    session_id: str,
    body: RespondRequest,
    session_manager: Annotated[SessionManager, Depends(get_session_manager)],
    voice_client: Annotated[VoiceClient, Depends(get_voice_client)],
) -> RespondResponse:
    """
    Approve or reject the pending AgentResponse.

    If approved:
      - Forwards AgentResponse.text to the Voice Runtime for TTS playback
      - Clears pending_response
      - Updates last_agent_response_at

    If rejected:
      - Clears pending_response only
    """
    try:
        session = await session_manager.get_or_raise(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    pending = session.pending_response
    if pending is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No pending response to act on.",
        )

    spoken = False
    if body.approved:
        try:
            await voice_client.speak(
                session_id=session_id,
                text=pending.text,
                max_speak_seconds=pending.max_speak_seconds,
                voice_profile_id=session.config.voice_profile_id,
            )
            spoken = True
        except VoiceClientError as exc:
            logger.error("Voice speak failed session_id=%s: %s", session_id, exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Voice Runtime error: {exc}",
            ) from exc

    # Clear pending response and update timestamp
    updated_meeting = session.meeting.model_copy(
        update={"last_agent_response_at": int(time.time() * 1000) if spoken else session.meeting.last_agent_response_at}
    )
    await session_manager.update_meeting_state(session_id, updated_meeting)
    await session_manager.set_pending_response(session_id, None)

    return RespondResponse(
        session_id=session_id,
        spoken=spoken,
        text=pending.text if spoken else None,
        reason=pending.reason if spoken else "rejected",
    )


# ─── GET /brain/sessions/{session_id}/summary ───────────────────────────────


@router.get("/{session_id}/summary", response_model=SummaryResponse)
async def get_summary(
    session_id: str,
    session_manager: Annotated[SessionManager, Depends(get_session_manager)],
) -> SummaryResponse:
    """Return the previously generated meeting summary."""
    try:
        session = await session_manager.get_or_raise(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.summary is None:
        raise HTTPException(status_code=404, detail="Summary not found")

    return SummaryResponse(
        session_id=session_id,
        summary=session.summary,
        transcript_count=len(session.transcript),
    )


# ─── POST /brain/sessions/{session_id}/summary ──────────────────────────────


@router.post("/{session_id}/summary", response_model=SummaryResponse)
async def generate_summary(
    session_id: str,
    session_manager: Annotated[SessionManager, Depends(get_session_manager)],
    provider: Annotated[AIProvider, Depends(get_provider)],
    backend_client: Annotated[BackendClient, Depends(get_backend_client)],
) -> SummaryResponse:
    """Generate and cache a structured meeting summary from the current transcript."""
    try:
        return await _ensure_summary(
            session_id=session_id,
            session_manager=session_manager,
            provider=provider,
            backend_client=backend_client,
        )
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except Exception as exc:
        logger.error("Summary generation failed session_id=%s: %s", session_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Summary generation failed",
        ) from exc
