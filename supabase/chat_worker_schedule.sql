-- Global AI scheduled chat worker.
-- Run ONLY after deploying supabase/functions/global-ai-chat-worker and setting
-- its secrets. Replace the two placeholders before running this SQL.
-- The trigger secret must exactly match the Edge Function's WORKER_TRIGGER_SECRET.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

-- Store the project URL and a dedicated random trigger secret in Vault.
-- Do not use a Supabase service-role key as the cron trigger secret.
select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co',
  'global_ai_worker_project_url'
);
select vault.create_secret(
  'REPLACE_WITH_THE_SAME_RANDOM_WORKER_TRIGGER_SECRET',
  'global_ai_worker_trigger_secret'
);

-- One invocation claims and processes one task. The queue RPC uses
-- FOR UPDATE SKIP LOCKED, so overlapping invocations cannot claim the same task.
select cron.schedule(
  'global-ai-chat-worker-every-30-seconds',
  '30 seconds',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'global_ai_worker_project_url')
             || '/functions/v1/global-ai-chat-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-trigger-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'global_ai_worker_trigger_secret')
      ),
      body := jsonb_build_object('triggered_at', now()),
      timeout_milliseconds := 5000
    );
  $$
);

-- Verify the schedule:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'global-ai-chat-worker-every-30-seconds';
-- View recent runs:
-- select * from cron.job_run_details order by start_time desc limit 20;
