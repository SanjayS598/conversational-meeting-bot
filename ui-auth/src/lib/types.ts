// ─── Database row types ───────────────────────────────────────────────────────

export type MeetingStatus =
  | "created"
  | "joining"
  | "joined"
  | "reconnecting"
  | "failed"
  | "ended";

export type AgentMode = "notes_only" | "suggest_replies" | "auto_speak";

export type VoiceProfileStatus = "pending" | "ready" | "failed";

export interface UserPreferences {
  user_id: string;
  user_full_name?: string | null;
  agent_display_name: string;
  mode: AgentMode;
  tone: string;
  speak_threshold: number;
  default_meeting_provider: string;
  selected_voice_profile_id?: string | null;
}

export interface VoiceProfile {
  id: string;
  user_id: string;
  provider: string;
  provider_voice_id: string | null;
  display_name: string;
  status: VoiceProfileStatus;
  sample_count: number;
  consent_confirmed: boolean;
  created_at: string;
  updated_at?: string;
}

export interface MeetingSession {
  id: string;
  user_id: string;
  provider: string;
  meeting_url: string;
  status: MeetingStatus;
  started_at: string | null;
  ended_at: string | null;
}

export interface TranscriptSegment {
  id: string;
  session_id: string;
  speaker: string;
  text: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
}

export interface MeetingNote {
  id: string;
  session_id: string;
  summary: string;
  decisions_json: string[];
  questions_json: string[];
}

export interface ActionItem {
  id: string;
  session_id: string;
  owner: string;
  description: string;
  due_date: string | null;
  status: "open" | "done";
}

export interface AgentEvent {
  id: string;
  session_id: string;
  event_type: string;
  payload_json: Record<string, unknown>;
  created_at: string;
}

export interface PendingAgentResponse {
  text: string;
  reason: string;
  priority: "low" | "medium" | "high";
  requires_approval: boolean;
  max_speak_seconds: number;
  confidence: number;
}

// ─── Live session state (polled from control backend) ────────────────────────

export interface LiveSessionState {
  session: MeetingSession;
  transcript: TranscriptSegment[];
  notes: MeetingNote | null;
  action_items: ActionItem[];
  pending_response: PendingAgentResponse | null;
  agent_speaking: boolean;
  last_event: AgentEvent | null;
  transport_warning?: string | null;
}
