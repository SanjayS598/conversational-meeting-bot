Chat prompt:

3) Voice Engineer
Title: ElevenLabs Voice Runtime and Cloning Service

Mission:
Build the personal voice system. This service is responsible for voice enrollment, storing cloned voice metadata, generating TTS in the user’s cloned voice, and scheduling/canceling speech playback so the meeting agent sounds like the user.

Why this component exists:
This is the feature that makes the project special. ElevenLabs documents Instant Voice Cloning through its API and also provides API-key-based speech generation. Build this component as a dedicated provider layer so personal voice is not mixed into Gemini logic. 

Credentials needed:

ElevenLabs API key

Internal backend auth token

Main responsibilities:

Accept voice sample uploads or references from the app

Create an ElevenLabs voice clone

Store cloned voice metadata and status

Accept reply text from Gemini Intelligence

Convert reply text into speech using the cloned voice

Queue speech jobs so only one playback happens at a time

Cancel or interrupt speech when meeting conditions change

Send final generated audio to Meeting Gateway

Emit runtime events like clone created, speech started, speech canceled, speech failed

Inputs:

user voice samples

user_id

session_id

reply text from Intelligence Service

voice style settings

speaking priority / interruption state

Outputs:

cloned voice metadata

voice status updates

speech audio buffers or stream references

playback runtime events

Required API contract:

POST /voices/enroll

POST /voices/:id/sample

POST /voices/:id/finalize

GET /voices/:id

POST /voices/preview

POST /runtime/sessions/:id/speak

POST /runtime/sessions/:id/cancel

GET /runtime/sessions/:id/state

Canonical objects:

VoiceProfile

id

user_id

provider

provider_voice_id

status

sample_count

consent_confirmed

created_at

SpeechJob

job_id

session_id

text

priority

state

audio_ref

VoiceRuntimeState

session_id

active_job_id

queue_depth

is_playing

last_interrupt_at

Runtime rules for v1:

One active speech job at a time

Cancel playback if someone else starts speaking unless the job is flagged urgent

Keep speech short for low latency

Log latency for text received, synthesis started, synthesis completed, playback sent, playback ended

Build the TTS provider behind an adapter, but ElevenLabs is mandatory in v1

Important data requirements:
The database must store:

whether the user consented to cloning

how many voice samples were uploaded

provider voice ID from ElevenLabs

profile status such as pending, ready, failed

Out of scope:

No transcript logic

No meeting summarization

No UI ownership

No Zoom connection logic

No deciding what text gets spoken

How this connects to the rest:

Receives reply text from Gemini Intelligence

Receives voice settings from Control Backend

Sends speech audio to Meeting Gateway

Sends clone/runtime status back to Control Backend

Definition of done:
A service that can create a usable cloned voice with ElevenLabs, generate short TTS outputs in that voice, and safely manage playback jobs for live meetings.

