"""
ElevenLabs Text-to-Speech service.

Converts text to PCM audio bytes (16 kHz, mono, int16 little-endian) which
can be sent directly to the zoom-gateway audio-out WebSocket.

Uses ElevenLabs `pcm_16000` output format to avoid any MP3 decoding step.
Chunks long texts at word boundaries to stay within ElevenLabs limits, then
concatenates the raw PCM bytes.
"""

from __future__ import annotations

import logging

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

_CHUNK_WORDS = 50  # max words per ElevenLabs request
_ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech"
_OUTPUT_FORMAT = "pcm_16000"  # 16-bit PCM, 16 kHz, mono — matches zoom-gateway format


def text_to_speech_pcm(text: str) -> bytes:
    """Convert *text* to raw PCM bytes (16 kHz, mono, int16 LE).

    Automatically splits long texts into 50-word chunks and concatenates the
    PCM output so the caller gets a single continuous audio stream.

    Raises:
        RuntimeError: if ElevenLabs API returns an error or config is missing.
    """
    if not settings.elevenlabs_api_key or not settings.elevenlabs_voice_id:
        raise RuntimeError(
            "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set in .env"
        )

    words = text.split()
    chunks: list[str] = []
    for i in range(0, len(words), _CHUNK_WORDS):
        chunk = " ".join(words[i : i + _CHUNK_WORDS]).strip()
        if chunk:
            chunks.append(chunk)

    if not chunks:
        return b""

    pcm_parts: list[bytes] = []
    for chunk in chunks:
        pcm_parts.append(_render_single(chunk))

    return b"".join(pcm_parts)


def _render_single(text: str) -> bytes:
    """Render a single text chunk via ElevenLabs and return PCM bytes."""
    url = f"{_ELEVENLABS_API_URL}/{settings.elevenlabs_voice_id}"
    headers = {
        "xi-api-key": settings.elevenlabs_api_key,
        "Content-Type": "application/json",
        "Accept": "audio/wav",  # ElevenLabs returns raw PCM with wav header for pcm_*
    }
    payload = {
        "text": text,
        "model_id": "eleven_monolingual_v1",
        "voice_settings": {
            "stability": 0.75,
            "similarity_boost": 0.90,
        },
    }
    params = {"output_format": _OUTPUT_FORMAT}

    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, json=payload, params=params)

    if resp.status_code != 200:
        raise RuntimeError(
            f"ElevenLabs API error {resp.status_code}: {resp.text[:300]}"
        )

    raw = resp.content

    # ElevenLabs pcm_16000 may return with a WAV header — strip it if present.
    if raw[:4] == b"RIFF":
        # WAV header is 44 bytes; skip to PCM data
        raw = raw[44:]

    logger.debug("ElevenLabs rendered %d PCM bytes for %d chars", len(raw), len(text))
    return raw
