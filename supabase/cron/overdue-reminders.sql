-- ═══════════════════════════════════════════════════════════════════════════════
-- Tracker | Overdue-order Telegram reminders (pg_cron + pg_net)
--
-- Every scheduled run calls the `send-overdue-reminders` edge function, which
-- sends one polite plain-text message per supplier for orders that have been
-- สั่งแล้ว for more than OVERDUE_DAYS days (function secret, default 14).
-- Schedule: Monday to Friday 08:00 Asia/Bangkok (pg_cron runs in UTC, so
-- 08:00 Bangkok = 01:00 UTC).
--
-- One-time setup
--   1) Enable the extensions from Dashboard > Database > Extensions:
--        - pg_cron
--        - pg_net
--   2) Pick a long random secret and set it on the function:
--        supabase secrets set CRON_SECRET=<secret>
--      Store the SAME value in Vault (run once, replacing <secret>):
--        select vault.create_secret('<secret>', 'tracker_cron_secret',
--          'x-cron-secret header for send-overdue-reminders');
--   3) Deploy the function:
--        supabase functions deploy send-overdue-reminders
--   4) Run this file in Dashboard > SQL Editor.
--
-- Optional function secrets
--   OVERDUE_DAYS  threshold in days (default 14)
--   SIGNATURE     signature line (default งานเภสัชกรรม โรงพยาบาลสระโบสถ์)
--
-- To pause the reminders: select cron.unschedule('overdue-order-reminders');
-- To debug a run:
--   select status, return_message, start_time from cron.job_run_details
--   order by start_time desc limit 5;
--   select status_code, content, created from net._http_response
--   order by created desc limit 5;
-- ═══════════════════════════════════════════════════════════════════════════════

-- Stop with a clear message when the extensions were not enabled yet.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not enabled. Enable it in Dashboard > Database > Extensions, then run this file again.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net is not enabled. Enable it in Dashboard > Database > Extensions, then run this file again.';
  end if;
end
$$;

-- Re-running this file reschedules instead of stacking duplicate jobs.
select cron.unschedule('overdue-order-reminders')
where exists (select 1 from cron.job where jobname = 'overdue-order-reminders');

select cron.schedule(
  'overdue-order-reminders',
  '0 1 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://zfqdpsaxumpcqvfusiub.supabase.co/functions/v1/send-overdue-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'tracker_cron_secret'
      )
    ),
    -- Empty body: the threshold comes from the OVERDUE_DAYS secret. A manual
    -- run of this command can pass jsonb_build_object('days', N) to override.
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) as request_id;
  $job$
);
