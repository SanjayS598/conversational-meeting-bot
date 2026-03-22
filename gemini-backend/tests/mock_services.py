"""
Mock services for local development testing.

Runs two lightweight FastAPI apps that stand in for services that don't exist yet:
  - Mock Control Backend  → port 4000
  - Mock Voice Runtime    → port 5000

Both just accept every call, log what they receive, and return 200 OK.
This lets gemini-backend run without errors from outbound HTTP failures.

Usage:
    python tests/mock_services.py
"""

from __future__ import annotations

import threading
import uvicorn
from fastapi import FastAPI, Request
import json

# ─── Mock Control Backend (port 4000) ─────────────────────────────────────────

backend_app = FastAPI(title="Mock Control Backend")


@backend_app.post("/sessions/{session_id}/transcript")
async def save_transcript(session_id: str, request: Request) -> dict:
    data = await request.json()
    speaker = data.get("speaker_label", "?")
    text = data.get("text", "")[:80]
    print(f"  [Backend] transcript  [{speaker}]: {text}")
    return {"ok": True}


@backend_app.post("/sessions/{session_id}/state")
async def save_state(session_id: str, request: Request) -> dict:
    data = await request.json()
    topic = data.get("current_topic", "(none)")
    decisions = len(data.get("decisions", []))
    actions = len(data.get("action_items", []))
    print(f"  [Backend] state       topic='{topic}' decisions={decisions} actions={actions}")
    return {"ok": True}


@backend_app.post("/sessions/{session_id}/response-ready")
async def response_ready(session_id: str, request: Request) -> dict:
    data = await request.json()
    text = data.get("text", "")
    priority = data.get("priority", "?")
    print(f"  [Backend] response    priority={priority}: '{text}'")
    return {"ok": True}


@backend_app.get("/users/{user_id}/config")
async def get_user_config(user_id: str):
    print(f"  [Backend] user config requested for user_id={user_id}")
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=404, content={"detail": "User not found"})


@backend_app.get("/health")
async def backend_health() -> dict:
    return {"status": "ok", "service": "mock-control-backend"}


# ─── Mock Voice Runtime (port 5000) ───────────────────────────────────────────

voice_app = FastAPI(title="Mock Voice Runtime")


@voice_app.post("/voice/speak")
async def speak(request: Request) -> dict:
    data = await request.json()
    text = data.get("text", "")
    max_s = data.get("max_speak_seconds", "?")
    print(f"  [Voice]   speak       ({max_s}s): '{text}'")
    return {"ok": True, "queued": True}


@voice_app.get("/health")
async def voice_health() -> dict:
    return {"status": "ok", "service": "mock-voice-runtime"}


# ─── Runner ───────────────────────────────────────────────────────────────────

def _run(app: FastAPI, port: int) -> None:
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    t1 = threading.Thread(target=_run, args=(backend_app, 4000), daemon=True)
    t2 = threading.Thread(target=_run, args=(voice_app, 5001), daemon=True)

    t1.start()
    t2.start()

    print("Mock services running:")
    print("  Control Backend  → http://localhost:4000")
    print("  Voice Runtime    → http://localhost:5001")
    print("\nPress Ctrl+C to stop.\n")

    try:
        t1.join()
    except KeyboardInterrupt:
        print("\nStopping mock services.")
