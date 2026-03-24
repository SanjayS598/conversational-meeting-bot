"""
Application configuration via pydantic-settings.

Reads from environment variables and the .env file.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Google Gemini ──────────────────────────────────────────────────────────
    gemini_api_key: str = Field(..., description="Google AI Studio API key")

    # ── Deepgram streaming STT (preferred — instant transcription) ────────────
    # If set, Deepgram Nova-2 streaming is used instead of Whisper batch.
    deepgram_api_key: str = Field(
        default="",
        description="Deepgram API key for Nova-2 streaming STT (optional; falls back to Whisper)",
    )

    # ── OpenAI Whisper STT (fallback when no Deepgram key) ───────────────────
    openai_api_key: str = Field(default="", description="OpenAI API key for Whisper STT fallback")
    whisper_model: str = Field(default="whisper-1", description="OpenAI Whisper model name")

    # ── Internal Auth ─────────────────────────────────────────────────────────
    internal_service_token: str = Field(
        ..., description="Shared service-to-service bearer token"
    )

    # ── Control Backend ────────────────────────────────────────────────────────
    backend_url: str = Field(
        default="http://localhost:3000",
        description="Control Backend (ui-auth Next.js) base URL",
    )

    # ── Voice Runtime ──────────────────────────────────────────────────────────────
    voice_runtime_url: str = Field(
        default="http://localhost:8083",
        description="Voice Runtime (voice-cloning) base URL",
    )

    # ── Zoom Gateway (for audio injection) ────────────────────────────────────
    zoom_gateway_url: str = Field(
        default="http://localhost:3001",
        description="Zoom Gateway base URL (used to inject synthesised speech)",
    )

    # ── ElevenLabs TTS ────────────────────────────────────────────────────────
    elevenlabs_api_key: str = Field(
        default="",
        description="ElevenLabs API key for voice synthesis",
    )
    elevenlabs_voice_id: str = Field(
        default="",
        description="ElevenLabs voice ID to use for the agent",
    )

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis_url: str = Field(
        default="redis://localhost:6379",
        description="Redis connection string",
    )

    # ── Service ────────────────────────────────────────────────────────────────
    port: int = Field(default=3002, description="HTTP listen port")
    log_level: str = Field(default="info", description="Logging level")
    cors_allowed_origins: str = Field(
        default="",
        description="Comma-separated origins allowed for browser access; leave blank for internal-only service",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]


# Module-level singleton
settings = Settings()
