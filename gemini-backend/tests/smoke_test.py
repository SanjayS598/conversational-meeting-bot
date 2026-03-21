"""
Smoke test for the Gemini Intelligence Service.

Tests every endpoint in order:
  1. GET  /health
  2. POST /brain/sessions/{id}/start
  3. GET  /brain/sessions/{id}/context
  4. WS   /brain/sessions/{id}/audio  (sends 2s of synthetic PCM)
  5. GET  /brain/sessions/{id}/notes
  6. POST /brain/sessions/{id}/respond  (if a candidate is pending)

Prerequisites:
  - gemini-backend is running on port 3001  (make dev)
  - Redis is running on port 6379           (make redis  OR  docker-compose up redis)
  - Mock services running on 4000/5000      (make mock)

Usage:
    python tests/smoke_test.py
"""

from __future__ import annotations

import asyncio
import math
import struct
import sys
import uuid

import httpx
import websockets

BASE_URL = "http://localhost:3001"
WS_BASE = "ws://localhost:3001"

# ─── PCM audio generation ─────────────────────────────────────────────────────


def generate_pcm_tone(
    duration_seconds: float = 2.0,
    freq_hz: float = 440.0,
    sample_rate: int = 16_000,
) -> bytes:
    """
    Generate a simple sine-wave tone as 16-bit PCM, 16 kHz mono.
    This is the exact format Gemini Live expects.
    """
    n_samples = int(duration_seconds * sample_rate)
    frames = []
    for i in range(n_samples):
        sample = int(32767 * math.sin(2 * math.pi * freq_hz * i / sample_rate))
        frames.append(struct.pack("<h", sample))  # signed 16-bit little-endian
    return b"".join(frames)


# ─── Test steps ──────────────────────────────────────────────────────────────

PASS = "✓"
WARN = "⚠"
FAIL = "✗"


def ok(msg: str) -> None:
    print(f"  {PASS}  {msg}")


def warn(msg: str) -> None:
    print(f"  {WARN}  {msg}", file=sys.stderr)


def fail(msg: str) -> None:
    print(f"  {FAIL}  {msg}", file=sys.stderr)
    sys.exit(1)


async def run() -> None:
    session_id = str(uuid.uuid4())
    print(f"\nSmoke test — session_id: {session_id}\n")

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as client:

        # ── 1. Health check ────────────────────────────────────────────────────
        print("1. Health check")
        r = await client.get("/health")
        if r.status_code != 200:
            fail(f"Health check failed: {r.status_code} {r.text}")
        ok(f"Service is up: {r.json()}")

        # ── 2. Start session ───────────────────────────────────────────────────
        print("\n2. Start session")
        r = await client.post(
            f"/brain/sessions/{session_id}/start",
            json={
                "mode": "suggest",
                "user_tone": "professional",
                "meeting_objective": "Discuss the Q1 product roadmap and assign action items.",
                "prep_notes": "We want to launch Feature X by end of Q1. Budget is approved.",
                "allowed_topics": ["roadmap", "feature X", "budget", "deadlines"],
                "response_policy": {
                    "min_confidence": 0.6,
                    "max_speak_seconds": 15,
                    "cooldown_ms": 5000,
                },
            },
        )
        if r.status_code != 200:
            fail(f"Start session failed: {r.status_code} {r.text}")
        data = r.json()
        ok(f"Session created — status: {data['status']}")

        # ── 3. Get context ─────────────────────────────────────────────────────
        print("\n3. Get session context")
        r = await client.get(f"/brain/sessions/{session_id}/context")
        if r.status_code != 200:
            fail(f"Get context failed: {r.status_code} {r.text}")
        ctx = r.json()
        ok(f"mode={ctx['config']['mode']}  objective='{ctx['config']['meeting_objective'][:40]}...'")

        # ── 4. Stream audio via WebSocket ─────────────────────────────────────
        print("\n4. Stream audio (2s PCM tone via WebSocket)")
        pcm_audio = generate_pcm_tone(duration_seconds=2.0)
        chunk_size = 3200  # 100ms @ 16 kHz 16-bit mono
        num_chunks = len(pcm_audio) // chunk_size
        print(f"     Sending {len(pcm_audio):,} bytes in {num_chunks} chunks...")

        ws_url = f"{WS_BASE}/brain/sessions/{session_id}/audio"
        audio_ok = False
        try:
            async with websockets.connect(ws_url, ping_interval=None) as ws:
                for i in range(0, len(pcm_audio), chunk_size):
                    chunk = pcm_audio[i : i + chunk_size]
                    await ws.send(chunk)
                    await asyncio.sleep(0.05)  # pace the chunks at ~real-time rate

                # Send stop control message
                await ws.send('{"type": "stop"}')
                await asyncio.sleep(0.5)

            audio_ok = True
            ok("Audio stream completed and session ended")
        except Exception as exc:
            warn(f"Audio stream error (partial): {exc}")
            warn("This may be a Gemini Live API quota or connectivity issue.")
            warn("The rest of the test will continue — state endpoints should still work.")

        # Give the pipeline a moment to process any in-flight segments
        print("     Waiting 2s for pipeline to settle...")
        await asyncio.sleep(2)

        # ── 5. Get notes ───────────────────────────────────────────────────────
        print("\n5. Get meeting notes")
        r = await client.get(f"/brain/sessions/{session_id}/notes")
        if r.status_code != 200:
            fail(f"Get notes failed: {r.status_code} {r.text}")
        notes = r.json()
        ms = notes["meeting_state"]
        ok(
            f"transcript_count={notes['transcript_count']}  "
            f"topic='{ms.get('current_topic', '(none)') or '(none)'}'"
        )
        ok(
            f"decisions={len(ms.get('decisions', []))}  "
            f"open_questions={len(ms.get('open_questions', []))}  "
            f"action_items={len(ms.get('action_items', []))}"
        )

        pending = notes.get("pending_response")
        if pending:
            print(f"\n     Pending response detected!")
            print(f"     Text:     {pending['text']}")
            print(f"     Priority: {pending['priority']}")
            print(f"     Confidence: {pending['confidence']}")

            # ── 6. Approve the response ────────────────────────────────────────
            print("\n6. Approve pending response")
            r = await client.post(
                f"/brain/sessions/{session_id}/respond",
                json={"approved": True},
            )
            if r.status_code == 200:
                res = r.json()
                ok(f"spoken={res['spoken']}  text='{(res.get('text') or '')[:60]}'")
            elif r.status_code == 503:
                warn(f"Voice Runtime unavailable (expected if mock_services.py not running): {r.text}")
            else:
                fail(f"Respond failed: {r.status_code} {r.text}")
        else:
            print("\n6. No pending response (expected for silent/short audio)")
            ok("Skipping approve step")

    print(f"\n{'─' * 50}")
    print(f"  Smoke test complete!\n")


if __name__ == "__main__":
    asyncio.run(run())
