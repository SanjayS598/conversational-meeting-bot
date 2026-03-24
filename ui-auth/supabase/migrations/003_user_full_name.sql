-- Add user_full_name to user_preferences so signed-up users can provide
-- their real name for the agent greeting ("sent by <name> to represent <name>").
alter table public.user_preferences
  add column if not exists user_full_name text;
