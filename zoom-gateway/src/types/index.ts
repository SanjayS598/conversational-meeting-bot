// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export type SessionStatus =
  | 'created'
  | 'joining'
  | 'joined'
  | 'reconnecting'
  | 'failed'
  | 'ended';

// ---------------------------------------------------------------------------
// API input / output shapes
// ---------------------------------------------------------------------------

export interface StartSessionInput {
  /** Identifier created by the Control Backend, used as the session primary key. */
  meeting_session_id: string;
  user_id: string;
  /** Full Zoom meeting URL, e.g. https://zoom.us/j/12345678901?pwd=abc */
  meeting_url: string;
  /** Numeric passcode displayed in Zoom (not the URL pwd hash). */
  passcode?: string;
  /** Override the display name the bot uses inside the meeting. */
  bot_display_name?: string;
  /** Short description of what the meeting is about — passed to the AI brain for context. */
  meeting_objective?: string;
  /** Longer background notes or context for the AI brain. */
  prep_notes?: string;
  /** prep_id from /voice/prepare — activates conversational AI in the brain. */
  prep_id?: string;
  /** Selected voice profile id from the control backend. */
  voice_profile_id?: string;
  /** Selected ElevenLabs provider voice id for direct runtime TTS. */
  provider_voice_id?: string;
}

export interface Session {
  id: string;
  meeting_session_id: string;
  user_id: string;
  meeting_url: string;
  meeting_id: string;
  status: SessionStatus;
  created_at: Date;
  joined_at?: Date;
  ended_at?: Date;
  error?: string;
  bot_display_name: string;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/**
 * Wire format for /sessions/:id/audio-in WebSocket packets:
 *   bytes 0-7  : timestamp as BigInt64LE (ms since epoch)
 *   bytes 8-N  : raw int16 PCM, mono, 16 kHz
 */
export interface AudioPacketMeta {
  session_id: string;
  timestamp_ms: number;
  sample_rate: 16000;
  channels: 1;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type CanonicalEvent =
  | 'session.created'
  | 'session.joining'
  | 'session.joined'
  | 'session.failed'
  | 'session.reconnecting'
  | 'session.ended'
  | 'participant.updated'
  | 'audio.chunk.received'
  | 'audio.chunk.played'
  | 'error';

export interface SessionEvent {
  type: CanonicalEvent;
  session_id: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}
