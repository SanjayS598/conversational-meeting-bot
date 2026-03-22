---
name: gemini-realtime-intelligence
description: >
  Build the Gemini Realtime Intelligence Service — the AI brain layer of a
  meeting agent. Triggers whenever the user asks to build, extend, or debug
  anything related to: processing meeting audio with Gemini, producing live
  transcripts, generating structured meeting notes or action items, deciding
  when the agent should speak, managing rolling session context, or wiring
  up the /brain/* API endpoints. Also triggers for: session lifecycle
  management, adapter-pattern AI provider abstraction, confidence-gated
  response policy, or any component that sits between raw meeting audio and
  structured JSON state. Use this skill even when the user only mentions
  part of this surface — e.g. "transcript segments", "meeting state", or
  "agent response candidates". This skill is the single source of truth for
  building this component correctly from scratch.
---

# Gemini Realtime Intelligence Service — Build Skill

## What This Service Is

The **Realtime Intelligence Service** is the core reasoning brain of a
meeting agent. It sits between the Meeting Gateway (which streams raw audio)
and the Voice Runtime / Control Backend (which consumes structured output).

It does five things:
1. Transcribe streaming audio in real time
2. Maintain a rolling `MeetingState` (topic, participants, decisions, Q&A)
3. Decide whether to speak (confidence + policy gating)
4. Generate short `AgentResponse` candidates via Gemini
5. Persist transcript segments and structured notes to the backend

**What it does NOT do:**
- Play audio (that is the Voice Runtime's job)
- Own frontend state
- Handle authentication/auth flows

---

## Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Node.js 20+ / TypeScript** | Streaming-first, native async, Gemini SDK support |
| AI Provider | **Google Gemini** (`gemini-2.0-flash-live-001` for Live sessions) | Multimodal, live session support, structured output |
| HTTP Framework | **Fastify** | Low overhead, schema-validated routes, streaming support |
| Audio Streaming | **WebSocket or gRPC** inbound from Meeting Gateway | Depends on Meeting Gateway contract |
| State Store | **Redis** | Fast rolling session context, TTL-based cleanup |
| Persistence | Internal backend REST API (via `Control Backend`) | Not owned by this service |
| Testing | **Vitest + msw** | Fast, ESM-native |

---

## Step-by-Step Build Order

Follow this exact order. Do not skip ahead.

### Step 1 — Project Scaffold

```bash
mkdir gemini-intelligence && cd gemini-intelligence
npm init -y
npm install typescript @types/node fastify @fastify/websocket \
  @google/generative-ai ioredis zod dotenv pino
npm install -D vitest @vitest/coverage-v8 tsx
npx tsc --init
```

**`tsconfig.json` key settings:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true
  }
}
```

**Directory layout to create:**
```
src/
  providers/
    gemini.provider.ts       # Gemini adapter (swappable)
    provider.interface.ts    # AIProvider interface
  sessions/
    session.manager.ts       # Redis-backed session lifecycle
    session.schema.ts        # Zod schemas for all canonical objects
  pipeline/
    audio.processor.ts       # Chunk ingestion + Gemini live stream
    transcript.builder.ts    # Assembles TranscriptSegment objects
    state.updater.ts         # Updates MeetingState from transcript
    response.policy.ts       # Confidence + mode gating logic
    notes.extractor.ts       # Structured JSON notes from state
  routes/
    sessions.routes.ts       # All /brain/sessions/:id/* endpoints
  clients/
    backend.client.ts        # HTTP client for Control Backend API
  index.ts                   # Fastify app bootstrap
```

---

### Step 2 — Canonical Object Schemas (Zod)

Create `src/sessions/session.schema.ts`. **These schemas are the contract for
the entire system. Define them first. Everything else depends on them.**

```typescript
import { z } from 'zod';

export const TranscriptSegmentSchema = z.object({
  segment_id: z.string().uuid(),
  session_id: z.string().uuid(),
  speaker_label: z.string(),            // e.g. "User", "Participant_1"
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
  confidence: z.number().min(0).max(1),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const ActionItemSchema = z.object({
  id: z.string().uuid(),
  owner: z.string().optional(),
  description: z.string(),
  due_hint: z.string().optional(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

export const MeetingStateSchema = z.object({
  session_id: z.string().uuid(),
  current_topic: z.string(),
  participants: z.array(z.string()),
  decisions: z.array(z.string()),
  open_questions: z.array(z.string()),
  action_items: z.array(ActionItemSchema),
  last_agent_response_at: z.number().nullable(),  // unix ms
});
export type MeetingState = z.infer<typeof MeetingStateSchema>;

export const AgentResponseSchema = z.object({
  text: z.string(),
  reason: z.string(),                              // why the agent wants to speak
  priority: z.enum(['low', 'medium', 'high']),
  requires_approval: z.boolean(),
  max_speak_seconds: z.number().positive(),
  confidence: z.number().min(0).max(1),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export const SessionModeSchema = z.enum(['notes_only', 'suggest', 'auto_speak']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionConfigSchema = z.object({
  session_id: z.string().uuid(),
  mode: SessionModeSchema,
  user_tone: z.string().default('professional'),   // e.g. "casual", "technical"
  meeting_objective: z.string(),
  prep_notes: z.string().optional(),
  allowed_topics: z.array(z.string()).default([]),
  response_policy: z.object({
    min_confidence: z.number().min(0).max(1).default(0.75),
    max_speak_seconds: z.number().default(15),
    cooldown_ms: z.number().default(30_000),       // min gap between responses
  }).default({}),
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;

export const SessionStateSchema = z.object({
  config: SessionConfigSchema,
  meeting: MeetingStateSchema,
  transcript: z.array(TranscriptSegmentSchema),
  pending_response: AgentResponseSchema.nullable(),
  started_at: z.number(),
  status: z.enum(['active', 'paused', 'ended']),
});
export type SessionState = z.infer<typeof SessionStateSchema>;
```

---

### Step 3 — AI Provider Interface (Adapter Pattern)

Create `src/providers/provider.interface.ts`:

```typescript
export interface AudioChunk {
  data: Buffer;
  sequence: number;
  timestamp_ms: number;
}

export interface TranscriptDelta {
  text: string;
  speaker_label: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
  is_final: boolean;
}

export interface StateUpdatePayload {
  transcript_so_far: string;
  current_meeting_state: string;   // JSON-stringified MeetingState
  session_config: string;           // JSON-stringified SessionConfig
}

export interface StateUpdateResult {
  updated_state: string;            // JSON-stringified MeetingState
  response_candidate: string | null; // JSON-stringified AgentResponse or null
}

export interface AIProvider {
  /** Start a live session for real-time audio transcription */
  startLiveSession(sessionId: string, config: object): Promise<string>; // returns provider session handle

  /** Push an audio chunk; calls onDelta for each transcript delta produced */
  sendAudioChunk(
    handle: string,
    chunk: AudioChunk,
    onDelta: (delta: TranscriptDelta) => void
  ): Promise<void>;

  /** Stateless structured call to update MeetingState and optionally generate a response */
  updateStateAndMaybeRespond(payload: StateUpdatePayload): Promise<StateUpdateResult>;

  /** End a live session cleanly */
  endLiveSession(handle: string): Promise<void>;
}
```

---

### Step 4 — Gemini Provider Implementation

Create `src/providers/gemini.provider.ts`.

Read `references/gemini-live-api.md` before implementing — it covers the
exact Gemini Live API surface, audio format requirements, and how to structure
JSON-mode calls for state updates.

Key implementation notes:

**For live audio transcription** — use `GoogleGenerativeAI` client with the
`models/gemini-2.0-flash-live-001` model and a `BidiGenerateContent` session.
Audio must be sent as 16-bit PCM, 16kHz mono. Wrap the session lifecycle in
the `AIProvider` interface.

**For state updates** — use a separate stateless `generateContent` call with
`responseMimeType: 'application/json'` and a structured prompt that includes:
- The rolling transcript text
- The current `MeetingState` JSON
- The `SessionConfig` (objective, allowed topics, tone, policy)
- An explicit instruction to return a `StateUpdateResult` JSON object

```typescript
// State update prompt template (expand this in your implementation)
const STATE_UPDATE_PROMPT = `
You are the intelligence layer for a meeting agent.

## Current Meeting State
{CURRENT_STATE_JSON}

## New Transcript Additions
{NEW_TRANSCRIPT}

## Session Configuration
{SESSION_CONFIG_JSON}

## Instructions
1. Update the meeting state with any new decisions, open questions, action items, or topic changes.
2. Determine if the user is being directly asked a question relevant to the meeting objective.
3. If yes AND the session mode permits speaking, generate a short AgentResponse (1-2 sentences max).
4. If no response is appropriate, set response_candidate to null.

Return ONLY valid JSON matching this exact schema:
{
  "updated_state": <MeetingState JSON>,
  "response_candidate": <AgentResponse JSON or null>
}
`;
```

---

### Step 5 — Session Manager

Create `src/sessions/session.manager.ts`.

Uses Redis (`ioredis`) as the backing store. All session state is stored under
key `brain:session:{session_id}` with a 4-hour TTL.

```typescript
export class SessionManager {
  constructor(private redis: Redis) {}

  async create(config: SessionConfig): Promise<SessionState>
  async get(sessionId: string): Promise<SessionState | null>
  async update(sessionId: string, patch: Partial<SessionState>): Promise<SessionState>
  async end(sessionId: string): Promise<void>
  async appendTranscriptSegment(sessionId: string, seg: TranscriptSegment): Promise<void>
  async setPendingResponse(sessionId: string, response: AgentResponse | null): Promise<void>
}
```

**Implementation note:** Use `JSON.stringify` / `JSON.parse` for Redis
serialization. Validate with Zod schemas on read.

---

### Step 6 — Response Policy Engine

Create `src/pipeline/response.policy.ts`.

This is the decision gate. It is **pure logic — no AI calls, no I/O.**

```typescript
export type PolicyDecision =
  | { allowed: false; reason: string }
  | { allowed: true };

export function evaluateResponsePolicy(
  candidate: AgentResponse,
  state: SessionState
): PolicyDecision {
  const { config } = state;
  const { response_policy, mode } = config;

  // Rule 1: notes_only mode never speaks
  if (mode === 'notes_only') {
    return { allowed: false, reason: 'mode=notes_only' };
  }

  // Rule 2: confidence gate
  if (candidate.confidence < response_policy.min_confidence) {
    return { allowed: false, reason: `confidence ${candidate.confidence} < threshold ${response_policy.min_confidence}` };
  }

  // Rule 3: cooldown
  if (state.meeting.last_agent_response_at !== null) {
    const elapsed = Date.now() - state.meeting.last_agent_response_at;
    if (elapsed < response_policy.cooldown_ms) {
      return { allowed: false, reason: `cooldown: ${elapsed}ms elapsed of ${response_policy.cooldown_ms}ms` };
    }
  }

  // Rule 4: suggest mode requires approval
  if (mode === 'suggest' && !candidate.requires_approval) {
    // Force requires_approval in suggest mode — caller must handle
    candidate.requires_approval = true;
  }

  return { allowed: true };
}
```

---

### Step 7 — Audio Processor

Create `src/pipeline/audio.processor.ts`.

This is the hot path. It receives raw audio chunks from the Meeting Gateway
WebSocket, forwards them to the Gemini Live session, and accumulates
`TranscriptDelta` objects into finalized `TranscriptSegment` objects.

```typescript
export class AudioProcessor {
  private liveHandle: string | null = null;
  private pendingDeltas: TranscriptDelta[] = [];

  constructor(
    private provider: AIProvider,
    private sessionManager: SessionManager,
    private onSegmentReady: (seg: TranscriptSegment) => Promise<void>
  ) {}

  async start(sessionId: string, config: SessionConfig): Promise<void>

  async ingest(sessionId: string, chunk: AudioChunk): Promise<void>

  private async finalizePendingDeltas(sessionId: string): Promise<void>

  async stop(sessionId: string): Promise<void>
}
```

**Finalization logic:** When Gemini returns `is_final: true` for a delta
sequence, group the deltas into a `TranscriptSegment`, generate a UUID for
`segment_id`, validate with Zod, and call `onSegmentReady`.

---

### Step 8 — State Updater

Create `src/pipeline/state.updater.ts`.

Called after each finalized `TranscriptSegment`. Calls the AI provider's
`updateStateAndMaybeRespond` and then runs the policy engine.

```typescript
export class StateUpdater {
  constructor(
    private provider: AIProvider,
    private sessionManager: SessionManager,
    private backendClient: BackendClient
  ) {}

  async process(sessionId: string, newSegment: TranscriptSegment): Promise<void> {
    const session = await this.sessionManager.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // 1. Build payload
    const recentTranscript = session.transcript
      .slice(-20)   // rolling window: last 20 segments
      .map(s => `[${s.speaker_label}] ${s.text}`)
      .join('\n');

    const payload: StateUpdatePayload = {
      transcript_so_far: recentTranscript + `\n[${newSegment.speaker_label}] ${newSegment.text}`,
      current_meeting_state: JSON.stringify(session.meeting),
      session_config: JSON.stringify(session.config),
    };

    // 2. AI call
    const result = await this.provider.updateStateAndMaybeRespond(payload);
    const updatedMeeting = MeetingStateSchema.parse(JSON.parse(result.updated_state));

    // 3. Policy gate
    let pendingResponse: AgentResponse | null = null;
    if (result.response_candidate) {
      const candidate = AgentResponseSchema.parse(JSON.parse(result.response_candidate));
      const decision = evaluateResponsePolicy(candidate, session);
      if (decision.allowed) {
        pendingResponse = candidate;
      }
    }

    // 4. Persist
    await this.sessionManager.update(sessionId, {
      meeting: updatedMeeting,
      pending_response: pendingResponse,
    });
    await this.sessionManager.appendTranscriptSegment(sessionId, newSegment);

    // 5. Push to backend
    await this.backendClient.saveTranscriptSegment(newSegment);
    await this.backendClient.saveMeetingState(updatedMeeting);
  }
}
```

---

### Step 9 — Backend Client

Create `src/clients/backend.client.ts`.

A thin HTTP client that calls the Control Backend APIs. Uses the internal
service token from env.

```typescript
export class BackendClient {
  constructor(
    private baseUrl: string,
    private token: string
  ) {}

  private headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async saveTranscriptSegment(seg: TranscriptSegment): Promise<void>
  async saveMeetingState(state: MeetingState): Promise<void>
  async getUserConfig(userId: string): Promise<SessionConfig>
  async notifyResponseReady(sessionId: string, response: AgentResponse): Promise<void>
}
```

---

### Step 10 — HTTP Routes

Create `src/routes/sessions.routes.ts`.

All routes are prefixed `/brain/sessions/:id`.

```typescript
// POST /brain/sessions/:id/start
// Body: SessionConfig
// Creates session in Redis, starts Gemini live session, returns { session_id, status }

// POST /brain/sessions/:id/audio
// Body: raw audio bytes (content-type: audio/pcm or audio/webm)
// OR upgrade to WebSocket for streaming
// Calls audioProcessor.ingest()

// GET /brain/sessions/:id/context
// Returns current SessionState (config + meeting state, no full transcript)

// GET /brain/sessions/:id/notes
// Returns { meeting_state: MeetingState, transcript_count: number, pending_response: AgentResponse | null }

// POST /brain/sessions/:id/respond
// Body: { approved: boolean }
// If approved: forward AgentResponse.text to Voice Runtime
// Clears pending_response, updates last_agent_response_at
```

**Audio endpoint design decision:** For v1, prefer WebSocket upgrade on the
audio endpoint. This avoids per-chunk HTTP overhead and aligns with how
Meeting Gateway expects to stream. Use `@fastify/websocket` plugin.

---

### Step 11 — App Bootstrap

Create `src/index.ts`:

```typescript
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { Redis } from 'ioredis';
import { GeminiProvider } from './providers/gemini.provider.js';
import { SessionManager } from './sessions/session.manager.js';
import { AudioProcessor } from './pipeline/audio.processor.js';
import { StateUpdater } from './pipeline/state.updater.js';
import { BackendClient } from './clients/backend.client.js';
import { sessionRoutes } from './routes/sessions.routes.js';

const app = Fastify({ logger: true });
await app.register(websocket);

const redis = new Redis(process.env.REDIS_URL!);
const provider = new GeminiProvider(process.env.GEMINI_API_KEY!);
const sessionManager = new SessionManager(redis);
const backendClient = new BackendClient(
  process.env.BACKEND_URL!,
  process.env.INTERNAL_SERVICE_TOKEN!
);

const stateUpdater = new StateUpdater(provider, sessionManager, backendClient);
const audioProcessor = new AudioProcessor(
  provider,
  sessionManager,
  (seg) => stateUpdater.process(seg.session_id, seg)
);

await app.register(sessionRoutes, {
  prefix: '/brain',
  audioProcessor,
  sessionManager,
  backendClient,
});

await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
```

---

## Environment Variables

```env
GEMINI_API_KEY=           # Google AI Studio key
INTERNAL_SERVICE_TOKEN=   # Shared secret for backend API calls
BACKEND_URL=              # Control Backend base URL, e.g. http://localhost:4000
REDIS_URL=                # redis://localhost:6379
PORT=3001
```

---

## Error Handling Patterns

1. **Gemini Live session drops** — Implement exponential backoff retry in
   `AudioProcessor.start()`. Surface error via a `session:error` event to
   the Meeting Gateway.

2. **Zod parse failures on AI output** — Log and skip the state update cycle.
   Never crash the audio ingestion pipeline because of a bad AI response.

3. **Backend client failures** — Queue failed persist calls in Redis with a
   retry job. Do not let persistence failures block transcript generation.

4. **Redis unavailable** — Fail fast on startup. This service cannot function
   without session state.

---

## Decision Policy — Reference Table

| mode | confidence | user directly asked | action |
|---|---|---|---|
| `notes_only` | any | any | Never speak |
| `suggest` | < threshold | any | No candidate |
| `suggest` | ≥ threshold | yes | Generate candidate, `requires_approval=true` |
| `auto_speak` | < threshold | any | No candidate |
| `auto_speak` | ≥ threshold | yes | Generate candidate, `requires_approval=false` |
| any | any | no | No candidate |

Candidates are always 1–2 sentences. `max_speak_seconds` defaults to 15.

---

## Testing Approach

See `references/testing-guide.md` for full test patterns.

Key tests to write:
- `response.policy.ts` — unit test all 5 policy branches (pure function, no mocks needed)
- `state.updater.ts` — integration test with mocked `AIProvider` and `SessionManager`
- `session.manager.ts` — test Redis round-trip with a real Redis test container
- Routes — Fastify `inject()` for all 5 endpoints

---

## Connecting to Other Services

| Direction | Counterpart | Protocol | What is exchanged |
|---|---|---|---|
| Inbound | Meeting Gateway | WebSocket | Raw audio chunks (PCM 16-bit 16kHz mono) |
| Outbound | Voice Runtime | HTTP POST | `AgentResponse.text` on `/voice/speak` |
| Outbound | Control Backend | HTTP REST | `TranscriptSegment`, `MeetingState`, user config reads |

**Do not** import or call the Voice Runtime directly from audio pipeline code.
Always go through the `/brain/sessions/:id/respond` endpoint so approval gates
work correctly in `suggest` mode.

---

## Reference Files

- `references/gemini-live-api.md` — Gemini Live API setup, audio format, JSON-mode calls
- `references/testing-guide.md` — Full test patterns for each module