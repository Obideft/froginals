-- FROGINALS X bot: encrypted OAuth tokens. Run once in Supabase SQL Editor.
create table if not exists public.froginals_x_bot_tokens (
  id text primary key check (id = 'primary'),
  x_user_id text not null,
  username text not null,
  display_name text not null default '',
  token_ciphertext text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.froginals_x_bot_tokens enable row level security;
revoke all on table public.froginals_x_bot_tokens from anon, authenticated;
grant all on table public.froginals_x_bot_tokens to service_role;
