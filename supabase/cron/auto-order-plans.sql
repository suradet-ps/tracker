-- ═══════════════════════════════════════════════════════════════════════════════
-- Tracker | Automatic purchase-plan runs (pg_cron + pg_net)
--
-- Every scheduled run calls the `generate-auto-orders` edge function, which
-- creates a draft purchase order (status ต้องสั่งซื้อ) for each active plan whose
-- next_order_date is due, then sends one Telegram summary to the pharmacy chat.
-- Schedule: daily 08:00 Asia/Bangkok (pg_cron runs in UTC, so 01:00 UTC).
--
-- One-time setup
--   1) Enable the extensions from Dashboard > Database > Extensions:
--        - pg_cron
--        - pg_net
--   2) Reuse the cron secret from the overdue reminders (or create one):
--        supabase secrets set CRON_SECRET=<secret>
--      Store the SAME value in Vault if it is not there yet:
--        select vault.create_secret('<secret>', 'tracker_cron_secret',
--          'x-cron-secret header for Tracker scheduled functions');
--   3) Deploy the function:
--        supabase functions deploy generate-auto-orders
--   4) Run this file in Dashboard > SQL Editor.
--
-- To pause the runs: select cron.unschedule('auto-order-plans');
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
select cron.unschedule('auto-order-plans')
where exists (select 1 from cron.job where jobname = 'auto-order-plans');

select cron.schedule(
  'auto-order-plans',
  '0 1 * * *',
  $job$
  select net.http_post(
    url := 'https://zfqdpsaxumpcqvfusiub.supabase.co/functions/v1/generate-auto-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'tracker_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) as request_id;
  $job$
);
