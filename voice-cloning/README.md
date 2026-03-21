# Voice Cloning Service

This folder now contains a self-contained voice runtime for part 3 of your hackathon project:

- voice enrollment
- sample storage
- ElevenLabs instant voice cloning
- TTS generation in the cloned voice
- single-session speech queueing
- speech cancel and interrupt handling
- placeholder delivery to the meeting gateway
- placeholder event delivery to the control backend

It runs in two modes:

- live mode: real ElevenLabs API calls if `ELEVENLABS_API_KEY` is set
- mock mode: no external API calls, but all routes, storage, queueing, and placeholder outputs still work

## API Keys And Secrets To Collect First

For your voice component only, collect these before real integration:

1. `ELEVENLABS_API_KEY`
   Required for real voice cloning and real text-to-speech.
   Official docs say ElevenLabs API requests authenticate with `xi-api-key`, and the clone flow uses `POST /v1/voices/add`.
   Sources:
   - https://elevenlabs.io/docs/api-reference
   - https://elevenlabs.io/docs/cookbooks/text-to-speech

2. `INTERNAL_BACKEND_AUTH_TOKEN`
   Required for service-to-service authentication inside your own project.
   This is not vendor-issued. You generate it yourself and share it with your teammates' services.

3. `CONTROL_BACKEND_BASE_URL`
   Not an API key, but needed later so this service can send voice status events to the main backend.
   Leave blank for now and the service will write local placeholder event files instead.

4. `MEETING_GATEWAY_BASE_URL`
   Not an API key, but needed later so this service can send synthesized audio to the Zoom gateway.
   Leave blank for now and the service will write local placeholder delivery files instead.

Optional later:

5. `OPENAI_API_KEY`
   Not required for this folder as implemented.
   Only needed if your team later adds OpenAI-based audio features.

## External Setup Before Coding

### 1. Set up ElevenLabs correctly

What matters:

- Use Instant Voice Cloning for the hackathon.
- ElevenLabs help docs currently distinguish Instant Voice Cloning from Professional Voice Cloning.
- Their docs and help center indicate Starter or higher is the practical tier for API usage and instant cloning.

Sources:

- https://help.elevenlabs.io/hc/en-us/sections/23821115950481-Voice-Cloning
- https://elevenlabs.io/docs/cookbooks/text-to-speech

### 2. Create the ElevenLabs API key

Steps:

1. Sign in to ElevenLabs.
2. Open the API or developer area in the dashboard.
3. Create a new API key.
4. Copy it immediately.
5. Put it in `voice-cloning/.env` as `ELEVENLABS_API_KEY=...`

### 3. Prepare your voice samples correctly

Practical sample guidance from ElevenLabs help docs:

- use one speaker only
- keep background noise low
- use clear speech
- aim for roughly 1 to 2 minutes of usable audio
- use consistent microphone quality

Sources:

- https://help.elevenlabs.io/hc/en-us/articles/13440435385105-What-files-do-you-accept-for-voice-cloning
- https://help.elevenlabs.io/hc/en-us/articles/13416206830097-Are-there-any-tips-to-get-good-quality-cloned-voices

### 4. Create the internal auth token

Generate one shared service secret for your hackathon stack:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the generated value into:

- `voice-cloning/.env`
- the control backend teammate's env
- the zoom gateway teammate's env

Use the same key name everywhere:

```env
INTERNAL_BACKEND_AUTH_TOKEN=your-long-random-secret
```

### 5. Ask your teammates for two integration URLs

You do not need these to start local development:

- `CONTROL_BACKEND_BASE_URL`
- `MEETING_GATEWAY_BASE_URL`

Until then, this service writes local JSON files into `storage/events/`.

## Local Setup

### 1. Create `.env`

Copy `.env.example` to `.env` and fill the values you already have.

Minimum example:

```env
PORT=8083
ELEVENLABS_API_KEY=
INTERNAL_BACKEND_AUTH_TOKEN=replace-me
CONTROL_BACKEND_BASE_URL=
MEETING_GATEWAY_BASE_URL=
DEFAULT_TTS_MODEL=eleven_flash_v2_5
DEFAULT_OUTPUT_FORMAT=mp3_44100_128
DEFAULT_LANGUAGE_CODE=en
MAX_SPEECH_CHARACTERS=500
SPEECH_COOLDOWN_MS=5000
```

If `ELEVENLABS_API_KEY` is blank, the service still runs in mock mode.

### 2. Start the service

```powershell
node src/server.js
```

Or during development:

```powershell
node --watch src/server.js
```

The service listens on `http://localhost:8083` by default.

## Route Contract

All routes require:

```http
Authorization: Bearer <INTERNAL_BACKEND_AUTH_TOKEN>
Content-Type: application/json
```

If `INTERNAL_BACKEND_AUTH_TOKEN` is blank, auth is skipped for local setup.

### `POST /voices/enroll`

```json
{
  "user_id": "user_123",
  "display_name": "Nathan Voice",
  "description": "Hackathon meeting assistant voice clone",
  "labels": {
    "accent": "american",
    "language": "en"
  },
  "consent_confirmed": true,
  "remove_background_noise": false
}
```

### `POST /voices/:id/sample`

```json
{
  "sample_name": "sample-1.mp3",
  "mime_type": "audio/mpeg",
  "audio_base64": "BASE64_AUDIO_HERE",
  "notes": "quiet room sample"
}
```

### `POST /voices/:id/finalize`

Creates the ElevenLabs voice clone in live mode, or a mock provider voice in mock mode.

### `GET /voices/:id`

Returns the stored `VoiceProfile`.

### `GET /users/:user_id/voices`

Returns all stored voice profiles for one user.

### `GET /users/:user_id/voices/default`

Returns the most recently updated ready voice profile for that user.
This is the easiest lookup endpoint for teammate services.

### `POST /voices/preview`

```json
{
  "voice_profile_id": "voice_...",
  "text": "This is a quick preview of my cloned voice."
}
```

### `POST /runtime/sessions/:id/speak`

```json
{
  "voice_profile_id": "voice_...",
  "text": "Thanks everyone. I agree with the proposed next step.",
  "priority": 5,
  "urgent": false
}
```

### `POST /internal/runtime/sessions/:id/respond`

This is the simplest teammate-facing speech endpoint.
Use it from the intelligence service or control backend.

If you already know the exact voice profile:

```json
{
  "voice_profile_id": "voice_...",
  "text": "Thanks everyone. I agree with the proposed next step.",
  "priority": 5,
  "urgent": false
}
```

If you only know the app user:

```json
{
  "user_id": "user_123",
  "text": "Thanks everyone. I agree with the proposed next step.",
  "priority": 5,
  "urgent": false
}
```

In the `user_id` form, the service automatically resolves that user's default ready voice profile.

### `POST /runtime/sessions/:id/cancel`

```json
{
  "reason": "Another participant started speaking."
}
```

### `GET /runtime/sessions/:id/state`

Returns the current runtime state and queued jobs for that session.

## What This Service Already Handles

- voice profile creation
- consent tracking
- sample storage on disk
- ElevenLabs clone creation
- speech preview generation
- one active speech job at a time
- priority queueing
- cancellation and interruption state
- latency timestamps on each speech job
- placeholder delivery output for the meeting gateway
- placeholder status event output for the control backend

## What Is Still Placeholder

- multipart file upload support
- real streaming playback into Zoom
- real backend callback contract with teammate services
- speaker-detection-driven interrupt input from the meeting gateway

Those are left as placeholders so you can finish your part without blocking on the other teams.

## Recommended Teammate Contract

For your hackathon team, this is the cleanest contract to share:

1. The UI/backend service owns `user_id`.
2. The voice service owns `voice_profile_id` and ElevenLabs `provider_voice_id`.
3. The intelligence service should usually call:

```http
POST /internal/runtime/sessions/:session_id/respond
```

with:

```json
{
  "user_id": "user_123",
  "text": "Short spoken reply text here.",
  "priority": 5,
  "urgent": false
}
```

That keeps the intelligence service independent from your internal voice-profile storage.

## Teammate Handoff

Share this section directly with the backend and intelligence teammates.

### Base rules

- every request should include `Authorization: Bearer <INTERNAL_BACKEND_AUTH_TOKEN>`
- all request bodies are JSON
- the voice service owns `voice_profile_id` and ElevenLabs `provider_voice_id`
- other services should prefer `user_id` over `voice_profile_id` unless they have a specific reason not to

### 1. Resolve the default ready voice for a user

Request:

```http
GET /users/:user_id/voices/default
```

Example response:

```json
{
  "id": "voice_3fbca20e-b6a1-45d1-bb92-541285c3f7ae",
  "user_id": "user_123",
  "provider": "elevenlabs",
  "provider_voice_id": "3L99aUMNzwe9uZcZKQu1",
  "display_name": "Nathan Live Clone",
  "status": "ready",
  "sample_count": 1,
  "consent_confirmed": true,
  "created_at": "2026-03-21T21:55:00.000Z",
  "updated_at": "2026-03-21T21:56:00.000Z"
}
```

### 2. Request a spoken response for a meeting session

Request:

```http
POST /internal/runtime/sessions/:session_id/respond
```

Recommended request body:

```json
{
  "user_id": "user_123",
  "text": "Thanks everyone. I agree with the proposed next step.",
  "priority": 5,
  "urgent": false
}
```

Alternate request body if the caller already knows the exact voice profile:

```json
{
  "voice_profile_id": "voice_3fbca20e-b6a1-45d1-bb92-541285c3f7ae",
  "text": "Thanks everyone. I agree with the proposed next step.",
  "priority": 5,
  "urgent": false
}
```

Example success response:

```json
{
  "job_id": "speech_b11729d2-1b59-42e2-9e86-120781855cac",
  "session_id": "meeting_123",
  "voice_profile_id": "voice_3fbca20e-b6a1-45d1-bb92-541285c3f7ae",
  "text": "Thanks everyone. I agree with the proposed next step.",
  "priority": 5,
  "urgent": false,
  "state": "queued",
  "audio_ref": null,
  "created_at": "2026-03-21T22:00:00.000Z"
}
```

### 3. Poll runtime state for that meeting session

Request:

```http
GET /runtime/sessions/:session_id/state
```

Example response:

```json
{
  "session_id": "meeting_123",
  "active_job_id": null,
  "queue_depth": 0,
  "is_playing": false,
  "last_interrupt_at": null,
  "last_playback_ended_at": "2026-03-21T22:00:05.000Z",
  "last_delivery_transport": "local-fallback",
  "queued_jobs": []
}
```

### 4. Cancel the current or a specific speech job

Request:

```http
POST /runtime/sessions/:session_id/cancel
```

Cancel the active job:

```json
{
  "reason": "Another participant started speaking."
}
```

Cancel a specific queued job:

```json
{
  "job_id": "speech_ab086e17-1821-4a3f-8285-2562ae2ca404",
  "reason": "This response is no longer needed."
}
```

### Suggested ownership split

- control backend:
  calls voice enrollment routes, stores returned voice profile metadata, and owns the user-facing settings pages
- intelligence service:
  calls `POST /internal/runtime/sessions/:session_id/respond` with `user_id + text`
- zoom gateway:
  later receives the generated audio handoff when `MEETING_GATEWAY_BASE_URL` is wired

## Example Local Flow

### 1. Enroll a voice

```powershell
$headers = @{
  Authorization = "Bearer replace-me"
  "Content-Type" = "application/json"
}

$body = @{
  user_id = "user_123"
  display_name = "Nathan Voice"
  consent_confirmed = $true
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:8083/voices/enroll" -Headers $headers -Body $body
```

### 2. Upload a sample

```powershell
$audioBytes = [System.IO.File]::ReadAllBytes("C:\path\to\sample.mp3")
$audioBase64 = [Convert]::ToBase64String($audioBytes)

$sampleBody = @{
  sample_name = "sample.mp3"
  mime_type = "audio/mpeg"
  audio_base64 = $audioBase64
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:8083/voices/<VOICE_ID>/sample" -Headers $headers -Body $sampleBody
```

### 3. Finalize the clone

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8083/voices/<VOICE_ID>/finalize" -Headers $headers
```

### 4. Queue meeting speech

```powershell
$speakBody = @{
  voice_profile_id = "<VOICE_ID>"
  text = "Thanks for the question. I support the plan and can own the next task."
  priority = 5
  urgent = $false
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:8083/runtime/sessions/session_123/speak" -Headers $headers -Body $speakBody
```
