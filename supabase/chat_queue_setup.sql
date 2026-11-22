-- Global AI durable chat queue. Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.chat_tasks (
 id uuid primary key default gen_random_uuid(), request_id text not null unique,
 payload_hash text not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
 worker_id text, fencing_token bigint not null default 0, lease_expires_at timestamptz,
 retry_count integer not null default 0, available_at timestamptz not null default now(),
 max_retries integer not null default 3, result jsonb, last_error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.chat_tasks add column if not exists available_at timestamptz not null default now();
create index if not exists chat_tasks_claim_idx on public.chat_tasks(status,available_at,created_at) where status='pending';
create index if not exists chat_tasks_lease_idx on public.chat_tasks(lease_expires_at) where status='processing';
alter table public.chat_tasks enable row level security;
revoke all on public.chat_tasks from anon,authenticated;
grant all on public.chat_tasks to service_role;

create or replace function public.enqueue_chat_task(p_request_id text,p_payload_hash text,p_payload jsonb,p_max_retries integer default 3)
returns public.chat_tasks language plpgsql security definer set search_path=public as $$
declare t public.chat_tasks;
begin
 if length(coalesce(p_request_id,''))<8 or length(p_request_id)>200 then raise exception 'Invalid request id'; end if;
 insert into public.chat_tasks(request_id,payload_hash,payload,max_retries) values(p_request_id,p_payload_hash,p_payload,greatest(1,least(coalesce(p_max_retries,3),10))) on conflict(request_id) do nothing;
 select * into t from public.chat_tasks where request_id=p_request_id for update;
 if t.payload_hash<>p_payload_hash then raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'; end if;
 return t;
end; $$;

create or replace function public.claim_chat_task(p_worker_id text,p_lease_seconds integer default 120)
returns setof public.chat_tasks language sql security definer set search_path=public as $$
 with candidate as (select id from public.chat_tasks where status='pending' and retry_count<max_retries and available_at<=clock_timestamp() order by created_at for update skip locked limit 1)
 update public.chat_tasks t set status='processing',worker_id=p_worker_id,fencing_token=t.fencing_token+1,
 lease_expires_at=clock_timestamp()+make_interval(secs=>greatest(15,least(p_lease_seconds,600))),updated_at=clock_timestamp()
 from candidate c where t.id=c.id returning t.*;
$$;

create or replace function public.heartbeat_chat_task(p_task_id uuid,p_worker_id text,p_fencing_token bigint,p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 update public.chat_tasks set lease_expires_at=clock_timestamp()+make_interval(secs=>greatest(15,least(p_lease_seconds,600))),updated_at=clock_timestamp()
 where id=p_task_id and status='processing' and worker_id=p_worker_id and fencing_token=p_fencing_token and lease_expires_at>clock_timestamp();
 get diagnostics n=row_count; return n=1;
end; $$;

create or replace function public.complete_chat_task(p_task_id uuid,p_worker_id text,p_fencing_token bigint,p_result jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 update public.chat_tasks set status='completed',result=p_result,last_error=null,worker_id=null,lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_task_id and status='processing' and worker_id=p_worker_id and fencing_token=p_fencing_token and lease_expires_at>clock_timestamp();
 get diagnostics n=row_count; return n=1;
end; $$;

create or replace function public.fail_chat_task(p_task_id uuid,p_worker_id text,p_fencing_token bigint,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 update public.chat_tasks set retry_count=retry_count+1,status=case when retry_count+1>=max_retries then 'failed' else 'pending' end,
 last_error=left(coalesce(p_error,'Unknown worker error'),1000),worker_id=null,lease_expires_at=null,
 available_at=clock_timestamp()+make_interval(secs=>least(60,power(2,least(retry_count,6))::integer)),updated_at=clock_timestamp()
 where id=p_task_id and status='processing' and worker_id=p_worker_id and fencing_token=p_fencing_token and lease_expires_at>clock_timestamp();
 get diagnostics n=row_count; return n=1;
end; $$;

create or replace function public.recover_expired_chat_tasks(p_batch_size integer default 100)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 with expired as (select id from public.chat_tasks where status='processing' and lease_expires_at<=clock_timestamp() order by lease_expires_at for update skip locked limit greatest(1,least(p_batch_size,1000)))
 update public.chat_tasks t set fencing_token=t.fencing_token+1,retry_count=t.retry_count+1,
 status=case when t.retry_count+1>=t.max_retries then 'failed' else 'pending' end,
 worker_id=null,lease_expires_at=null,available_at=clock_timestamp()+make_interval(secs=>least(60,power(2,least(t.retry_count,6))::integer)),
 last_error='Worker lease expired; task recovered',updated_at=clock_timestamp() from expired e where t.id=e.id;
 get diagnostics n=row_count; return n;
end; $$;

revoke all on function public.enqueue_chat_task(text,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.claim_chat_task(text,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_chat_task(uuid,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.complete_chat_task(uuid,text,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.fail_chat_task(uuid,text,bigint,text) from public,anon,authenticated;
revoke all on function public.recover_expired_chat_tasks(integer) from public,anon,authenticated;
grant execute on function public.enqueue_chat_task(text,text,jsonb,integer) to service_role;
grant execute on function public.claim_chat_task(text,integer) to service_role;
grant execute on function public.heartbeat_chat_task(uuid,text,bigint,integer) to service_role;
grant execute on function public.complete_chat_task(uuid,text,bigint,jsonb) to service_role;
grant execute on function public.fail_chat_task(uuid,text,bigint,text) to service_role;
grant execute on function public.recover_expired_chat_tasks(integer) to service_role;

