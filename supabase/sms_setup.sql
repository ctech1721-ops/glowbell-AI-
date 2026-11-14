-- =====================================================================
-- Global AI — "SMS Friend" setup.   Run ONCE in Supabase → SQL Editor.
-- Private friend-to-friend chat (text, photos, videos). Not connected to AI.
-- =====================================================================

-- 1) Profiles (so friends can be found by e-mail) ----------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_email_lower_idx on public.profiles (lower(email));
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id);

-- create a profile automatically for every new sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles for users that already exist
insert into public.profiles (id, email, name)
select id, lower(email), coalesce(raw_user_meta_data->>'full_name', '')
from auth.users
on conflict (id) do nothing;

-- 2) Friends ------------------------------------------------------------
create table if not exists public.sms_friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  friend_email text not null,
  friend_name text,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);
alter table public.sms_friends enable row level security;
drop policy if exists "sms_friends_select_own" on public.sms_friends;
drop policy if exists "sms_friends_delete_own" on public.sms_friends;
create policy "sms_friends_select_own" on public.sms_friends for select to authenticated using (auth.uid() = user_id);
create policy "sms_friends_delete_own" on public.sms_friends for delete to authenticated using (auth.uid() = user_id);

-- add a friend by e-mail (adds both sides, so the friend sees you too)
create or replace function public.sms_add_friend(p_email text)
returns table (out_id uuid, out_email text, out_name text)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  me_row public.profiles;
  f public.profiles;
begin
  if me is null then raise exception 'Please log in first.'; end if;
  select * into f from public.profiles where lower(email) = lower(trim(p_email)) limit 1;
  if f.id is null then
    raise exception 'No Global AI user found with that email. Ask your friend to sign up first.';
  end if;
  if f.id = me then raise exception 'You cannot add yourself.'; end if;
  select * into me_row from public.profiles where id = me;

  insert into public.sms_friends (user_id, friend_id, friend_email, friend_name)
  values (me, f.id, f.email, f.name) on conflict do nothing;
  insert into public.sms_friends (user_id, friend_id, friend_email, friend_name)
  values (f.id, me, me_row.email, me_row.name) on conflict do nothing;

  return query select f.id, f.email, f.name;
end $$;
revoke all on function public.sms_add_friend(text) from public;
grant execute on function public.sms_add_friend(text) to authenticated;

-- 3) Messages -----------------------------------------------------------
create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  body text,
  media_path text,
  media_type text check (media_type in ('image', 'video')),
  created_at timestamptz not null default now()
);
create index if not exists sms_messages_pair_idx on public.sms_messages (sender_id, receiver_id, created_at);
create index if not exists sms_messages_recv_idx on public.sms_messages (receiver_id, created_at);
alter table public.sms_messages enable row level security;

drop policy if exists "sms_messages_select" on public.sms_messages;
drop policy if exists "sms_messages_insert" on public.sms_messages;
drop policy if exists "sms_messages_delete" on public.sms_messages;
create policy "sms_messages_select" on public.sms_messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);
create policy "sms_messages_insert" on public.sms_messages for insert to authenticated
  with check (
    auth.uid() = sender_id
    and exists (select 1 from public.sms_friends f where f.user_id = sender_id and f.friend_id = receiver_id)
  );
create policy "sms_messages_delete" on public.sms_messages for delete to authenticated
  using (auth.uid() = sender_id);

-- live updates
do $$ begin
  alter publication supabase_realtime add table public.sms_messages;
exception when duplicate_object then null; end $$;

-- 4) Private storage for photos & videos (50 MB per file) ----------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('sms-media', 'sms-media', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "sms_media_insert" on storage.objects;
drop policy if exists "sms_media_select" on storage.objects;
drop policy if exists "sms_media_delete" on storage.objects;
-- files live at  <sender_id>/<receiver_id>/<file>
create policy "sms_media_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sms-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "sms_media_select" on storage.objects for select to authenticated
  using (bucket_id = 'sms-media'
         and (auth.uid()::text = (storage.foldername(name))[1] or auth.uid()::text = (storage.foldername(name))[2]));
create policy "sms_media_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sms-media' and (storage.foldername(name))[1] = auth.uid()::text);
