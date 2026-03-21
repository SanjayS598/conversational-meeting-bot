# Gemini Live API — Reference Guide

This file covers everything needed to implement the `GeminiProvider` adapter.

---

## SDK Setup

```bash
npm install @google/generative-ai
```

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
```

---

## Model Names

| Use case | Model ID |
|---|---|
| Live audio transcription | `gemini-2.0-flash-live-001` |
| Stateless structured state updates | `gemini-2.0-flash` |

---

## Live Session — Audio Transcription

The Gemini Live API uses a bidirectional streaming session. The JS SDK exposes
this via `startChat()` with a live-capable model, or via the REST-based
BidiGenerateContent websocket endpoint.

### Using the JS SDK (preferred for v1)

```typescript
import { GoogleGenerativeAI, LiveServerMessage } from '@google/generative-ai';

export class GeminiLiveSession {
  private session: any;  // SDK live session handle

  async start(apiKey: string, sessionId: string): Promise<void> {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: 'gemini-2.0-flash-live-001',
    });

    // Live session config
    this.session = await (model as any).startLiveSession({
      systemInstruction: `
        You are transcribing a business meeting.
        For each audio input, output ONLY a JSON object:
        {
          "text": "<transcribed text>",
          "speaker_label": "Participant",
          "is_final": true|false
        }
        Do not add any commentary. Output only valid JSON.
      `,
      generationConfig: {
        responseModalities: ['TEXT'],
      },
    });
  }

  async sendAudio(pcmBuffer: Buffer): Promise<TranscriptDelta | null> {
    // Send raw PCM bytes
    await this.session.sendRealtimeInput({
      audio: {
        data: pcmBuffer.toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      },
    });

    // Collect response (may be empty if Gemini is still processing)
    const response = await this.session.receive();
    if (!response?.text) return null;

    try {
      return JSON.parse(response.text) as TranscriptDelta;
    } catch {
      return null;  // incomplete JSON — normal during live streaming
    }
  }

  async end(): Promise<void> {
    await this.session?.close?.();
  }
}
```

### Audio Format Requirements

**Required format for Gemini Live:**
- Encoding: **PCM signed 16-bit little-endian**
- Sample rate: **16,000 Hz**
- Channels: **Mono (1 channel)**
- Chunk size: Send in ~100ms chunks (1600 samples = 3200 bytes)

If Meeting Gateway sends WebM or Opus, convert first using `ffmpeg` subprocess
or the `node-audioworklet` library:

```typescript
import { spawn } from 'node:child_process';

function convertToPCM(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-f', 's16le',
      '-ar', '16000',
      '-ac', '1',
      'pipe:1',
    ]);
    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stdout.on('end', () => resolve(Buffer.concat(chunks)));
    ffmpeg.stderr.on('data', () => {});  // suppress ffmpeg logs
    ffmpeg.on('error', reject);
    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}
```

---

## Stateless JSON-Mode Calls — State Updates

Use the non-live `gemini-2.0-flash` model for structured state/response generation.
This is a standard `generateContent` call with JSON output mode enabled.

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

async function callStructuredUpdate(
  apiKey: string,
  prompt: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,          // low temperature for structured output
      maxOutputTokens: 1024,
    },
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}
```

### State Update Prompt (Full Version)

```typescript
export function buildStateUpdatePrompt(
  payload: StateUpdatePayload
): string {
  return `
You are the intelligence layer for an AI meeting agent. Analyze the meeting transcript
and update the structured meeting state accordingly.

## Current Meeting State
\`\`\`json
${payload.current_meeting_state}
\`\`\`

## Rolling Transcript (most recent 20 turns)
${payload.transcript_so_far}

## Session Configuration
\`\`\`json
${payload.session_config}
\`\`\`

## Your Tasks

1. **Update MeetingState:**
   - Update current_topic if the conversation has shifted
   - Add any new participants mentioned
   - Add any decisions that were made (look for "we decided", "agreed", "going with")
   - Add any open questions raised but not answered
   - Add any action items (look for "will do", "can you", "please", ownership + task patterns)

2. **Detect Direct Questions:**
   - Look at the last 1-2 transcript turns
   - Determine if a participant is directly asking the USER (the agent's owner) a question
   - Only consider it a direct question if it clearly targets the user by name, "you", or their role

3. **Generate Response Candidate (if applicable):**
   - ONLY generate if: a direct question was detected AND the meeting objective is relevant
   - Keep it to 1-2 sentences maximum
   - Match the tone specified in user_tone
   - Do not speak outside allowed_topics if they are specified
   - If no response is appropriate, set response_candidate to null

## Output Format
Return ONLY this JSON object. No explanation, no markdown, no preamble:
{
  "updated_state": {
    "session_id": "<same as input>",
    "current_topic": "<string>",
    "participants": ["<string>"],
    "decisions": ["<string>"],
    "open_questions": ["<string>"],
    "action_items": [
      {
        "id": "<uuid>",
        "owner": "<string or null>",
        "description": "<string>",
        "due_hint": "<string or null>"
      }
    ],
    "last_agent_response_at": <number or null>
  },
  "response_candidate": {
    "text": "<1-2 sentence response>",
    "reason": "<why agent wants to speak>",
    "priority": "low|medium|high",
    "requires_approval": true|false,
    "max_speak_seconds": 15,
    "confidence": <0.0-1.0>
  } | null
}
`.trim();
}
```

---

## Rate Limits and Quota Handling

For `gemini-2.0-flash-live-001`:
- Live sessions: Limited concurrent sessions per project — check Google AI Studio quota
- Handle `429 Too Many Requests` with exponential backoff (start at 1s, max 30s)

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxAttempts) throw err;
      if (err?.status === 429 || err?.code === 'RESOURCE_EXHAUSTED') {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err; // non-retryable
      }
    }
  }
  throw new Error('unreachable');
}
```

---

## Making the Provider Swappable

The `GeminiProvider` must implement the `AIProvider` interface exactly. To
swap providers (e.g. to OpenAI Realtime or Whisper + GPT-4o):

1. Create a new class implementing `AIProvider`
2. Update the DI wiring in `src/index.ts`
3. No other files change

Future providers to plan for: `OpenAIRealtimeProvider`, `WhisperProvider`.

---

## Debugging Live Sessions

Add structured logging around every Gemini call:

```typescript
const log = app.log.child({ module: 'gemini-provider' });

log.info({ session_id, chunk_bytes: chunk.data.length }, 'sending audio chunk');
log.debug({ delta }, 'received transcript delta');
log.warn({ error: err.message }, 'gemini live session error, retrying');
```

For local development, mock the Gemini provider entirely — never call
the real API in unit tests:

```typescript
// src/providers/mock.provider.ts
export class MockAIProvider implements AIProvider {
  async startLiveSession() { return 'mock-handle'; }
  async sendAudioChunk(_, __, onDelta) {
    onDelta({ text: 'Hello from mock.', speaker_label: 'Participant_1',
      start_ms: 0, end_ms: 1000, confidence: 0.95, is_final: true });
  }
  async updateStateAndMaybeRespond(payload) {
    // Return minimal valid state
    const state = JSON.parse(payload.current_meeting_state);
    return {
      updated_state: JSON.stringify(state),
      response_candidate: null,
    };
  }
  async endLiveSession() {}
}
```