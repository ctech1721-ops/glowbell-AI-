-- =====================================================================
-- Global AI — SMS Friend: allow sending FILES (pdf, doc, xls, zip ...).
-- Run ONCE in Supabase → SQL Editor. Existing messages are not touched.
-- =====================================================================
alter table public.sms_messages add column if not exists media_name text;
alter table public.sms_messages add column if not exists media_size bigint;

alter table public.sms_messages drop constraint if exists sms_messages_media_type_check;
alter table public.sms_messages
  add constraint sms_messages_media_type_check check (media_type in ('image', 'video', 'file'));
