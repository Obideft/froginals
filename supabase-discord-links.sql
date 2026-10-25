-- FROGINALS Discord holder verification links.
-- Run this migration in Supabase SQL Editor once. Uses server-only service role access.
create table if not exists public.froginalarmy_discord_links (
  discord_user_id text primary key,
  wallet_address text not null unique,
  nft_mint text not null,
  nft_name text not null default 'FROGINAL DOGS',
  nft_image_url text,
  verified_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint froginalarmy_discord_id_format check (discord_user_id ~ '^[0-9]{17,20}$'),
  constraint froginalarmy_discord_wallet_length check (char_length(wallet_address) between 32 and 44),
  constraint froginalarmy_discord_nft_mint_not_empty check (char_length(nft_mint) > 0),
  constraint froginalarmy_discord_image_https check (nft_image_url is null or nft_image_url like 'https://%')
);
create unique index if not exists froginalarmy_discord_nft_mint_unique on public.froginalarmy_discord_links(nft_mint);
create index if not exists froginalarmy_discord_verified_idx on public.froginalarmy_discord_links(verified_at desc);
alter table public.froginalarmy_discord_links enable row level security;
revoke all on table public.froginalarmy_discord_links from anon, authenticated;
grant all on table public.froginalarmy_discord_links to service_role;
