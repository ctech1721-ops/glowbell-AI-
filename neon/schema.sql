-- =====================================================================
-- Global AI — complete Neon (PostgreSQL) schema.
-- Run ONCE: Neon Console -> SQL Editor (or: psql "$DATABASE_URL" -f neon/schema.sql)
-- Safe to re-run: everything uses IF NOT EXISTS / CREATE OR REPLACE.
-- Replaces all the old supabase/*.sql files.
-- =====================================================================
create extension if not exists pgcrypto;

-- 1) Users (replaces Supabase auth.users + public.profiles) -------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text not null default '',
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
create unique index if not exists users_email_lower_idx on public.users (lower(email));

create table if not exists public.password_resets (
  token_hash text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists password_resets_user_idx on public.password_resets (user_id);

-- 2) Saved AI chats ------------------------------------------------------
create table if not exists public.chats (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);

-- 3) SMS Friend ----------------------------------------------------------
create table if not exists public.sms_friends (
  user_id uuid not null references public.users(id) on delete cascade,
  friend_id uuid not null references public.users(id) on delete cascade,
  friend_email text not null,
  friend_name text,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

create table if not exists public.sms_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  receiver_id  uuid not null references public.users(id) on delete cascade,
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

create table if not exists public.sms_blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  blocked_email text not null,
  blocked_name  text,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- Photos / videos / files are stored in Postgres in chunks (Neon has no
-- object storage). One row here + N rows in sms_media_parts (<= 3 MB each).
create table if not exists public.sms_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  content_type text not null default 'application/octet-stream',
  size bigint not null default 0,
  parts integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.sms_media_parts (
  media_id uuid not null references public.sms_media(id) on delete cascade,
  idx integer not null,
  data bytea not null,
  primary key (media_id, idx)
);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  body text,
  media_path text,            -- id of the row in sms_media (kept name for compatibility)
  media_type text check (media_type in ('image', 'video', 'file')),
  media_name text,
  media_size bigint,
  created_at timestamptz not null default now()
);
create index if not exists sms_messages_pair_idx on public.sms_messages (sender_id, receiver_id, created_at);
create index if not exists sms_messages_recv_idx on public.sms_messages (receiver_id, created_at);

-- Send a friend request by e-mail.
-- returns status: 'sent' | 'accepted' (they had already asked you) | 'already_friends'
create or replace function public.sms_send_request(p_me uuid, p_email text)
returns table (out_status text, out_id uuid, out_email text, out_name text)
language plpgsql as $$
declare
  me_row public.users;
  f public.users;
  incoming public.sms_requests;
begin
  if p_me is null then raise exception 'Please log in first.'; end if;
  select * into f from public.users where lower(email) = lower(trim(p_email)) limit 1;
  if f.id is null then
    raise exception 'No Global AI user found with that email. Ask them to sign up first.';
  end if;
  if f.id = p_me then raise exception 'You cannot add yourself.'; end if;
  select * into me_row from public.users where id = p_me;

  if exists (select 1 from public.sms_blocks where blocker_id = p_me and blocked_id = f.id) then
    raise exception 'You blocked this user. Unblock them first.';
  end if;

  if exists (select 1 from public.sms_friends where user_id = p_me and friend_id = f.id) then
    return query select 'already_friends'::text, f.id, f.email, f.name; return;
  end if;

  select * into incoming from public.sms_requests
    where requester_id = f.id and receiver_id = p_me and status = 'pending';
  if incoming.id is not null and not exists
     (select 1 from public.sms_blocks where blocker_id = f.id and blocked_id = p_me) then
    update public.sms_requests set status = 'accepted', responded_at = now() where id = incoming.id;
    insert into public.sms_friends (user_id, friend_id, friend_email, friend_name)
      values (p_me, f.id, f.email, f.name) on conflict do nothing;
    insert into public.sms_friends (user_id, friend_id, friend_email, friend_name)
      values (f.id, p_me, me_row.email, me_row.name) on conflict do nothing;
    return query select 'accepted'::text, f.id, f.email, f.name; return;
  end if;

  -- if they blocked me, act as if the request was sent (no hint to the sender)
  if exists (select 1 from public.sms_blocks where blocker_id = f.id and blocked_id = p_me) then
    return query select 'sent'::text, f.id, f.email, f.name; return;
  end if;

  insert into public.sms_requests
    (requester_id, receiver_id, requester_email, requester_name, receiver_email, receiver_name, status)
  values (p_me, f.id, me_row.email, me_row.name, f.email, f.name, 'pending')
  on conflict (requester_id, receiver_id)
  do update set status = 'pending', created_at = now(), responded_at = null,
                requester_email = excluded.requester_email, requester_name = excluded.requester_name;

  return query select 'sent'::text, f.id, f.email, f.name;
end $$;

-- Answer a request: accept | reject | block
create or replace function public.sms_respond_request(p_me uuid, p_request uuid, p_action text)
returns void language plpgsql as $$
declare
  r public.sms_requests;
begin
  if p_me is null then raise exception 'Please log in first.'; end if;
  select * into r from public.sms_requests where id = p_request and receiver_id = p_me;
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
      values (p_me, r.requester_id, r.requester_email, r.requester_name) on conflict do nothing;
  else
    raise exception 'Unknown action.';
  end if;
end $$;

create or replace function public.sms_block_user(p_me uuid, p_user uuid)
returns void language plpgsql as $$
declare
  u public.users;
begin
  if p_me is null then raise exception 'Please log in first.'; end if;
  select * into u from public.users where id = p_user;
  if u.id is null or u.id = p_me then raise exception 'User not found.'; end if;
  insert into public.sms_blocks (blocker_id, blocked_id, blocked_email, blocked_name)
    values (p_me, u.id, u.email, u.name) on conflict do nothing;
  -- blocking ends the friendship on both sides
  delete from public.sms_friends
    where (user_id = p_me and friend_id = u.id) or (user_id = u.id and friend_id = p_me);
  update public.sms_requests set status = 'rejected', responded_at = now()
    where status = 'pending' and requester_id = u.id and receiver_id = p_me;
end $$;

create or replace function public.sms_unblock_user(p_me uuid, p_user uuid)
returns void language plpgsql as $$
begin
  if p_me is null then raise exception 'Please log in first.'; end if;
  delete from public.sms_blocks where blocker_id = p_me and blocked_id = p_user;
end $$;

-- 4) Owner dashboard: daily usage ------------------------------------------
create table if not exists public.user_usage_daily (
  user_id uuid not null references public.users(id) on delete cascade,
  usage_date date not null,
  seconds integer not null default 0,
  last_seen timestamptz not null default now(),
  primary key (user_id, usage_date)
);
create index if not exists user_usage_daily_date_idx on public.user_usage_daily (usage_date);

create or replace function public.add_usage_seconds(p_user_id uuid, p_date date, p_seconds integer)
returns void language sql as $$
  insert into public.user_usage_daily (user_id, usage_date, seconds, last_seen)
  values (p_user_id, p_date, greatest(p_seconds, 0), now())
  on conflict (user_id, usage_date)
  do update set seconds = public.user_usage_daily.seconds + greatest(excluded.seconds, 0),
                last_seen = now();
$$;

-- 5) Durable chat queue (same logic as before, now plain Postgres) ---------
create table if not exists public.chat_tasks (
 id uuid primary key default gen_random_uuid(), request_id text not null unique,
 payload_hash text not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
 worker_id text, fencing_token bigint not null default 0, lease_expires_at timestamptz,
 retry_count integer not null default 0, available_at timestamptz not null default now(),
 max_retries integer not null default 3, result jsonb, last_error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists chat_tasks_claim_idx on public.chat_tasks(status,available_at,created_at) where status='pending';
create index if not exists chat_tasks_lease_idx on public.chat_tasks(lease_expires_at) where status='processing';

create or replace function public.enqueue_chat_task(p_request_id text,p_payload_hash text,p_payload jsonb,p_max_retries integer default 3)
returns public.chat_tasks language plpgsql as $$
declare t public.chat_tasks;
begin
 if length(coalesce(p_request_id,''))<8 or length(p_request_id)>200 then raise exception 'Invalid request id'; end if;
 insert into public.chat_tasks(request_id,payload_hash,payload,max_retries) values(p_request_id,p_payload_hash,p_payload,greatest(1,least(coalesce(p_max_retries,3),10))) on conflict(request_id) do nothing;
 select * into t from public.chat_tasks where request_id=p_request_id for update;
 if t.payload_hash<>p_payload_hash then raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'; end if;
 return t;
end; $$;

create or replace function public.claim_chat_task(p_worker_id text,p_lease_seconds integer default 120)
returns setof public.chat_tasks language sql as $$
 with candidate as (select id from public.chat_tasks where status='pending' and retry_count<max_retries and available_at<=clock_timestamp() order by created_at for update skip locked limit 1)
 update public.chat_tasks t set status='processing',worker_id=p_worker_id,fencing_token=t.fencing_token+1,
 lease_expires_at=clock_timestamp()+make_interval(secs=>greatest(15,least(p_lease_seconds,600))),updated_at=clock_timestamp()
 from candidate c where t.id=c.id returning t.*;
$$;

create or replace function public.heartbeat_chat_task(p_task_id uuid,p_worker_id text,p_fencing_token bigint,p_lease_seconds integer default 120)
returns boolean language plpgsql as $$
declare n integer;
begin
 update public.chat_tasks set lease_expires_at=clock_timestamp()+make_interval(secs=>greatest(15,least(p_lease_seconds,600))),updated_at=clock_timestamp()
 where id=p_task_id and status='processing' and worker_id=p_worker_id and fencing_token=p_fencing_token and lease_expires_at>clock_timestamp();
 get diagnostics n=row_count; return n=1;
end; $$;

create or replace function public.complete_chat_task(p_task_id uuid,p_worker_id text,p_fencing_token bigint,p_result jsonb)
returns boolean language plpgsql as $$
declare n integer;
begin
 update public.chat_tasks set status='completed',result=p_result,last_error=null,worker_id=null,lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_task_id and status='processing' and worker_id=p_worker_id and fencing_token=p_fencing_token and lease_expires_at>clock_timestamp();
 get diagnostics n=row_count; return n=1;
end; $$;

create or replace function public.fail_chat_task(p_task_id uuid,p_worker_id text,p_fencing_token bigint,p_error text)
returns boolean language plpgsql as $$
declare n integer;
begin
 update public.chat_tasks set retry_count=retry_count+1,status=case when retry_count+1>=max_retries then 'failed' else 'pending' end,
 last_error=left(coalesce(p_error,'Unknown worker error'),1000),worker_id=null,lease_expires_at=null,
 available_at=clock_timestamp()+make_interval(secs=>least(60,power(2,least(retry_count,6))::integer)),updated_at=clock_timestamp()
 where id=p_task_id and status='processing' and worker_id=p_worker_id and fencing_token=p_fencing_token and lease_expires_at>clock_timestamp();
 get diagnostics n=row_count; return n=1;
end; $$;

create or replace function public.recover_expired_chat_tasks(p_batch_size integer default 100)
returns integer language plpgsql as $$
declare n integer;
begin
 with expired as (select id from public.chat_tasks where status='processing' and lease_expires_at<=clock_timestamp() order by lease_expires_at for update skip locked limit greatest(1,least(p_batch_size,1000)))
 update public.chat_tasks t set fencing_token=t.fencing_token+1,retry_count=t.retry_count+1,
 status=case when t.retry_count+1>=t.max_retries then 'failed' else 'pending' end,
 worker_id=null,lease_expires_at=null,available_at=clock_timestamp()+make_interval(secs=>least(60,power(2,least(t.retry_count,6))::integer)),
 last_error='Worker lease expired; task recovered',updated_at=clock_timestamp() from expired e where t.id=e.id;
 get diagnostics n=row_count; return n;
end; $$;
