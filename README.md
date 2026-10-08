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
carries a pharmaceutical order from CSV to doorstep: bulk-import the
purchase list, place the order, and watch its status move from Ordered to
Delivered - with a Telegram message announcing every new order the moment
it is placed. Procurement becomes a visible thread: statuses, timestamps,
and a complete history for the audit. The team is told; the record is
kept.

| CSV         | Orders          | Telegram       | History        |
| ----------- | --------------- | -------------- | -------------- |
| bulk import | status workflow | instant alerts | full audit log |

_The procurement loop - import, order, notify, confirm, audit - is
sealed._

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
⟫ npm install
⟫ npm run dev
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

Requires Node `^20.19.0` or `>=22.12.0` (per `package.json`), a Supabase
project, and a Telegram bot with its chat id.

</details>

Deploy: `⟫ npm run build` then `⟫ firebase deploy` (the `firebase.json`
rewrites already serve the SPA from `dist/`).

---

## ◆ ANATOMY

One workflow, three gears, and a messenger.

- **Imports** - a CSV upload turns a purchase list into an order in one
  move: no line-by-line typing, no transcription errors from the
  spreadsheet.
- **Tracks** - every order carries its status from Ordered to Delivered
  through an interface built for one action: confirm the goods, move the
  line. The status is the state of truth.
- **Notifies** - the Telegram bot delivers the news: a new order placed
  reaches the designated channel or user instantly, so the team learns
  from the phone in their pocket, not from a page they forgot to refresh.
- **Remembers** - the history view holds every past and current order
  with statuses and timestamps - the audit trail of everything the
  pharmacy has asked for and received.
- **Serves** - Vue 3 keeps the UI reactive, Pinia keeps the state
  consistent, Supabase holds the data, and Firebase Hosting ships the
  build with SPA rewrites already configured.

---

## ◆ RITUALS

**The core ceremony** - an order's journey:

1. Upload the CSV. The purchase list becomes an order, complete.
2. Place it. The status reads Ordered - and Telegram announces it.
3. The goods arrive. One action confirms receipt; the status advances
   toward Delivered.
4. Audit anytime: the history log shows every order, its status, and its
   timestamps, in order.

**The ceremony of the message** - a new order is never silent. The bot
speaks the moment the order is placed, so "has the order gone out?" is a
question the team already knows the answer to.

**The ceremony of the record** - statuses and timestamps are written
down for every order, every time. If procurement is questioned six
months later, the answer is a scroll away.

---

## ◆ ECHOES

**Where this artifact is heading**

```
import   ▸ CSV bulk order creation ───────────────────────────────── ▸ sealed
track    ▸ Ordered to Delivered, one-action updates ──────────────── ▸ sealed
notify   ▸ Telegram channel delivery on every new order ──────────── ▸ sealed
history  ▸ full log with statuses and timestamps ─────────────────── ▸ sealed
```

**Raising the artifact** - the quality bar is ESLint and the local
build; the [CI workflow](.github/workflows) gates every push. Supabase
schema and edge functions live under `supabase/`. Open an issue first to
discuss a change.

**Status** - every push runs the [CI gate](.github/workflows/ci.yml) on
the way to Firebase Hosting.

---

```
  ─────────────────────────────────────────
   An order unannounced is an order
   nobody is waiting for.
  ─────────────────────────────────────────
```

Licensed under the [MIT License](LICENSE).
