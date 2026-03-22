Chat prompt:

1) Meeting Integration Engineer
Title: Zoom Meeting Gateway

Mission:
Build the service that gets the agent into a Zoom meeting, captures meeting audio, and plays synthesized audio back into the call. This service is the transport layer for meeting participation. It should be reliable, low-latency, and dumb in the best way possible: it should not decide what the agent says, and it should not do LLM reasoning.

Why this component exists:
The whole system depends on a stable meeting connector. Gemini and ElevenLabs are useless unless the app can actually enter a live meeting, receive audio, and send audio back. Zoom’s platform supports Meeting SDK usage plus server-side OAuth-based API access, so build the gateway around that model. 

Credentials needed:

Zoom Meeting SDK credentials

Zoom Server-to-Server OAuth credentials

Internal backend auth token

Main responsibilities:

Join a Zoom meeting as the assistant participant

Start and stop meeting sessions on demand

Track meeting lifecycle states like joining, joined, reconnecting, failed, ended

Capture inbound meeting audio in near real time

Normalize inbound audio into a single internal format for downstream services

Forward audio chunks or a live stream to the Gemini Intelligence service

Receive synthesized speech audio from the ElevenLabs Voice Runtime

Inject synthesized speech back into the meeting

Emit status events, connection events, audio events, and error events

Inputs:

meeting_session_id

user_id

meeting_url or meeting_id

session config from Control Backend

playback audio from Voice Runtime

Outputs:

live inbound audio stream

session lifecycle events

participant state updates

outbound playback confirmations

error events

Required API contract:

POST /sessions/start

POST /sessions/:id/stop

GET /sessions/:id/status

WS /sessions/:id/audio-in

WS /sessions/:id/audio-out

Canonical events:

session.created

session.joining

session.joined

session.failed

session.reconnecting

participant.updated

audio.chunk.received

audio.chunk.played

session.ended

Internal design requirements:

Keep audio format stable across the whole system

Add retry and reconnect logic

Log latency and audio transport errors

Handle race conditions when a session is stopped while connecting

Make the outbound audio injection path cancellable

Design around one provider in v1: Zoom only

Out of scope:

No transcript generation

No summarization

No deciding when to speak

No voice cloning logic

No database ownership beyond optional short-lived transport state

How this connects to the rest:

Sends inbound audio to the Gemini Intelligence Service

Receives outbound speech audio from the ElevenLabs Voice Runtime

Reads config from the Control Backend

Pushes state/events back to the Control Backend for UI display

Definition of done:
A running service that can join a Zoom meeting, stream incoming audio to another backend service, accept generated speech audio back, and expose stable session APIs for the rest of the stack.

