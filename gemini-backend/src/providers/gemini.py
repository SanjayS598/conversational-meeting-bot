"""
Gemini provider implementation using the google-genai SDK.

Audio transcription uses a buffered approach: audio chunks are accumulated for
BUFFER_SECONDS seconds, then sent to gemini-2.5-flash as inline PCM audio for
transcription. This works on AI Studio free tier (unlike the Live WebSocket API
which requires Vertex AI / paid access).

State updates use a stateless generateContent call with JSON output mode.

Audio format requirements:
  - 16-bit PCM, 16 kHz, mono (LINEAR16)
  - Chunks should be ~100ms of audio (3200 bytes at 16kHz 16-bit mono)
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid

from google import genai
from google.genai import types

from .interface import (
    AIProvider,
    AudioChunk,
    DeltaCallback,
    StateUpdatePayload,
    StateUpdateResult,
    TranscriptDelta,
)

logger = logging.getLogger(__name__)

# How many seconds of audio to buffer before sending for transcription.
# 2s gives a good balance of responsiveness vs. API call frequency.
BUFFER_SECONDS = 2.0
# 16kHz, 16-bit mono = 32000 bytes/sec
BYTES_PER_SECOND = 32000
BUFFER_BYTES = int(BUFFER_SECONDS * BYTES_PER_SECOND)

TRANSCRIPTION_PROMPT = (
    "Transcribe the speech in this audio clip exactly as spoken. "
    "Return only the spoken words — no labels, no explanations, no markdown. "
    "If there is no audible speech, return an empty string."
)

STATE_UPDATE_SYSTEM_PROMPT = """\
You are the intelligence layer for a personal meeting agent.
Your job is to track what is happening in a meeting and decide if the agent should speak.

You will receive:
- A rolling transcript of recent meeting audio
- The current structured meeting state (JSON)
- Session configuration (mode, objective, tone, allowed topics, policy)

You must:
1. Update the meeting state with new decisions, open questions, action items, or topic changes.
2. Determine if the user is being directly asked a question relevant to the meeting objective.
3. If yes AND the session config allows speaking, generate a concise AgentResponse (1-2 sentences max).
4. If no response is appropriate, set response_candidate to null.

Return ONLY valid JSON with no markdown fences, matching exactly:
{
  "updated_state": { <MeetingState object> },
  "response_candidate": { <AgentResponse object> } | null
}

MeetingState fields: session_id, current_topic, participants, decisions (string[]),
open_questions (string[]), action_items ([{id, owner?, description, due_hint?}]),
last_agent_response_at (int ms | null)

AgentResponse fields: text, reason, priority ("low"|"medium"|"high"),
requires_approval (bool), max_speak_seconds (float), confidence (0.0-1.0)

Rules:
- Keep reply text to 1-2 sentences max.
- Match the user_tone specified in session config.
- Only speak about topics within meeting_objective and allowed_topics.
- Prefer silence over risky interruptions.
"""


def _build_state_update_prompt(payload: StateUpdatePayload) -> str:
    return (
        STATE_UPDATE_SYSTEM_PROMPT
        + "\n\n## Current Meeting State\n"
        + payload.current_meeting_state
        + "\n\n## Session Configuration\n"
        + payload.session_config
        + "\n\n## Recent Transcript\n"
        + payload.transcript_so_far
        + "\n\nRespond with valid JSON only."
    )


class GeminiProvider(AIProvider):
    """
    Google Gemini AI provider (google-genai SDK).

    Uses gemini-2.5-flash for both state updates and audio transcription.
    Audio is buffered in memory and sent as inline PCM to generate_content,
    which is compatible with the AI Studio free tier.
    """

    TRANSCRIPTION_MODEL = "gemini-2.5-flash"
    STATE_MODEL = "gemini-2.5-flash"

    def __init__(self, api_key: str) -> None:
        self._client = genai.Client(api_key=api_key)
        # handle → { session_id, buffer: bytearray, start_ms: int, lock: asyncio.Lock }
        self._live_sessions: dict[str, dict] = {}

    async def start_live_session(self, session_id: str, config: dict) -> str:
        handle = str(uuid.uuid4())
        self._live_sessions[handle] = {
            "session_id": session_id,
            "buffer": bytearray(),
            "start_ms": 0,
            "lock": asyncio.Lock(),
        }
        logger.info("Started buffered transcription session handle=%s session_id=%s", handle, session_id)
        return handle

    async def send_audio_chunk(
        self,
        handle: str,
        chunk: AudioChunk,
        on_delta: DeltaCallback,
    ) -> None:
        info = self._live_sessions.get(handle)
        if info is None:
            raise ValueError(f"Unknown live session handle: {handle}")

        async with info["lock"]:
            if not info["buffer"]:
                info["start_ms"] = chunk.timestamp_ms
            info["buffer"].extend(chunk.data)

            if len(info["buffer"]) >= BUFFER_BYTES:
                audio_data = bytes(info["buffer"])
                start_ms = info["start_ms"]
                info["buffer"] = bytearray()
                info["start_ms"] = 0
            else:
                return  # keep buffering

        # Transcribe outside the lock so chunks can keep accumulating
        await self._transcribe_buffer(handle, audio_data, start_ms, on_delta)

    async def _transcribe_buffer(
        self,
        handle: str,
        audio_data: bytes,
        start_ms: int,
        on_delta: DeltaCallback,
    ) -> None:
        duration_ms = _estimate_duration_ms(audio_data)
        end_ms = start_ms + duration_ms
        try:
            # Gemini requires WAV format — raw PCM will cause hallucination
            wav_data = _pcm_to_wav(audio_data)
            audio_b64 = base64.b64encode(wav_data).decode()
            response = await self._client.aio.models.generate_content(
                model=self.TRANSCRIPTION_MODEL,
                contents=[
                    types.Part(text=TRANSCRIPTION_PROMPT),
                    types.Part(
                        inline_data=types.Blob(
                            mime_type="audio/wav",
                            data=audio_b64,
                        )
                    ),
                ],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    max_output_tokens=512,
                ),
            )
            text = (response.text or "").strip()
            if not text:
                return

            delta = TranscriptDelta(
                text=text,
                speaker_label="Participant",
                start_ms=start_ms,
                end_ms=end_ms,
                confidence=0.90,
                is_final=True,
            )
            await on_delta(delta)
            logger.debug("Transcribed %d bytes → %d chars handle=%s", len(audio_data), len(text), handle)

        except Exception as exc:
            logger.warning("Transcription failed handle=%s: %s", handle, exc)

    async def update_state_and_maybe_respond(
        self, payload: StateUpdatePayload
    ) -> StateUpdateResult:
        prompt = _build_state_update_prompt(payload)

        response = await self._client.aio.models.generate_content(
            model=self.STATE_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
                max_output_tokens=2048,
            ),
        )

        raw = response.text.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1].lstrip("json").strip() if len(parts) > 1 else raw

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.error("Failed to parse Gemini JSON response: %s\nRaw: %s", exc, raw[:300])
            raise

        updated_state_json = json.dumps(data["updated_state"])
        response_candidate = data.get("response_candidate")
        response_candidate_json = json.dumps(response_candidate) if response_candidate else None

        return StateUpdateResult(
            updated_state=updated_state_json,
            response_candidate=response_candidate_json,
        )

    async def end_live_session(self, handle: str) -> None:
        info = self._live_sessions.pop(handle, None)
        if info is None:
            return
        # Discard any remaining buffered audio (session is ending)
        logger.info("Ended buffered transcription session handle=%s", handle)


def _estimate_duration_ms(pcm_data: bytes) -> int:
    # 16kHz 16-bit mono = 32 bytes per ms
    return len(pcm_data) // 32


def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000, num_channels: int = 1, bits_per_sample: int = 16) -> bytes:
    """Wrap raw PCM bytes in a RIFF/WAV container so Gemini can decode it."""
    import struct
    data_size = len(pcm_data)
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,            # PCM subchunk size
        1,             # AudioFormat = PCM
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    return header + pcm_data
