-- FROGINAL DOGS post-mint welcome email claims
-- Run once in the Supabase SQL Editor before enabling the welcome form.
create table if not exists public.froginalarmy_welcome_emails (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  nft_mint text not null unique,
  nft_name text not null default 'FROGINAL DOGS',
  email text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint froginal_welcome_wallet_length check (char_length(wallet_address) between 32 and 44),
  constraint froginal_welcome_email_length check (char_length(email) between 3 and 254)
);
create index if not exists froginal_welcome_wallet_idx on public.froginalarmy_welcome_emails(wallet_address);
alter table public.froginalarmy_welcome_emails enable row level security;
revoke all on table public.froginalarmy_welcome_emails from anon, authenticated;
grant all on table public.froginalarmy_welcome_emails to service_role;
