"""
Preloader — stores document context and pre-rendered greetings in memory.

When POST /voice/prepare is called, this module:
  1. Receives extracted text from documents
  2. Builds a context string (personal notes + all documents)
  3. Pre-generates a greeting via Gemini
  4. Pre-renders the greeting to PCM audio via ElevenLabs
  5. Stores everything under a prep_id for fast retrieval at meeting start

Adapted from zoom-agent/backend/preloader.py.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# Max characters kept per document to avoid prompt explosion
_MAX_DOC_CHARS = 8_000

# In-memory stores (single-process; fine for the typical single-server deploy)
_prep_contexts: dict[str, str] = {}   # prep_id → context string
_prep_greetings: dict[str, str] = {}  # prep_id → greeting text
_prep_audio: dict[str, bytes] = {}    # prep_id → greeting PCM bytes


@dataclass
class PrepResult:
    prep_id: str
    greeting: str
    docs: list[str] = field(default_factory=list)
    context_length: int = 0


def build_context(
    personal_notes: str,
    documents: list[tuple[str, str]],  # [(filename, extracted_text), ...]
) -> str:
    """Combine personal notes and document texts into a single context string."""
    parts: list[str] = []

    if personal_notes.strip():
        parts.append(f"Personal notes:\n{personal_notes.strip()}")

    for filename, text in documents:
        trimmed = text.strip()[:_MAX_DOC_CHARS]
        if trimmed:
            parts.append(f"--- {filename} ---\n{trimmed}")

    return "\n\n".join(parts)


async def prepare(
    display_name: str,
    personal_notes: str,
    documents: list[tuple[str, str]],  # [(filename, extracted_text), ...]
) -> PrepResult:
    """Build context, pre-generate greeting text and audio.

    This is called from the /voice/prepare route and runs in the request handler.
    Heavy work (Gemini + ElevenLabs) is done synchronously inside executor threads
    via the calling async route handler.
    """
    from .conversation import generate_greeting
    from .tts import text_to_speech_pcm

    prep_id = str(uuid.uuid4())
    doc_names = [fname for fname, _ in documents]

    context = build_context(personal_notes, documents)
    _prep_contexts[prep_id] = context

    # Pre-generate greeting text
    try:
        greeting = generate_greeting(display_name, context)
    except Exception as exc:
        logger.warning("Greeting text generation failed: %s", exc)
        greeting = f"Hi everyone, I'm {display_name}. Ready to help."

    _prep_greetings[prep_id] = greeting

    # Pre-render greeting audio (best-effort — meeting still works without it)
    try:
        audio_pcm = text_to_speech_pcm(greeting)
        _prep_audio[prep_id] = audio_pcm
        logger.info(
            "Greeting audio pre-rendered prep_id=%s bytes=%d", prep_id, len(audio_pcm)
        )
    except Exception as exc:
        logger.warning("Greeting audio pre-render failed prep_id=%s: %s", prep_id, exc)

    return PrepResult(
        prep_id=prep_id,
        greeting=greeting,
        docs=doc_names,
        context_length=len(context),
    )


def get_context(prep_id: str) -> Optional[str]:
    """Return the context string for *prep_id*, or None if not found."""
    return _prep_contexts.get(prep_id)


def get_greeting_text(prep_id: str) -> Optional[str]:
    """Return the pre-generated greeting text, or None."""
    return _prep_greetings.get(prep_id)


def get_greeting_audio(prep_id: str) -> Optional[bytes]:
    """Return the pre-rendered greeting PCM bytes, or None."""
    return _prep_audio.get(prep_id)


def clear(prep_id: str) -> None:
    """Free stored prep data after it has been consumed."""
    _prep_contexts.pop(prep_id, None)
    _prep_greetings.pop(prep_id, None)
    _prep_audio.pop(prep_id, None)
    logger.debug("Cleared prep_id=%s", prep_id)
