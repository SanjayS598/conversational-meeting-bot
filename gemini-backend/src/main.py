"""
Gemini Realtime Intelligence Service — FastAPI application entry point.

Wires together all components and starts the HTTP server.

Architecture:
  FastAPI app
    ├── /brain/sessions/* routes
    ├── GeminiProvider  (AI adapter)
    ├── SessionManager  (Redis-backed session state)
    ├── AudioProcessor  (live audio ingestion hot path)
    ├── StateUpdater    (LangGraph pipeline orchestrator)
    ├── BackendClient   (Control Backend HTTP calls)
    └── VoiceClient     (Voice Runtime HTTP calls)
"""

from __future__ import annotations

import logging
import sys

import redis.asyncio as aioredis
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .clients.backend import BackendClient
from .clients.voice import VoiceClient
from .config import settings
from .pipeline.audio_processor import AudioProcessor
from .pipeline.state_updater import StateUpdater
from .providers.gemini import GeminiProvider
from .routes.sessions import router as sessions_router
from .sessions.manager import SessionManager


def configure_logging() -> None:
    """Configure structured JSON logging via structlog."""
    logging.basicConfig(
        stream=sys.stdout,
        level=settings.log_level.upper(),
        format="%(message)s",
    )
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelName(settings.log_level.upper())
        ),
    )


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title="Gemini Realtime Intelligence Service",
        description=(
            "Core AI brain for the meeting agent. "
            "Transcribes live audio, maintains meeting state, "
            "and generates spoken reply candidates via Gemini."
        ),
        version="1.0.0",
    )

    # CORS — restrict in production to known origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Startup ───────────────────────────────────────────────────────────────

    @app.on_event("startup")
    async def on_startup() -> None:
        logger = structlog.get_logger()

        # Redis — fail fast if unavailable
        redis_client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=False,
        )
        try:
            await redis_client.ping()
            logger.info("Redis connected", url=settings.redis_url)
        except Exception as exc:
            logger.error("Redis unavailable — cannot start", error=str(exc))
            raise RuntimeError(f"Redis unavailable: {exc}") from exc

        # Build components
        provider = GeminiProvider(
            api_key=settings.gemini_api_key,
            whisper_model=settings.whisper_model,
            whisper_device=settings.whisper_device,
            whisper_compute_type=settings.whisper_compute_type,
        )
        session_manager = SessionManager(redis_client)
        backend_client = BackendClient(
            base_url=settings.backend_url,
            service_token=settings.internal_service_token,
        )
        voice_client = VoiceClient(
            base_url=settings.voice_runtime_url,
            service_token=settings.internal_service_token,
        )
        state_updater = StateUpdater(provider, session_manager, backend_client)
        audio_processor = AudioProcessor(
            provider=provider,
            session_manager=session_manager,
            on_segment_ready=lambda seg: state_updater.process(seg.session_id, seg),
        )

        # Attach to app.state so routes can access via request.app.state.*
        app.state.redis = redis_client
        app.state.provider = provider
        app.state.session_manager = session_manager
        app.state.backend_client = backend_client
        app.state.voice_client = voice_client
        app.state.state_updater = state_updater
        app.state.audio_processor = audio_processor

        logger.info("Gemini Intelligence Service started", port=settings.port)

    # ── Shutdown ──────────────────────────────────────────────────────────────

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        logger = structlog.get_logger()
        logger.info("Shutting down Gemini Intelligence Service")

        try:
            await app.state.backend_client.aclose()
        except Exception:
            pass

        try:
            await app.state.voice_client.aclose()
        except Exception:
            pass

        try:
            await app.state.redis.aclose()
        except Exception:
            pass

    # ── Routes ────────────────────────────────────────────────────────────────

    app.include_router(sessions_router)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "service": "gemini-intelligence"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=settings.port,
        log_level=settings.log_level.lower(),
        reload=False,
    )
