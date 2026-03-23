alter table public.user_preferences
  add column if not exists selected_voice_profile_id uuid references public.voice_profiles(id) on delete set null;

alter table public.voice_profiles
  add column if not exists display_name text not null default 'My Voice',
  add column if not exists updated_at timestamptz not null default now();

alter table public.voice_profiles
  drop constraint if exists voice_profiles_user_id_key;

create index if not exists voice_profiles_user_created_idx
  on public.voice_profiles(user_id, created_at desc);