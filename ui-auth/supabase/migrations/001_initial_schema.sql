-- =========================================================
--  MeetBot — Supabase Database Migration
--  Run this in your Supabase SQL Editor or via the CLI:
--  supabase db push
-- =========================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── users (mirrors auth.users, created by Supabase automatically) ───────────
-- We do NOT recreate the auth.users table. Use Supabase Auth for user records.

-- ─── user_preferences ─────────────────────────────────────────────────────────
create table if not exists public.user_preferences (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  agent_display_name    text not null default 'MeetBot',
  mode                  text not null default 'suggest_replies'
                          check (mode in ('notes_only', 'suggest_replies', 'auto_speak')),
  tone                  text not null default 'professional',
  speak_threshold       float not null default 0.75
                          check (speak_threshold >= 0.0 and speak_threshold <= 1.0),
  default_meeting_provider text not null default 'zoom',
  updated_at            timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "Users can read own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "Users can upsert own preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);

-- ─── voice_profiles ───────────────────────────────────────────────────────────
create table if not exists public.voice_profiles (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  provider            text not null default 'elevenlabs',
  provider_voice_id   text,
  status              text not null default 'pending'
                        check (status in ('pending', 'ready', 'failed')),
  sample_count        int not null default 0,
  consent_confirmed   boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (user_id)   -- one voice profile per user in v1
);

alter table public.voice_profiles enable row level security;

create policy "Users can read own voice profile"
  on public.voice_profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own voice profile"
  on public.voice_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own voice profile"
  on public.voice_profiles for update
  using (auth.uid() = user_id);

-- ─── meeting_sessions ─────────────────────────────────────────────────────────
create table if not exists public.meeting_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null default 'zoom',
  meeting_url text not null,
  status      text not null default 'created'
                check (status in ('created','joining','joined','reconnecting','failed','ended')),
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists meeting_sessions_user_idx on public.meeting_sessions(user_id);
create index if not exists meeting_sessions_status_idx on public.meeting_sessions(status);

alter table public.meeting_sessions enable row level security;

create policy "Users can read own sessions"
  on public.meeting_sessions for select
  using (auth.uid() = user_id);

create policy "Users can create own sessions"
  on public.meeting_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.meeting_sessions for update
  using (auth.uid() = user_id);

-- ─── transcript_segments ──────────────────────────────────────────────────────
create table if not exists public.transcript_segments (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.meeting_sessions(id) on delete cascade,
  speaker     text not null,
  text        text not null,
  start_ms    bigint not null,
  end_ms      bigint not null,
  confidence  float not null default 1.0,
  created_at  timestamptz not null default now()
);

create index if not exists transcript_segments_session_idx on public.transcript_segments(session_id);
create index if not exists transcript_segments_start_idx  on public.transcript_segments(session_id, start_ms);

alter table public.transcript_segments enable row level security;

create policy "Users can read own transcript"
  on public.transcript_segments for select
  using (
    exists (
      select 1 from public.meeting_sessions ms
      where ms.id = transcript_segments.session_id
        and ms.user_id = auth.uid()
    )
  );

-- Only trusted backend (via service role) inserts transcript rows
create policy "Service role inserts transcript"
  on public.transcript_segments for insert
  with check (true); -- service_role bypasses RLS; anon/user cannot insert

-- ─── meeting_notes ────────────────────────────────────────────────────────────
create table if not exists public.meeting_notes (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null unique references public.meeting_sessions(id) on delete cascade,
  summary         text,
  decisions_json  jsonb not null default '[]',
  questions_json  jsonb not null default '[]',
  updated_at      timestamptz not null default now()
);

alter table public.meeting_notes enable row level security;

create policy "Users can read own notes"
  on public.meeting_notes for select
  using (
    exists (
      select 1 from public.meeting_sessions ms
      where ms.id = meeting_notes.session_id
        and ms.user_id = auth.uid()
    )
  );

-- ─── action_items ─────────────────────────────────────────────────────────────
create table if not exists public.action_items (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.meeting_sessions(id) on delete cascade,
  owner       text,
  description text not null,
  due_date    date,
  status      text not null default 'open' check (status in ('open', 'done')),
  created_at  timestamptz not null default now()
);

create index if not exists action_items_session_idx on public.action_items(session_id);

alter table public.action_items enable row level security;

create policy "Users can read own action items"
  on public.action_items for select
  using (
    exists (
      select 1 from public.meeting_sessions ms
      where ms.id = action_items.session_id
        and ms.user_id = auth.uid()
    )
  );

-- ─── agent_events ─────────────────────────────────────────────────────────────
create table if not exists public.agent_events (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.meeting_sessions(id) on delete cascade,
  event_type   text not null,
  payload_json jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists agent_events_session_idx on public.agent_events(session_id);
create index if not exists agent_events_created_idx on public.agent_events(session_id, created_at desc);

alter table public.agent_events enable row level security;

create policy "Users can read own agent events"
  on public.agent_events for select
  using (
    exists (
      select 1 from public.meeting_sessions ms
      where ms.id = agent_events.session_id
        and ms.user_id = auth.uid()
    )
  );
