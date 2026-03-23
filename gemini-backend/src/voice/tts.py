"""ElevenLabs Text-to-Speech helpers for Recall.ai audio injection."""

from __future__ import annotations

import base64
import logging

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

_CHUNK_WORDS = 50  # max words per ElevenLabs request
_ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech"
_OUTPUT_FORMAT = "mp3_44100_128"
_ELEVENLABS_MODEL = "eleven_monolingual_v1"


def text_to_speech_mp3_b64(text: str, voice_id: str | None = None) -> str:
    """Convert text to base64-encoded MP3 audio for Recall.ai output_audio."""
    if not settings.elevenlabs_api_key or not settings.elevenlabs_voice_id:
        raise RuntimeError(
            "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set in .env"
        )

    words = text.split()
    if len(words) <= _CHUNK_WORDS:
        return base64.b64encode(_render_single_mp3(text, voice_id)).decode("ascii")

    chunks: list[str] = []
    current: list[str] = []
    for word in words:
        current.append(word)
        if len(current) >= _CHUNK_WORDS and word[-1] in ".!?…":
            chunks.append(" ".join(current))
            current = []

    if current:
        chunks.append(" ".join(current))

    if not chunks:
        return ""

    mp3_parts: list[bytes] = []
    for chunk in chunks:
        mp3_parts.append(_render_single_mp3(chunk, voice_id))

    return base64.b64encode(b"".join(mp3_parts)).decode("ascii")


def _render_single_mp3(text: str, voice_id: str | None = None) -> bytes:
    """Render a single text chunk via ElevenLabs and return MP3 bytes."""
    effective_voice_id = voice_id or settings.elevenlabs_voice_id
    url = f"{_ELEVENLABS_API_URL}/{effective_voice_id}"
    headers = {
        "xi-api-key": settings.elevenlabs_api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": _ELEVENLABS_MODEL,
        "voice_settings": {
            "stability": 0.75,
            "similarity_boost": 0.90,
        },
    }
    params = {"output_format": _OUTPUT_FORMAT}

    logger.info(
        "ElevenLabs render voice_id=%s model=%s chars=%d",
        effective_voice_id,
        _ELEVENLABS_MODEL,
        len(text),
    )

    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, json=payload, params=params)

    if resp.status_code != 200:
        raise RuntimeError(
            f"ElevenLabs API error {resp.status_code}: {resp.text[:300]}"
        )

    raw = resp.content

    logger.debug("ElevenLabs rendered %d MP3 bytes for %d chars", len(raw), len(text))
    return raw
