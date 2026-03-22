Chat prompt:

2) Intelligence Engineer
Title: Gemini Realtime Intelligence Service

Mission:
Build the core agent brain using Gemini. This service listens to meeting audio, maintains rolling context, creates transcript and notes, detects when the user should respond, and generates the exact text that should be spoken by the voice system.

Why this component exists:
This is the reasoning layer. Gemini’s API supports standard, streaming, and realtime interactions, and the Live API is specifically positioned for low-latency voice experiences. Build this as the source of truth for “what is happening in the meeting?” and “what should the agent say?” 

Credentials needed:

Gemini API key

Internal backend auth token

Main responsibilities:

Receive streaming audio from Meeting Gateway

Maintain a rolling transcript buffer

Produce transcript segments with timestamps

Maintain a MeetingState object that tracks current topic, decisions, open questions, and action items

Detect likely direct questions aimed at the user

Decide whether the agent should stay silent, suggest a reply, or auto-speak

Generate short spoken reply text in the user’s configured tone

Generate post-meeting summary and structured notes

Send transcript, notes, and events to the Control Backend

Inputs:

inbound meeting audio

user preferences

meeting objective / preloaded notes

conversation mode: notes_only, suggest_replies, auto_speak

speaking policy config

meeting session metadata

Outputs:

transcript segments

running summary

decisions list

open questions list

action items list

reply text candidates

confidence flags

“should speak?” decisions

Required API contract:

POST /brain/sessions/:id/start

POST /brain/sessions/:id/audio

GET /brain/sessions/:id/context

GET /brain/sessions/:id/notes

POST /brain/sessions/:id/respond

Canonical objects:

TranscriptSegment

segment_id

session_id

speaker_label

start_ms

end_ms

text

confidence

MeetingState

session_id

current_topic

participants

decisions

open_questions

action_items

last_agent_response_at

AgentResponse

text

reason

priority

requires_approval

max_speak_seconds

confidence

Decision rules for v1:

If mode is notes_only, never speak

If confidence is below threshold, do not speak

If the user is directly asked something relevant, create a short reply candidate

Keep reply text to 1–2 sentences max

Stay within allowed meeting scope and user-configured behavior

Prefer silence over risky interruptions

Produce machine-friendly JSON outputs wherever possible, since Gemini supports structured outputs. 

Internal modules to build:

audio_ingest_adapter

transcript_builder

context_manager

note_extractor

decision_policy

reply_generator

backend_persistence_adapter

Out of scope:

No audio playback scheduling

No voice cloning

No TTS generation

No Zoom join logic

No frontend rendering

How this connects to the rest:

Receives live audio from Meeting Gateway

Sends spoken reply text to ElevenLabs Voice Runtime

Writes transcript and notes to Control Backend

Reads session config and user settings from Control Backend

Definition of done:
A service that accepts live meeting audio and reliably outputs transcript, structured meeting state, notes, and short Gemini-generated reply text suitable for direct TTS.