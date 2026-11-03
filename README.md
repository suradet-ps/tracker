# Tracker

[![CI](https://github.com/suradet-ps/tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/suradet-ps/tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Vue v3](https://img.shields.io/badge/Vue-v3-4FC08D.svg?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript v6](https://img.shields.io/badge/TypeScript-v6-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite v8](https://img.shields.io/badge/Vite-v8-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Supabase v2](https://img.shields.io/badge/Supabase-v2-3FCF8E.svg?logo=supabase&logoColor=white)](https://supabase.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/suradet-ps/tracker/issues)

---

## ◆ PULSE

An order that sits in silence is an order no one trusts. This platform
carries a pharmaceutical order from purchase list to doorstep: add items
manually or from the quick-order catalogue, place the order, and watch its
status move from Ordered to Delivered - with a Telegram message when the
order is sent to the supplier. Procurement becomes a visible thread:
statuses, dates, and an immutable audit log in the database. The team is
told; the record is kept.

| Orders         | Workflow        | Telegram         | History         |
| -------------- | --------------- | ---------------- | --------------- |
| manual + quick | status workflow | send-time alerts | current + audit |

_The procurement loop - order, notify, confirm, audit - is sealed._

> Built with Vue 3 + Pinia + Vite, backed by Supabase, deployed to
> Firebase Hosting, speaking through Telegram.
>
> **suradet-ps**, artifact keeper

---

## ◆ IGNITION

One clone, one install, one command.

```
⟫ git clone https://github.com/suradet-ps/tracker.git
⟫ cd tracker
⟫ bun install
⟫ bun run dev
```

<details>
<summary>Environment</summary>

Copy `.env.example` to `.env` and fill the credentials:

```
VITE_SUPABASE_URL="YOUR_SUPABASE_PROJECT_URL"
VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
```

The Telegram bot token and chat id are Supabase Edge Function secrets,
not Vite variables - set them with
`supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...`.

Requires Bun 1.3.1 (pinned via `packageManager` in `package.json`), a
Supabase project, and a Telegram bot with its chat id.

</details>

<details>
<summary>Deploying the Telegram edge function</summary>

The notifier lives in `supabase/functions/send-telegram-notify`. It is invoked
when a pharmacist sends an order group from the order screen, not when a draft
is first created. It requires a signed-in pharmacist or admin, loads the order
rows itself, and builds the Telegram message server-side; the client only sends
order ids. It records each supplier group in the `telegram_notifications` table
so a retry after a timeout cannot send the same Telegram message twice. Apply
`supabase-schema.sql` first, then deploy with the Supabase CLI (Docker is not
required):

```
⟫ bunx supabase login
⟫ bunx supabase link --project-ref YOUR_PROJECT_REF
⟫ bunx supabase functions deploy send-telegram-notify
```

Secrets stay in the Supabase project (`TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`); they are never Vite variables. Firebase Hosting, Vercel
domains, and local development are allowed by default; for a custom domain,
set `ALLOWED_ORIGINS` to a comma-separated list of browser origins. Local CLI
state such as `supabase/.temp/` is ignored by git.

</details>

<details>
<summary>Staff access and roles</summary>

Procurement data is invite-only. Access is controlled by `public.profiles`:
a signed-in user with no profile row (or with role `pending`) can read
nothing, and only an administrator can change the allowlist.

| Role         | Read | Create / update                 | Delete                   |
| ------------ | ---- | ------------------------------- | ------------------------ |
| `viewer`     | yes  | -                               | -                        |
| `pharmacist` | yes  | orders, drugs, suppliers, plans | automatic plans          |
| `admin`      | yes  | yes                             | all records and profiles |

Deleting procurement records is admin-only; pharmacists can delete automatic
plans because that is the only delete action in the app. The
`generate-auto-orders` edge function also checks the caller's profile before a
manual run, since it writes with the service role and bypasses RLS.

**First deploy / existing project**

Run these steps before deploying the app, because the login flow now checks
the caller's profile.

1. Apply `supabase-schema.sql`. It creates `profiles` and replaces the blanket
   policies with role-scoped ones.
2. Bootstrap the first administrator in the SQL editor, replacing the email:
   ```sql
   insert into public.profiles (id, email, role)
   select id, email, 'admin'
   from auth.users
   where email = 'admin@hospital.go.th'
   on conflict (id) do update
     set email = excluded.email, role = 'admin', updated_at = now();
   ```
3. Add each staff member the same way with `'pharmacist'` or `'viewer'`.
   `auth.users` lists the accounts; a profile row is what grants access.
4. Turn off public sign-ups so new accounts cannot be created from the login
   endpoint. Either use Dashboard > Authentication > Settings and disable
   "Allow new users to sign up" (keep the Email provider enabled), or run
   `bunx supabase config diff` then `bunx supabase config push` to push
   `[auth] enable_signup = false` from `supabase/config.toml`.

Accounts without a staff role see a "waiting for approval" screen. Deleting
the profile row (or the auth user) revokes access immediately.

</details>

<details>
<summary>Enabling automatic purchase plans</summary>

The plan runner lives in `supabase/functions/generate-auto-orders` and
creates draft orders in `ต้องสั่งซื้อ`, then notifies the pharmacy chat.

1. Apply the new tables in `supabase-schema.sql` (`auto_order_plans`,
   `auto_order_runs`).
2. Deploy the function:
   `⟫ bunx supabase functions deploy generate-auto-orders`
3. Set the shared cron secret on the function and store the same value in
   Vault: `⟫ bunx supabase secrets set CRON_SECRET=...`.
4. Enable `pg_cron` + `pg_net`, then run
   [`supabase/cron/auto-order-plans.sql`](supabase/cron/auto-order-plans.sql).
   The job runs daily at 08:00 Asia/Bangkok.

A plan stores the historical usage you enter (quantity over a number of
months) and the reorder interval; the runner calculates the draft quantity
from those values. The page also has a dry-run button, so a plan can be
tested without writing orders or sending Telegram. Each plan uses the
calculated quantity by default; tick "กำหนดเอง" in the plan form to store an
explicit `order_quantity` per cycle (for example, to match a supplier's pack
size). Run `supabase-schema.sql` before deploying so the column exists.

</details>

<details>
<summary>Enabling overdue reminders</summary>

The reminder runner lives in `supabase/functions/send-overdue-reminders`. It
sends one plain-text follow-up per supplier for orders that have been
`สั่งแล้ว` longer than `OVERDUE_DAYS` (default 14). It only reads orders and
sends Telegram; it never changes procurement state.

1. Set `CRON_SECRET` as a function secret and store the same value in Vault.
   Optional: set `OVERDUE_DAYS` and `SIGNATURE`.
2. Deploy the function:
   `⟫ bunx supabase functions deploy send-overdue-reminders`
3. Enable `pg_cron` + `pg_net`, then run
   [`supabase/cron/overdue-reminders.sql`](supabase/cron/overdue-reminders.sql).
   The job runs Monday-Friday at 08:00 Asia/Bangkok.

</details>

Deploy: `⟫ bun run build` then either `⟫ firebase deploy` (the
`firebase.json` rewrites serve the SPA from `dist/`) or push to Vercel
(the `vercel.json` rewrites provide the same SPA fallback for deep links
such as `/to-receive`).

---

## ◆ ANATOMY

One workflow, six facets, and a messenger.

- **Orders** - add a single item manually or build a quick-order list from
  the catalogue. Both paths start in `ต้องสั่งซื้อ`, ready to send.
- **Plans** - opt-in automatic purchase plans turn the historical usage you
  enter and the reorder interval into a draft order on schedule, announced
  to the pharmacy chat for review before anything reaches a supplier.
- **Tracks** - every order carries its status from Ordered to Delivered
  through an interface built for one action: confirm the goods, move the
  line. The status is the state of truth.
- **Notifies** - the Telegram bot delivers the news when a pharmacist sends
  an order group, so the team learns from the phone in their pocket, not
  from a page they forgot to refresh.
- **Remembers** - the history view holds every past and current order with
  its current status and dates; an immutable event log in the database keeps
  actor, status transitions, and server timestamps for the audit.
- **Serves** - Vue 3 keeps the UI reactive, Pinia keeps the state
  consistent, Supabase holds the data, and Firebase Hosting ships the
  build with SPA rewrites already configured.

---

## ◆ RITUALS

**The core ceremony** - an order's journey:

1. Add the items manually or with quick order. The purchase list becomes an
   order, complete.
2. Place it. The status reads Ordered - and Telegram announces it when the
   order is sent to the supplier.
3. The goods arrive. One action confirms receipt; the status advances
   toward Delivered. Cancelled orders stay in the history with status
   `ยกเลิก`.
4. Audit anytime: the history view shows every order and its current dates;
   the immutable event log holds every status transition with actor and
   server time.

**The ceremony of the message** - a sent order is never silent. The bot
speaks when a pharmacist sends an order group, so "has the order gone out?"
is a question the team already knows the answer to.

**The ceremony of the record** - statuses, actors, and timestamps are
written down for every order, every time. If procurement is questioned six
months later, the answer is a scroll away in the database - and the current
state is always on the history screen.

---

## ◆ ECHOES

**Where this artifact is heading**

```
order    ▸ manual add and quick-order creation ───────────────────── ▸ sealed
track    ▸ Ordered to Delivered, one-action updates ──────────────── ▸ sealed
notify   ▸ Telegram delivery when an order is sent ───────────────── ▸ sealed
history  ▸ current-state history + immutable audit events ────────── ▸ sealed
```

**Raising the artifact** - the quality bar is the local checks and the
[CI workflow](.github/workflows/ci.yml): Deno type-check, ESLint, unit
tests, and the production build. The interface rules live in
[DESIGN.md](DESIGN.md); Supabase schema and edge functions live under
`supabase/`. Open an issue first to discuss a change.

**Quality gates** - run `bun run lint`, `bun run type-check`,
`bun run test`, and `bun run build`; edge functions are checked with
`deno check supabase/functions/*/index.ts`.

**Status** - CI runs on every push. The Firebase deploy workflow currently
triggers on `main` and builds independently, so it does not wait for CI;
gating it on the CI artifact is tracked in #98.

**Current scope** - order entry is manual add or quick order; CSV bulk import
is not part of this app. Immutable audit events live in
`purchase_order_events`; the history screen shows current state, and the
event-timeline UI is tracked in [#127](https://github.com/suradet-ps/tracker/issues/127).
Hosting rewrites serve deep links, but the login flow currently returns to
the order list; preserving the original path is tracked in
[#116](https://github.com/suradet-ps/tracker/issues/116).

---

```
  ─────────────────────────────────────────
   An order unannounced is an order
   nobody is waiting for.
  ─────────────────────────────────────────
```

Licensed under the [MIT License](LICENSE).
