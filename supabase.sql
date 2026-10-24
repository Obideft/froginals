-- FROGINALARMY verified membership directory
-- Run in the Supabase SQL Editor. This is a new table and does not alter other tables.
create table if not exists public.froginalarmy_members (
  wallet_address text primary key,
  nft_mint text not null,
  nft_name text not null default 'FROGINAL DOGS',
  nft_image_url text,
  approved boolean not null default false,
  verified_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint froginalarmy_wallet_length check (char_length(wallet_address) between 32 and 44),
  constraint froginalarmy_nft_mint_not_empty check (char_length(nft_mint) > 0),
  constraint froginalarmy_image_https check (nft_image_url is null or nft_image_url like 'https://%')
);
create unique index if not exists froginalarmy_members_nft_mint_unique on public.froginalarmy_members(nft_mint);
create index if not exists froginalarmy_members_approved_verified_idx on public.froginalarmy_members(approved, verified_at desc);
alter table public.froginalarmy_members enable row level security;
-- Intentionally create no anon/authenticated SELECT, INSERT, UPDATE, or DELETE policies.
-- Only the server-side service-role key accesses this table; never expose that key to the browser.
revoke all on table public.froginalarmy_members from anon, authenticated;
grant all on table public.froginalarmy_members to service_role;
