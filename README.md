# Clairo

Clairo is a multi-service AI meeting system that can join live Zoom meetings, capture the conversation, generate transcripts and notes, prepare voice responses, and act as a configurable AI clone of the user.

The project is split into four services:

- `ui-auth`: Next.js application for authentication, dashboard, meeting controls, summaries, settings, and the landing page
- `gemini-backend`: FastAPI service that handles transcript processing, meeting state, summarization, and agent decision logic
- `zoom-gateway`: Express and WebSocket transport layer that joins Zoom meetings and moves audio between the meeting and backend services
- `voice-cloning`: Node.js voice runtime for enrollment, cloning, preview generation, and speech orchestration

## What Clairo Does

Clairo is designed to represent a user inside meetings:

- joins a Zoom meeting from a meeting URL
- captures live meeting audio
- builds transcript and structured meeting state
- creates notes, decisions, questions, and action items
- prepares cloned voice responses from user context and uploaded documents
- streams audio back into the meeting when appropriate
- stores session state so the UI can show live progress and post-meeting summaries

## Repository Layout

```text
.
├── docker-compose.yml
├── gemini-backend/
├── ui-auth/
├── voice-cloning/
└── zoom-gateway/
```

## Architecture

```text
Browser
  │
  ▼
ui-auth (Next.js, port 3000)
  │
  ├── creates meeting sessions
  ├── reads/writes user preferences and voice settings
  ├── shows live meeting state and summaries
  │
  ├──────────────► zoom-gateway (port 3001)
  │                 joins Zoom meetings and transports audio
  │
  ├──────────────► gemini-backend (port 3002)
  │                 transcript processing, state, notes, summary, agent logic
  │
  └──────────────► voice-cloning (port 8083)
                    voice enrollment, previews, runtime speech generation

zoom-gateway ─────► gemini-backend
zoom-gateway ◄──── voice-cloning
gemini-backend ◄──► Redis
```

## Service Responsibilities

### `ui-auth`

Main product surface for users.

- Supabase-based auth and server-side session handling
- landing page and signed-in dashboard
- create/start/stop meeting sessions
- view live transcript and meeting state
- view post-meeting summaries
- configure voice and agent preferences

Key tech:

- Next.js 16
- React 19
- Tailwind CSS 4
- Supabase SSR

### `gemini-backend`

Core reasoning and meeting state service.

- accepts meeting audio and session signals
- maintains rolling state for each session
- generates transcript segments
- extracts notes, action items, questions, and decisions
- prepares reply candidates and speaking decisions
- handles voice prep context such as uploaded documents and prep notes

Key tech:

- FastAPI
- Google Gemini SDK
- LangChain / LangGraph
- Redis
- OpenAI client for speech-to-text integration in the current setup

### `zoom-gateway`

Transport layer for live meeting participation.

- joins Zoom meetings from meeting URLs
- manages meeting lifecycle states
- forwards inbound audio to downstream services
- receives synthesized speech and injects it back into the meeting
- exposes status and transport APIs for the rest of the stack

Key tech:

- Node.js
- TypeScript
- Express
- WebSockets
- Puppeteer

### `voice-cloning`

Voice enrollment and speech runtime.

- enrolls voice profiles
- stores voice samples
- finalizes voice clones
- generates preview speech
- manages per-session speech queueing and cancellation
- provides audio output for live meeting playback

Key tech:

- Node.js 22
- ElevenLabs integration

## Ports

The default local ports defined by the root compose file are:

- `3000`: `ui-auth`
- `3001`: `zoom-gateway`
- `3002`: `gemini-backend`
- `8083`: `voice-cloning`
- Redis runs internally on `6379`

## Running The Full Stack

The recommended local workflow is Docker Compose from the project root.

### 1. Create environment files

The stack expects these local files:

- `gemini-backend/.env`
- `zoom-gateway/.env`
- `voice-cloning/.env`
- `ui-auth/.env.local`

The exact values depend on which integrations you want active, but in practice you will usually need:

- Supabase credentials for `ui-auth`
- Gemini API credentials for `gemini-backend`
- ElevenLabs credentials for `voice-cloning`
- Recall.ai and internal service credentials for `zoom-gateway`
- shared internal tokens between services where applicable

### 2. Start everything

```bash
docker compose up --build
```

### 3. Open the app

```text
http://localhost:3000
```

### 4. Useful compose commands

```bash
docker compose logs -f
docker compose logs -f ui-auth
docker compose logs -f gemini-backend
docker compose down
```

## Development Notes

The root `docker-compose.yml` is set up for a hot-reload oriented workflow:

- `ui-auth/src` and `ui-auth/public` are mounted into the UI container
- `gemini-backend/src` is mounted into the backend container
- `zoom-gateway/src` is mounted into the gateway container
- `voice-cloning/src` is mounted into the voice runtime container

That means most source edits show up without rebuilding the entire image.

## Current User Flow

### Signed-out flow

- visit the landing page at `/`
- click `Get started with Clairo`
- sign in or sign up

### Signed-in flow

- land on the dashboard
- create a new meeting
- provide meeting URL and optional prep context
- start the live session
- monitor transcript, notes, and action items
- stop and finalize the meeting
- review the summary page

## Important Files

### Root

- `docker-compose.yml`: full local multi-service stack
- `README.md`: this document

### UI

- `ui-auth/src/app/page.tsx`: root route
- `ui-auth/src/app/landing.tsx`: landing page
- `ui-auth/src/app/(app)/dashboard/page.tsx`: signed-in dashboard
- `ui-auth/src/app/(app)/meetings/new/page.tsx`: create/start meeting UI
- `ui-auth/src/app/(app)/meetings/[id]/live/page.tsx`: live meeting UI

### Backend

- `gemini-backend/src/main.py`: FastAPI entry point
- `gemini-backend/src/routes/`: backend route handlers
- `gemini-backend/src/agent/`: agent graph and policy logic
- `gemini-backend/src/pipeline/`: audio and state pipeline logic

### Gateway

- `zoom-gateway/src/index.ts`: entry point
- `zoom-gateway/src/routes/`: REST routes
- `zoom-gateway/src/services/`: session and Zoom transport services

### Voice Runtime

- `voice-cloning/src/server.js`: entry point
- `voice-cloning/src/services/`: voice profile and runtime orchestration
- `voice-cloning/src/providers/elevenlabs-provider.js`: ElevenLabs integration

## Environment And Integration Expectations

This repository is integration-heavy. A fully working live meeting loop depends on several external systems:

- Supabase for auth and persistent application data
- Zoom meeting links
- Recall.ai or the configured meeting transport setup used by the gateway
- Gemini API access
- ElevenLabs API access

If one of those is missing, parts of the application may still run locally, but the full meeting loop will be incomplete.

## Troubleshooting

### The UI opens but the dashboard or landing page does not reflect my changes

- confirm the `ui-auth` container is running
- check `docker compose logs -f ui-auth`
- hard refresh the browser

### The stack starts but live meeting features do not work

- verify all service `.env` files exist
- verify service-to-service URLs and shared tokens match
- confirm external API credentials are present
- confirm the Zoom or Recall integration URLs are current

### A service is up but unhealthy

- inspect that service's logs first
- confirm required env vars are set
- verify upstream dependencies are reachable

## Testing And Validation

This repository currently has a mix of service-specific test and smoke-test utilities. Common validation steps include:

```bash
docker compose up --build
docker compose logs -f ui-auth
docker compose logs -f gemini-backend
```

For the Next.js app, targeted lint checks are useful during UI work:

```bash
cd ui-auth
npx eslint src/app/landing.tsx
```

## Status

This codebase is an active multi-service application rather than a polished SDK or library. Some service README files still contain original implementation briefs or partial notes from earlier development phases. The root README is intended to be the current high-level guide for running and understanding the full stack.

## License

See [LICENSE](./LICENSE).
