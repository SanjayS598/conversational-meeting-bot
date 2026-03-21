Chat Prompt:

4) Fullstack / Backend Engineer
Title: UI, Auth, User Database, and Control Backend

Mission:
Build the product shell that connects everything together. This includes authentication, user settings, voice enrollment UI, meeting start/stop flows, live transcript UI, final notes UI, and the control API that coordinates all three backend services.

Why this component exists:
Without this layer, the project is just disconnected microservices. Supabase provides the auth and database foundation, including client-safe keys and server-side admin operations, while the control backend becomes the single orchestration point. 

Credentials needed:

Supabase project URL

Supabase anon key

Supabase service role key

server-side Gemini API key

server-side ElevenLabs API key

server-side Zoom credentials

Main responsibilities:

Handle signup/login

Store user profile and preferences

Store voice clone metadata

Create and manage meeting sessions

Start and stop the gateway/runtime/intelligence services

Persist transcript segments, notes, action items, and system events

Show live session state in the UI

Show final meeting summary

Provide a clean control-plane API for all components

Frontend pages:

/login

/dashboard

/meetings/new

/meetings/:id/live

/meetings/:id/summary

/settings/agent

/settings/voice

Minimum database tables:

users

id

email

created_at

user_preferences

user_id

agent_display_name

mode

tone

speak_threshold

default_meeting_provider

voice_profiles

id

user_id

provider

provider_voice_id

status

sample_count

consent_confirmed

created_at

meeting_sessions

id

user_id

provider

meeting_url

status

started_at

ended_at

transcript_segments

id

session_id

speaker

text

start_ms

end_ms

confidence

meeting_notes

id

session_id

summary

decisions_json

questions_json

action_items

id

session_id

owner

description

due_date

status

agent_events

id

session_id

event_type

payload_json

created_at

Required control API surface:

POST /api/meetings

POST /api/meetings/:id/start

POST /api/meetings/:id/stop

GET /api/meetings/:id

GET /api/meetings/:id/live

GET /api/meetings/:id/summary

GET /api/users/me/preferences

PUT /api/users/me/preferences

POST /api/voices/enroll

POST /api/voices/:id/sample

POST /api/voices/:id/finalize

GET /api/voices/:id

Security rules:

No secret keys in the browser

Supabase service role key stays server-side only

Gemini key stays server-side only

ElevenLabs key stays server-side only

Zoom OAuth credentials stay server-side only. Supabase explicitly warns that service-role operations are trusted-server only. 

Live UI requirements:
The live meeting page should show:

session state

transcript stream

agent speaking state

recent notes

action items

errors / reconnecting state

Out of scope:

No raw audio processing in the frontend

No direct TTS in the frontend

No direct Gemini prompting from browser code

No direct Zoom SDK secret handling in browser code

How this connects to the rest:

Starts and stops Meeting Gateway

Supplies config to Gemini Intelligence

Supplies voice profile info to ElevenLabs Runtime

Receives and stores all session events, transcript, notes, and voice status

Definition of done:
A usable web app and backend control layer that lets a user sign in, enroll their voice, launch a meeting assistant session, view live transcript/status, and read the final meeting notes afterward.