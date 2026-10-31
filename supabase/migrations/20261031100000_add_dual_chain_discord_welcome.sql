-- One-time Discord welcome delivery state for newly verified FROGINAL DOGS holders.
create table if not exists public.froginalarmy_discord_welcomes (
  discord_user_id text primary key,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  chain text not null check (chain in ('solana', 'robinhood')),
  wallet_address text not null,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint froginalarmy_discord_welcome_id_format check (discord_user_id ~ '^[0-9]{17,20}$')
);

alter table public.froginalarmy_discord_welcomes enable row level security;
revoke all on table public.froginalarmy_discord_welcomes from anon, authenticated;
grant all on table public.froginalarmy_discord_welcomes to service_role;

-- Record the chain used by each Discord link. Existing rows remain Solana links.
alter table public.froginalarmy_discord_links
  add column if not exists chain text not null default 'solana',
  add column if not exists nft_contract text,
  add column if not exists nft_balance text;

alter table public.froginalarmy_discord_links
  drop constraint if exists froginalarmy_discord_wallet_length;
alter table public.froginalarmy_discord_links
  add constraint froginalarmy_discord_wallet_length
  check (char_length(wallet_address) between 32 and 44);
