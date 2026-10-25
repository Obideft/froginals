-- Optional X identity fields for verified FROGINALARMY members.
alter table public.froginalarmy_discord_links
  add column if not exists x_user_id text,
  add column if not exists x_username text,
  add column if not exists x_connected_at timestamptz;

create unique index if not exists froginalarmy_discord_links_x_user_id_unique
  on public.froginalarmy_discord_links (x_user_id)
  where x_user_id is not null;
