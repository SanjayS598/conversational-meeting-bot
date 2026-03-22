"""
Hybrid provider implementation.

Speech-to-text uses the OpenAI Whisper API (whisper-1) on buffered WAV audio.
Meeting-state updates and meeting summary generation use the Google Gemini SDK.

Audio format requirements:
    - 16-bit PCM, 16 kHz, mono (LINEAR16)
    - Chunks should be ~100ms of audio (3200 bytes at 16kHz 16-bit mono)
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from io import BytesIO

import openai
from google import genai
from google.genai import types

from .interface import (
    AIProvider,
    AudioChunk,
    DeltaCallback,
    StateUpdatePayload,
    StateUpdateResult,
    SummaryPayload,
    SummaryResult,
    TranscriptDelta,
)

logger = logging.getLogger(__name__)

# How many seconds of audio to buffer before sending for transcription.
# 10s gives Whisper enough context for accurate sentence-level transcription.
# Shorter chunks (< 5s) cause frequent API calls and reduce accuracy because
# Whisper can't pick up sentence structure from just a few words.
BUFFER_SECONDS = 10.0
# 16kHz, 16-bit mono = 32000 bytes/sec
BYTES_PER_SECOND = 32000
BUFFER_BYTES = int(BUFFER_SECONDS * BYTES_PER_SECOND)

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


MEETING_SUMMARY_PROMPT = """\
You are an expert meeting analyst. Your task is to generate a thorough, detailed, structured meeting summary.

You will receive:
- The meeting objective
- The full meeting transcript
- Incrementally-captured notes (decisions, action items, open questions tracked so far)

Generate a complete meeting summary. Return ONLY valid JSON with no markdown fences:
{
  "title": "<short descriptive title for the meeting (max 10 words)>",
  "executive_summary": "<detailed summary of what was discussed, decided, and accomplished — aim for 5-8 sentences covering the arc of the conversation>",
  "topics_discussed": [
    {"topic": "<topic name>", "summary": "<2-4 sentences on what was said, key perspectives, and outcome>"}
  ],
  "key_decisions": ["<decision 1 — include reasoning if mentioned>", "<decision 2>", ...],
  "action_items": [
    {"description": "<specific task>", "owner": "<person or null>", "due_hint": "<timeframe or null>", "context": "<why this was assigned>"}
  ],
  "open_questions": ["<question 1 — include who raised it if known>", "<question 2>", ...],
  "next_steps": ["<concrete next step 1>", "<next step 2>", ...],
  "notable_quotes": ["<verbatim or near-verbatim quote that captures a key moment>", ...]
}

Rules:
- Base everything strictly on the transcript — do not invent facts
- executive_summary must be substantive — avoid vague filler phrases like "various topics were discussed"
- topics_discussed should capture every distinct subject raised, even briefly
- key_decisions must be things explicitly agreed upon; include the reasoning behind each if stated
- action_items: include owner and due_hint whenever discernible from context
- notable_quotes: pick 1-3 quotes that best capture the meeting's tone or most important moments
- If the transcript is too short or silent, still return the JSON structure with empty arrays
"""


def _build_summary_prompt(payload: SummaryPayload) -> str:
    return (
        MEETING_SUMMARY_PROMPT
        + "\n\n## Meeting Objective\n"
        + payload.meeting_objective
        + "\n\n## Incremental Notes (captured so far)\n"
        + payload.current_state
        + "\n\n## Full Transcript\n"
        + (payload.full_transcript or "(no transcript captured)")
        + "\n\nRespond with valid JSON only."
    )


class GeminiProvider(AIProvider):
    STATE_MODEL = "gemini-2.5-flash"

    def __init__(
        self,
        api_key: str,
        openai_api_key: str = "",
        whisper_model: str = "whisper-1",
    ) -> None:
        self._client = genai.Client(api_key=api_key)
        self._openai = openai.AsyncOpenAI(api_key=openai_api_key)
        self._whisper_model = whisper_model
        # handle → { session_id, buffer: bytearray, start_ms: int, lock: asyncio.Lock }
        self._live_sessions: dict[str, dict] = {}

    async def start_live_session(self, session_id: str, config: dict) -> str:
        handle = str(uuid.uuid4())
        self._live_sessions[handle] = {
            "session_id": session_id,
            "buffer": bytearray(),
            "start_ms": 0,
            "lock": asyncio.Lock(),
            "last_transcript": "",  # passed as Whisper prompt for word-boundary continuity
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
                prompt = info["last_transcript"]
                info["buffer"] = bytearray()
                info["start_ms"] = 0
            else:
                return  # keep buffering

        # Transcribe outside the lock so chunks can keep accumulating
        await self._transcribe_buffer(handle, audio_data, start_ms, on_delta, prompt=prompt)

    async def _transcribe_buffer(
        self,
        handle: str,
        audio_data: bytes,
        start_ms: int,
        on_delta: DeltaCallback,
        prompt: str = "",
    ) -> None:
        duration_ms = _estimate_duration_ms(audio_data)
        end_ms = start_ms + duration_ms
        try:
            # OpenAI Whisper API expects decodable audio bytes; wrap PCM in WAV.
            wav_data = _pcm_to_wav(audio_data)
            text = await self._transcribe_wav(wav_data, prompt=prompt)
            if not text:
                return

            # Update rolling transcript tail for next call's Whisper prompt.
            info = self._live_sessions.get(handle)
            if info is not None:
                tail = (prompt + " " + text).strip()
                info["last_transcript"] = tail[-200:]  # cap at ~200 chars

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

    async def _transcribe_wav(self, wav_data: bytes, prompt: str = "") -> str:
        kwargs: dict = dict(
            model=self._whisper_model,
            file=("audio.wav", BytesIO(wav_data), "audio/wav"),
            response_format="text",
            language="en",  # skip auto-detection; faster + more accurate for English
        )
        if prompt:
            kwargs["prompt"] = prompt  # improves word-boundary accuracy at segment edges
        response = await self._openai.audio.transcriptions.create(**kwargs)
        # response_format="text" returns a plain string
        return response.strip() if isinstance(response, str) else str(response).strip()

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

    async def end_live_session(self, handle: str, on_delta: DeltaCallback | None = None) -> None:
        info = self._live_sessions.pop(handle, None)
        if info is None:
            return

        # Flush any remaining buffered audio so the transcript isn't cut short.
        # With a 10s buffer, up to 10s of speech could be lost without this.
        async with info["lock"]:
            remaining = bytes(info["buffer"])
            start_ms = info["start_ms"]
            prompt = info["last_transcript"]

        if remaining and on_delta:
            duration_ms = _estimate_duration_ms(remaining)
            end_ms = start_ms + duration_ms
            try:
                wav_data = _pcm_to_wav(remaining)
                text = await self._transcribe_wav(wav_data, prompt=prompt)
                if text:
                    delta = TranscriptDelta(
                        text=text,
                        speaker_label="Participant",
                        start_ms=start_ms,
                        end_ms=end_ms,
                        confidence=0.90,
                        is_final=True,
                    )
                    await on_delta(delta)
                    logger.debug("Flushed final %d bytes → %d chars handle=%s", len(remaining), len(text), handle)
            except Exception as exc:
                logger.warning("Final buffer flush failed handle=%s: %s", handle, exc)

        logger.info("Ended buffered transcription session handle=%s", handle)

    async def generate_meeting_summary(self, payload: SummaryPayload) -> SummaryResult:
        """
        Generate a comprehensive end-of-meeting summary using Gemini.

        Called once when a session ends (or triggered manually).
        Uses the full transcript and accumulated MeetingState to produce
        a structured summary: title, executive summary, decisions, action items,
        open questions, and next steps.
        """
        prompt = _build_summary_prompt(payload)

        response = await self._client.aio.models.generate_content(
            model=self.STATE_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.3,
                max_output_tokens=4096,
            ),
        )

        raw = (response.text or "").strip()
        # Strip accidental markdown fences
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1].lstrip("json").strip() if len(parts) > 1 else raw

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.error("Failed to parse summary JSON: %s\nRaw: %s", exc, raw[:500])
            # Return a graceful fallback rather than crashing
            data = {
                "title": "Meeting Summary",
                "executive_summary": "Summary generation encountered a parsing error.",
                "key_decisions": [],
                "action_items": [],
                "open_questions": [],
                "next_steps": [],
                "topics_discussed": [],
                "notable_quotes": [],
            }

        return SummaryResult(
            title=data.get("title", "Meeting Summary"),
            executive_summary=data.get("executive_summary", ""),
            key_decisions=data.get("key_decisions", []),
            action_items=data.get("action_items", []),
            open_questions=data.get("open_questions", []),
            next_steps=data.get("next_steps", []),
            topics_discussed=data.get("topics_discussed", []),
            notable_quotes=data.get("notable_quotes", []),
        )


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
