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

    # ── OpenAI Whisper STT ───────────────────────────────────────────────────
    openai_api_key: str = Field(..., description="OpenAI API key for Whisper STT")
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

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis_url: str = Field(
        default="redis://localhost:6379",
        description="Redis connection string",
    )

    # ── Service ────────────────────────────────────────────────────────────────
    port: int = Field(default=3002, description="HTTP listen port")
    log_level: str = Field(default="info", description="Logging level")


# Module-level singleton
settings = Settings()
