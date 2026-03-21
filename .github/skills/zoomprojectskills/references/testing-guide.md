# Testing Guide — Realtime Intelligence Service

All tests use **Vitest**. Run with `npx vitest run`.

---

## Test Philosophy

- **Unit tests** for pure logic: `response.policy.ts`, schema validation
- **Integration tests** with mocked providers for pipeline modules
- **Contract tests** for Fastify routes using `app.inject()`
- **No real Gemini calls in tests** — always use `MockAIProvider`
- **Redis test container** for `SessionManager` integration tests (or use `ioredis-mock`)

---

## 1. Response Policy — Unit Tests

`src/pipeline/__tests__/response.policy.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { evaluateResponsePolicy } from '../response.policy.js';
import type { AgentResponse, SessionState } from '../../sessions/session.schema.js';

function makeState(overrides: Partial<SessionState['config']> = {}): SessionState {
  return {
    config: {
      session_id: '00000000-0000-0000-0000-000000000001',
      mode: 'auto_speak',
      user_tone: 'professional',
      meeting_objective: 'Discuss Q3 roadmap',
      allowed_topics: [],
      response_policy: {
        min_confidence: 0.75,
        max_speak_seconds: 15,
        cooldown_ms: 30_000,
      },
      ...overrides,
    },
    meeting: {
      session_id: '00000000-0000-0000-0000-000000000001',
      current_topic: 'roadmap',
      participants: [],
      decisions: [],
      open_questions: [],
      action_items: [],
      last_agent_response_at: null,
    },
    transcript: [],
    pending_response: null,
    started_at: Date.now(),
    status: 'active',
  };
}

function makeCandidate(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    text: 'I can take that action item.',
    reason: 'User was directly asked.',
    priority: 'medium',
    requires_approval: false,
    max_speak_seconds: 10,
    confidence: 0.9,
    ...overrides,
  };
}

describe('evaluateResponsePolicy', () => {
  it('blocks speaking in notes_only mode', () => {
    const result = evaluateResponsePolicy(makeCandidate(), makeState({ mode: 'notes_only' }));
    expect(result.allowed).toBe(false);
    expect((result as any).reason).toContain('notes_only');
  });

  it('blocks low-confidence candidates', () => {
    const result = evaluateResponsePolicy(
      makeCandidate({ confidence: 0.5 }),
      makeState()
    );
    expect(result.allowed).toBe(false);
    expect((result as any).reason).toContain('confidence');
  });

  it('blocks if within cooldown window', () => {
    const state = makeState();
    state.meeting.last_agent_response_at = Date.now() - 5_000; // 5s ago, cooldown is 30s
    const result = evaluateResponsePolicy(makeCandidate(), state);
    expect(result.allowed).toBe(false);
    expect((result as any).reason).toContain('cooldown');
  });

  it('allows high-confidence candidate in auto_speak mode', () => {
    const result = evaluateResponsePolicy(makeCandidate(), makeState());
    expect(result.allowed).toBe(true);
  });

  it('forces requires_approval in suggest mode', () => {
    const candidate = makeCandidate({ requires_approval: false });
    const result = evaluateResponsePolicy(candidate, makeState({ mode: 'suggest' }));
    expect(result.allowed).toBe(true);
    expect(candidate.requires_approval).toBe(true);
  });

  it('allows after cooldown has passed', () => {
    const state = makeState();
    state.meeting.last_agent_response_at = Date.now() - 35_000; // 35s ago
    const result = evaluateResponsePolicy(makeCandidate(), state);
    expect(result.allowed).toBe(true);
  });
});
```

---

## 2. Zod Schema Validation — Unit Tests

`src/sessions/__tests__/session.schema.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { TranscriptSegmentSchema, AgentResponseSchema, SessionConfigSchema } from '../session.schema.js';

describe('TranscriptSegmentSchema', () => {
  it('validates a valid segment', () => {
    const result = TranscriptSegmentSchema.safeParse({
      segment_id: '11111111-0000-0000-0000-000000000001',
      session_id: '11111111-0000-0000-0000-000000000002',
      speaker_label: 'Participant_1',
      start_ms: 1000,
      end_ms: 2000,
      text: 'Hello everyone.',
      confidence: 0.92,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative confidence', () => {
    const result = TranscriptSegmentSchema.safeParse({
      segment_id: '11111111-0000-0000-0000-000000000001',
      session_id: '11111111-0000-0000-0000-000000000002',
      speaker_label: 'User',
      start_ms: 0, end_ms: 500,
      text: 'test',
      confidence: -0.1,
    });
    expect(result.success).toBe(false);
  });
});

describe('SessionConfigSchema', () => {
  it('applies default response_policy', () => {
    const result = SessionConfigSchema.parse({
      session_id: '11111111-0000-0000-0000-000000000001',
      mode: 'auto_speak',
      meeting_objective: 'Team sync',
    });
    expect(result.response_policy.min_confidence).toBe(0.75);
    expect(result.response_policy.cooldown_ms).toBe(30_000);
  });
});
```

---

## 3. StateUpdater — Integration Test with Mocked Provider

`src/pipeline/__tests__/state.updater.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateUpdater } from '../state.updater.js';
import { MockAIProvider } from '../../providers/mock.provider.js';

// In-memory SessionManager mock
const mockSession = { /* minimal valid SessionState */ };
const mockSessionManager = {
  get: vi.fn().mockResolvedValue(mockSession),
  update: vi.fn().mockResolvedValue(mockSession),
  appendTranscriptSegment: vi.fn().mockResolvedValue(undefined),
};
const mockBackendClient = {
  saveTranscriptSegment: vi.fn().mockResolvedValue(undefined),
  saveMeetingState: vi.fn().mockResolvedValue(undefined),
};

describe('StateUpdater.process', () => {
  let updater: StateUpdater;

  beforeEach(() => {
    vi.clearAllMocks();
    updater = new StateUpdater(
      new MockAIProvider(),
      mockSessionManager as any,
      mockBackendClient as any
    );
  });

  it('saves transcript segment to backend', async () => {
    const seg = {
      segment_id: crypto.randomUUID(),
      session_id: '00000000-0000-0000-0000-000000000001',
      speaker_label: 'Participant_1',
      start_ms: 0, end_ms: 1200,
      text: 'Can you give us a status update?',
      confidence: 0.93,
    };

    await updater.process(seg.session_id, seg);

    expect(mockBackendClient.saveTranscriptSegment).toHaveBeenCalledWith(seg);
    expect(mockSessionManager.appendTranscriptSegment).toHaveBeenCalled();
  });

  it('does not set pending_response when mock returns null candidate', async () => {
    await updater.process('test-session', {
      segment_id: crypto.randomUUID(),
      session_id: 'test-session',
      speaker_label: 'Participant_1',
      start_ms: 0, end_ms: 1000,
      text: 'Moving on.',
      confidence: 0.88,
    });

    const updateCall = mockSessionManager.update.mock.calls[0];
    expect(updateCall[1].pending_response).toBeNull();
  });
});
```

---

## 4. Routes — Contract Tests

`src/routes/__tests__/sessions.routes.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sessionRoutes } from '../sessions.routes.js';
import { MockAIProvider } from '../../providers/mock.provider.js';

describe('POST /brain/sessions/:id/start', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    // Register with mocked dependencies
    await app.register(sessionRoutes, {
      prefix: '/brain',
      audioProcessor: { start: vi.fn(), ingest: vi.fn(), stop: vi.fn() } as any,
      sessionManager: {
        create: vi.fn().mockResolvedValue({ config: {}, meeting: {}, status: 'active' }),
        get: vi.fn(),
        update: vi.fn(),
        end: vi.fn(),
      } as any,
      backendClient: { notifyResponseReady: vi.fn() } as any,
    });
    await app.ready();
  });

  afterAll(() => app.close());

  it('returns 200 and session_id on valid body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/brain/sessions/11111111-0000-0000-0000-000000000001/start',
      payload: {
        session_id: '11111111-0000-0000-0000-000000000001',
        mode: 'auto_speak',
        meeting_objective: 'Team sync',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('session_id');
    expect(body).toHaveProperty('status', 'active');
  });

  it('returns 400 on invalid mode', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/brain/sessions/11111111-0000-0000-0000-000000000001/start',
      payload: {
        session_id: '11111111-0000-0000-0000-000000000001',
        mode: 'invalid_mode',
        meeting_objective: 'Team sync',
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
```

---

## Running Tests

```bash
# All tests
npx vitest run

# With coverage
npx vitest run --coverage

# Watch mode during development
npx vitest
```

## CI Configuration (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test
    env:
      REDIS_URL: redis://localhost:6379
      GEMINI_API_KEY: test-key-not-used-in-tests
      INTERNAL_SERVICE_TOKEN: test-token
      BACKEND_URL: http://localhost:9999
```