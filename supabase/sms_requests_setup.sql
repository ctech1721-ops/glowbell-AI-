-- =====================================================================
-- Global AI — SMS Friend: friend REQUESTS + BLOCK.
-- Run ONCE in Supabase → SQL Editor, AFTER sms_setup.sql.
-- Existing friends and messages are not touched.
-- =====================================================================

-- 1) Friend requests ----------------------------------------------------
create table if not exists public.sms_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  receiver_id  uuid not null references auth.users(id) on delete cascade,
  requester_email text not null,
  requester_name  text,
  receiver_email  text not null,
  receiver_name   text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (requester_id, receiver_id)
);
create index if not exists sms_requests_recv_idx on public.sms_requests (receiver_id, status);
alter table public.sms_requests enable row level security;
drop policy if exists "sms_requests_select" on public.sms_requests;
-- read-only for clients: every change goes through the functions below
create policy "sms_requests_select" on public.sms_requests for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = receiver_id);

-- 2) Blocks -------------------------------------------------------------
create table if not exists public.sms_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  blocked_email text not null,
  blocked_name  text,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table public.sms_blocks enable row level security;
drop policy if exists "sms_blocks_select" on public.sms_blocks;
create policy "sms_blocks_select" on public.sms_blocks for select to authenticated
  using (auth.uid() = blocker_id);

-- 3) The old "add friend instantly" function is replaced by requests ----
drop function if exists public.sms_add_friend(text);

-- 4) Send a request by e-mail -------------------------------------------
-- returns: 'sent' | 'accepted' (they had already asked you) | 'already_friends'
create or replace function public.sms_send_request(p_email text)
returns table (out_status text, out_id uuid, out_email text, out_name text)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  me_row public.profiles;
  f public.profiles;
  incoming public.sms_requests;
begin
  if me is null then raise exception 'Please log in first.'; end if;
  select * into f from public.profiles where lower(email) = lower(trim(p_email)) limit 1;
  if f.id is null then
    raise exception 'No Global AI user found with that email. Ask them to sign up first.';
  end if;
  if f.id = me then raise exception 'You cannot add yourself.'; end if;
  select * into me_row from public.profiles where id = me;

  if exists (select 1 from public.sms_blocks where blocker_id = me and blocked_id = f.id) then
    raise exception 'You blocked this user. Unblock them first.';
  end if;

  if exists (select 1 from public.sms_friends where user_id = me and friend_id = f.id) then
    return query select 'already_friends'::text, f.id, f.email, f.name; return;
  end if;

  -- if they already sent ME a request, sending one back simply accepts it
  select * into incoming from public.sms_requests
    where requester_id = f.id and receiver_id = me and status = 'pending';
  if incoming.id is not null and not exists
     (select 1 from public.sms_blocks where blocker_id = f.id and blocked_id = me) then
    update public.sms_requests set status = 'accepted', responded_at = now() where id = incoming.id;
    insert into public.sms_friends (user_id, friend_id, friend_email, friend_name)
      values (me, f.id, f.email, f.name) on conflict do nothing;
    insert into public.sms_friends (user_id, friend_id, friend_email, friend_name)
      values (f.id, me, me_row.email, me_row.name) on conflict do nothing;
    return query select 'accepted'::text, f.id, f.email, f.name; return;
  end if;

  -- if they blocked me, act as if the request was sent (no hint to the sender)
  if exists (select 1 from public.sms_blocks where blocker_id = f.id and blocked_id = me) then
    return query select 'sent'::text, f.id, f.email, f.name; return;
  end if;

  insert into public.sms_requests
    (requester_id, receiver_id, requester_email, requester_name, receiver_email, receiver_name, status)
  values (me, f.id, me_row.email, me_row.name, f.email, f.name, 'pending')
  on conflict (requester_id, receiver_id)
  do update set status = 'pending', created_at = now(), responded_at = null,
                requester_email = excluded.requester_email, requester_name = excluded.requester_name;

  return query select 'sent'::text, f.id, f.email, f.name;
end $$;
revoke all on function public.sms_send_request(text) from public;
grant execute on function public.sms_send_request(text) to authenticated;

-- 5) Answer a request: accept | reject | block ---------------------------
create or replace function public.sms_respond_request(p_request uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r public.sms_requests;
begin
  if me is null then raise exception 'Please log in first.'; end if;
  select * into r from public.sms_requests where id = p_request and receiver_id = me;
  if r.id is null then raise exception 'Request not found.'; end if;

  if p_action = 'accept' then
    update public.sms_requests set status = 'accepted', responded_at = now() where id = r.id;
    insert into public.sms_friends (user_id, friend_id, friend_email, friend_name)
      values (r.receiver_id, r.requester_id, r.requester_email, r.requester_name) on conflict do nothing;
    insert into public.sms_friends (user_id, friend_id, friend_email, friend_name)
      values (r.requester_id, r.receiver_id, r.receiver_email, r.receiver_name) on conflict do nothing;
  elsif p_action = 'reject' then
    update public.sms_requests set status = 'rejected', responded_at = now() where id = r.id;
  elsif p_action = 'block' then
    update public.sms_requests set status = 'rejected', responded_at = now() where id = r.id;
    insert into public.sms_blocks (blocker_id, blocked_id, blocked_email, blocked_name)
      values (me, r.requester_id, r.requester_email, r.requester_name) on conflict do nothing;
  else
    raise exception 'Unknown action.';
  end if;
end $$;
revoke all on function public.sms_respond_request(uuid, text) from public;
grant execute on function public.sms_respond_request(uuid, text) to authenticated;

-- 6) Block / unblock someone (also from inside a chat) --------------------
create or replace function public.sms_block_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  u public.profiles;
begin
  if me is null then raise exception 'Please log in first.'; end if;
  select * into u from public.profiles where id = p_user;
  if u.id is null or u.id = me then raise exception 'User not found.'; end if;
  insert into public.sms_blocks (blocker_id, blocked_id, blocked_email, blocked_name)
    values (me, u.id, u.email, u.name) on conflict do nothing;
  -- blocking ends the friendship on both sides, so messages can no longer be sent
  delete from public.sms_friends
    where (user_id = me and friend_id = u.id) or (user_id = u.id and friend_id = me);
  update public.sms_requests set status = 'rejected', responded_at = now()
    where status = 'pending' and requester_id = u.id and receiver_id = me;
end $$;
revoke all on function public.sms_block_user(uuid) from public;
grant execute on function public.sms_block_user(uuid) to authenticated;

create or replace function public.sms_unblock_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in first.'; end if;
  delete from public.sms_blocks where blocker_id = auth.uid() and blocked_id = p_user;
end $$;
revoke all on function public.sms_unblock_user(uuid) from public;
grant execute on function public.sms_unblock_user(uuid) to authenticated;

-- 7) Live updates for requests ---------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.sms_requests;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.sms_friends;
exception when duplicate_object then null; end $$;
