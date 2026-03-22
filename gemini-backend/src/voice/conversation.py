"""Gemini-powered conversational AI adapted from zoom-agent/backend/gemini.py."""

from __future__ import annotations

import logging
from typing import Optional

from google import genai
from google.genai import types

from ..config import settings

logger = logging.getLogger(__name__)

_MAX_HISTORY_ITEMS = 12
_MAX_CONTEXT_CHARS = 3500

# Per-session Gemini history
_sessions: dict[str, list[types.Content]] = {}

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
    recent_transcript: Optional[str] = None,
) -> str:
    """Generate a spoken reply using recent speaker-labeled meeting context."""
    if session_id not in _sessions:
        return ""

    display_name = _display_names.get(session_id, "Agent")
    context = _contexts.get(session_id, "")
    history = _sessions[session_id]
    latest_speaker = (speaker or "Participant").strip() or "Participant"

    system_prompt = f"""You are {display_name} in a live Zoom conversation.

YOUR CONTEXT:
{context[:_MAX_CONTEXT_CHARS]}

STRICT RULES:
- Speak ONLY in first person as {display_name}
- MAXIMUM 3000 characters per response — never more, no exceptions
- This is spoken audio — be natural, conversational, complete, and socially engaged
- Respond directly to the latest speaker's actual message, not with a generic summary
- Use specific details from the recent conversation when they are relevant
- It is okay to give a full answer or add one brief follow-up question when that helps the conversation
- Keep spoken delivery concise enough to sound natural live, but do not be artificially terse
- Never use bullet points, numbered lists, markdown, or slide references
- Never say things like \"(moves to slide X)\" or \"(presenting now)\"
- Never reveal you are an AI
- If asked something outside your context say \"let me think on that and get back to you\"
- Match the other person's energy
"""

    if recent_transcript:
        user_text = (
            f"Recent conversation:\n{recent_transcript}\n\n"
            f"Latest message from {latest_speaker}: {transcript}"
        )
    else:
        user_text = f"Latest message from {latest_speaker}: {transcript}"

    history.append(types.Content(role="user", parts=[types.Part(text=user_text)]))

    try:
        response = _client.models.generate_content(
            model="gemini-2.5-flash",
            contents=history,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.80,
                max_output_tokens=768,
            ),
        )
        reply = response.text.strip()

        history.append(types.Content(role="model", parts=[types.Part(text=reply)]))
        _sessions[session_id] = history[-_MAX_HISTORY_ITEMS:]

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
        if history and history[-1].role == "user":
            history.pop()
        return "Sorry, could you say that again?"


def generate_greeting(display_name: str, context: str) -> str:
    """Generate an unrestricted greeting using the sample zoom-agent prompt style."""
    prompt = f"""You are about to join a Zoom meeting as {display_name}.

Here is your full context and materials for the meeting:
{context}

Write a natural, warm introduction you would say when joining.
Reference the actual content/topic you're here to discuss.
Sound human and conversational — NOT robotic.
Do not artificially shorten yourself; give the full introduction naturally.
Just the spoken words, no stage directions."""
    try:
        response = _client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[{"role": "user", "parts": [{"text": prompt}]}],
            config=types.GenerateContentConfig(temperature=0.8, max_output_tokens=1024),
        )
        return response.text.strip()
    except Exception as exc:
        logger.error("Greeting generation failed: %s", exc)
        return f"Hi everyone, I'm {display_name}. Happy to be here."
