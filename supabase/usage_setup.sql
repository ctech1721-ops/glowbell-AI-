-- =====================================================================
-- Global AI — daily usage tracking for the Owner Dashboard.
-- Run ONCE in Supabase → SQL Editor.
-- =====================================================================
create table if not exists public.user_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  seconds integer not null default 0,
  last_seen timestamptz not null default now(),
  primary key (user_id, usage_date)
);

-- Only the server (service role) reads/writes this table.
alter table public.user_usage_daily enable row level security;

create index if not exists user_usage_daily_date_idx on public.user_usage_daily (usage_date);

create or replace function public.add_usage_seconds(p_user_id uuid, p_date date, p_seconds integer)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_usage_daily (user_id, usage_date, seconds, last_seen)
  values (p_user_id, p_date, greatest(p_seconds, 0), now())
  on conflict (user_id, usage_date)
  do update set seconds = public.user_usage_daily.seconds + greatest(excluded.seconds, 0),
                last_seen = now();
$$;

revoke all on function public.add_usage_seconds(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.add_usage_seconds(uuid, date, integer) to service_role;
