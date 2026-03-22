"""
Gemini-powered conversational AI for the meeting agent.

Maintains per-session conversation history and uses document context (from
/voice/prepare) to generate short, spoken-style replies.

This mirrors zoom-agent/backend/gemini.py but is adapted to the
conversational-meeting-bot architecture.
"""

from __future__ import annotations

import logging
from typing import Optional

from google import genai
from google.genai import types

from ..config import settings

logger = logging.getLogger(__name__)

# Per-session conversation history: session_id → list of {role, parts}
_sessions: dict[str, list[dict]] = {}

# Per-session context (from prep): session_id → context string
_contexts: dict[str, str] = {}

# Per-session bot display name: session_id → display_name
_display_names: dict[str, str] = {}

_client = genai.Client(api_key=settings.gemini_api_key)


def attach_session(
    session_id: str,
    display_name: str,
    context: str,
) -> None:
    """Register a conversational session with its persona and document context."""
    _sessions[session_id] = []
    _contexts[session_id] = context
    _display_names[session_id] = display_name
    logger.info(
        "Conversational session attached session_id=%s display_name=%s context_len=%d",
        session_id,
        display_name,
        len(context),
    )


def detach_session(session_id: str) -> None:
    """Remove session state when the meeting ends."""
    _sessions.pop(session_id, None)
    _contexts.pop(session_id, None)
    _display_names.pop(session_id, None)


def is_attached(session_id: str) -> bool:
    """Return True if this session has a conversational AI attached."""
    return session_id in _sessions


def get_response(
    session_id: str,
    transcript: str,
    speaker: Optional[str] = None,
) -> str:
    """Generate a conversational reply for *transcript* spoken by *speaker*.

    Returns a safe fallback string on any error.
    """
    if session_id not in _sessions:
        return ""

    display_name = _display_names.get(session_id, "Agent")
    context = _contexts.get(session_id, "")
    history = _sessions[session_id]

    system_prompt = (
        f"You are {display_name}, an AI participant in a Zoom meeting. "
        f"Your role is to participate naturally and helpfully. "
        f"Keep your responses SHORT — 1-2 sentences maximum, suitable for spoken audio. "
        f"Never use markdown, bullet points, or lists. Speak in a professional, conversational tone. "
        f"Do not repeat yourself. "
        f"If you don't have relevant information, say so briefly.\n\n"
        f"Context / background:\n{context[:4000]}"
    )

    if speaker:
        user_text = f"{speaker} says: {transcript}"
    else:
        user_text = transcript

    # Build contents list: system prompt + conversation history + new user turn
    contents = []
    for turn in history:
        role = turn["role"]
        parts = [types.Part.from_text(text=p) for p in turn["parts"]]
        contents.append(types.Content(role=role, parts=parts))
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=user_text)]))

    history.append({"role": "user", "parts": [user_text]})

    try:
        response = _client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.7,
                max_output_tokens=200,
            ),
        )
        reply = response.text.strip()

        # Enforce length limit (~300 chars ≈ 2 sentences)
        if len(reply) > 300:
            # Truncate at the last sentence boundary within 300 chars
            for i in range(300, 0, -1):
                if reply[i - 1] in ".!?":
                    reply = reply[:i]
                    break
            else:
                reply = reply[:300]

        history.append({"role": "model", "parts": [reply]})

        # Keep history manageable (last 20 turns = 10 exchanges)
        if len(history) > 20:
            _sessions[session_id] = history[-20:]

        logger.info(
            "Conversational response generated session_id=%s len=%d",
            session_id,
            len(reply),
        )
        return reply

    except Exception as exc:
        logger.error(
            "Conversational Gemini error session_id=%s: %s", session_id, exc
        )
        # Remove the failed user turn so history stays clean
        if history and history[-1]["role"] == "user":
            history.pop()
        return "Sorry, could you say that again?"


def generate_greeting(display_name: str, context: str) -> str:
    """Generate a short greeting for the agent to speak when joining the meeting."""
    prompt = (
        f"You are {display_name}, an AI participant about to join a Zoom meeting. "
        f"Write a natural, friendly 1-2 sentence greeting — just the spoken words, no formatting. "
        f"Mention who you are and briefly what you're there to help with based on this context:\n\n"
        f"{context[:2000]}"
    )
    try:
        response = _client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0.7, max_output_tokens=150),
        )
        return response.text.strip()
    except Exception as exc:
        logger.error("Greeting generation failed: %s", exc)
        return f"Hi everyone, I'm {display_name}. Happy to be here."
