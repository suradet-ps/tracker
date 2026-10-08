# Tracker Design System

Tracker is an internal pharmaceutical procurement tool for Sabot Hospital
(โรงพยาบาลสระโบสถ์). The interface is a calm, table-first workspace: dense
information, quiet chrome, and color reserved for status and a small set of
sticky-note tints. This document is the contract for every screen; if the
code and this file disagree, fix one of them in the same change.

- Tokens live in [`src/assets/main.css`](src/assets/main.css) (sections 1-2).
- Shared primitives live in [`src/components/ui/`](src/components/ui).
- The app shell, sidebar, and routing chrome live in `src/App.vue` and
  `src/components/AppSidebar.vue`.

---

## Overview

**Key characteristics**

- Mint-tinted canvas with white working surfaces; hairline borders instead
  of heavy shadows.
- Teal is the action color in light mode; in dark mode the primary flips to
  peach with charcoal text.
- Pill buttons, circular icon buttons, pill chips, and pill status badges
  are the brand signature.
- A four-tone sticky-note palette (`teal`, `peach`, `sand`, `mint`) tints
  metric tiles and quiet callouts - never large surfaces.
- Tabular numerals everywhere a number can be compared.
- Three explicit states for every surface: loading, empty, error - plus a
  distinct no-results state when filters exclude everything.

---

## Colors

Tokens are CSS custom properties. Components must reference tokens, never
raw hex values.

### Brand & signature tints

| Token                               | Light                 | Dark                                | Use                                        |
| ----------------------------------- | --------------------- | ----------------------------------- | ------------------------------------------ |
| `--primary`                         | `#116466`             | `#ffcb9a`                           | Primary actions, active nav, focus accents |
| `--primary-hover`                   | `#0e5456`             | `#ffd9b3`                           | Primary hover                              |
| `--primary-soft`                    | `#dfeeed`             | `rgba(255,203,154,.14)`             | Active nav fill, quiet primary surfaces    |
| `--on-primary`                      | `#ffffff`             | `#232b27`                           | Text/icons on primary                      |
| `--accent`                          | `#ffcb9a`             | `#116466`                           | Brand panel glow, small highlights         |
| `--secondary`                       | `#d9b08c`             | `#d9b08c`                           | Tan emphasis actions                       |
| `--tint-teal` / `--tint-teal-ink`   | `#dfeeed` / `#0e5456` | `rgba(17,100,102,.35)` / `#7fd0c3`  | Stat tile tint                             |
| `--tint-peach` / `--tint-peach-ink` | `#fff1e2` / `#96601f` | `rgba(255,203,154,.16)` / `#ffcb9a` | Stat tile tint                             |
| `--tint-sand` / `--tint-sand-ink`   | `#f7efdf` / `#8a6234` | `rgba(217,176,140,.16)` / `#eccb9e` | Stat tile tint                             |
| `--tint-mint` / `--tint-mint-ink`   | `#e6f2ef` / `#0e5456` | `rgba(209,232,226,.12)` / `#b9d9d1` | Stat tile tint                             |

### Surfaces

| Token             | Light     | Dark      | Use                            |
| ----------------- | --------- | --------- | ------------------------------ |
| `--bg`            | `#eef5f2` | `#1f2724` | Page canvas                    |
| `--surface`       | `#ffffff` | `#29322e` | Cards, tables, sidebar         |
| `--surface-2`     | `#f6faf8` | `#303a36` | Table headers, quiet rows      |
| `--surface-3`     | `#e9f2ee` | `#37423d` | Hover fills, neutral chips     |
| `--border`        | `#dbe8e3` | `#3b4742` | Hairline dividers              |
| `--border-strong` | `#c3d8d1` | `#4c5a54` | Input borders, outline buttons |

### Text

| Token      | Light     | Dark      | Use                              |
| ---------- | --------- | --------- | -------------------------------- |
| `--text`   | `#26302c` | `#e6f0ec` | Headlines, primary copy          |
| `--text-2` | `#52625d` | `#aab9b4` | Secondary copy, labels           |
| `--text-3` | `#788a84` | `#82948e` | Captions, metadata, placeholders |

### Feedback & status

| Token                          | Light                  | Dark                                 | Use                   |
| ------------------------------ | ---------------------- | ------------------------------------ | --------------------- |
| `--danger` / `--danger-soft`   | `#c75252` / `#f9e9e9`  | `#ff8989` / `rgba(255,137,137,.14)`  | Errors, destructive   |
| `--warning` / `--warning-soft` | `#8a6234` / `#f7efdf`  | `#e2b96f` / `rgba(226,185,111,.14)`  | Warnings              |
| `--success` / `--success-soft` | `#0e5456` / `#dfeeed`  | `#7fd0c3` / `rgba(127,208,195,.14)`  | Success confirmations |
| `--status-pending-*`           | `#a83f3f` on `#f9e9e9` | `#ffb1b1` on `rgba(199,82,82,.22)`   | Status: ต้องสั่งซื้อ  |
| `--status-ordered-*`           | `#8a6234` on `#f7efdf` | `#eccb9e` on `rgba(217,176,140,.18)` | Status: สั่งแล้ว      |
| `--status-received-*`          | `#0e5456` on `#dfeeed` | `#7fd0c3` on `rgba(17,100,102,.38)`  | Status: รับของแล้ว    |

Status colors describe order state only. They are never decorative.

---

## Typography

**Family.** `Prompt` (Google Fonts, Thai + Latin), loaded at weights
`400; 500; 600` only, with `ui-sans-serif, system-ui, -apple-system,
'Segoe UI', sans-serif` as fallback. The system does not use 700 or
lighter-than-400 weights; hierarchy comes from size and color.

| Token         | Size | Weight  | Line height | Use                                           |
| ------------- | ---- | ------- | ----------- | --------------------------------------------- |
| `--text-2xl`  | 28px | 600     | 1.3         | Page titles (`-0.02em` tracking)              |
| `--text-xl`   | 22px | 600     | 1.25        | Stat values (`-0.02em` tracking, tabular)     |
| `--text-lg`   | 18px | 600     | 1.3         | Dialog titles, brand wordmark                 |
| `--text-md`   | 16px | 400/500 | 1.5         | Page descriptions, emphasized body            |
| `--text-base` | 15px | 400/500 | 1.55        | Default body, inputs, buttons                 |
| `--text-sm`   | 13px | 400/500 | 1.5         | Table cells, toolbars, hints                  |
| `--text-xs`   | 12px | 500/600 | 1.4         | Labels (uppercase, `0.05em` tracking), badges |

**Principles**

- Negative tracking is only for large display numbers and page titles.
- Every comparable number uses `font-variant-numeric: tabular-nums`.
- Uppercase micro labels (`0.05em` tracking) are reserved for stat labels
  and table headers.
- Thai microcopy is concise and action-oriented: states say what happened
  and what to do next.

---

## Layout

### Spacing

The base unit is 4px; the working increment is 8px. Values in use:
`0.25rem` (4) · `0.5rem` (8) · `0.75rem` (12) · `1rem` (16) ·
`1.25rem` (20) · `1.5rem` (24) · `2rem` (32) · `3rem` (48).

- Page padding: `1.75rem 1.5rem 3rem` desktop, `1.25rem 1rem 4.5rem` mobile
  (extra bottom space clears the floating action bar).
- Section rhythm: `1.25rem` between stat strip / toolbar / table.
- Card padding: `1rem - 1.5rem`.

### Grid & container

- Content column: `--content-max: 1280px`, centered.
- Stat strip: `repeat(auto-fit, minmax(180px, 1fr))`.
- Sidebar: `--sidebar-w: 260px` expanded, `--sidebar-w-collapsed: 72px`.
- Mobile top bar: `--topbar-h: 56px`.

---

## Elevation & Depth

The system is flat by default; elevation is reserved for things that float.

| Token         | Value                                          | Use                           |
| ------------- | ---------------------------------------------- | ----------------------------- |
| `--shadow-xs` | `0 1px 2px rgba(35,43,39,.06)`                 | Cards, stat tiles, toolbar    |
| `--shadow-sm` | `0 1px 3px + 0 1px 2px rgba(35,43,39,.08/.04)` | Auth card, subtle lifts       |
| `--shadow-md` | `0 4px 14px rgba(35,43,39,.09)`                | Toasts                        |
| `--shadow-lg` | `0 16px 40px rgba(35,43,39,.16)`               | Modals, floating bars, drawer |

Dark mode uses the same scale with black-based alpha. Dividers are 1px
`--border` hairlines, not shadows.

---

## Shapes

| Token           | Value | Use                                           |
| --------------- | ----- | --------------------------------------------- |
| `--radius-xs`   | 4px   | Micro details                                 |
| `--radius-sm`   | 8px   | Inputs, selects, date fields                  |
| `--radius-md`   | 12px  | Stat icon tiles, alerts, toasts, inner panels |
| `--radius-lg`   | 16px  | Cards, tables, toolbars, modals, state blocks |
| `--radius-xl`   | 20px  | Auth card                                     |
| `--radius-full` | 999px | All buttons, chips, badges, floating bar      |

Icon buttons are perfect circles (`36px`, `30px` small; `42px` / `36px` on
screens ≤ 640px for touch).

---

## Components

### Buttons

All buttons are pills (`--radius-full`), `500` weight, and use the same
transition (background, border, color, box-shadow, transform). Pressed
state nudges down `1px`.

| Component                              | Spec                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `button-primary`                       | `--primary` bg, `--on-primary` text, min-height 40px, padding `0.5rem 1.15rem` |
| `button-secondary`                     | `--secondary` bg, `--on-secondary` text                                        |
| `button-ghost`                         | `--surface` bg, `--border-strong` 1px border; hover fills `--primary-soft`     |
| `button-subtle`                        | Transparent; hover fills `--surface-3`                                         |
| `button-danger` / `button-danger-soft` | Solid / outlined destructive pair                                              |
| `button-sm`                            | min-height 32px, `--text-sm`                                                   |
| `button-lg`                            | min-height 46px, `--text-md`                                                   |
| `button-icon`                          | 36px circle, transparent to `--subtle` variants                                |

Disabled buttons drop to 55% opacity and never react to hover.

### Inputs & forms

- `form-input`, `form-select`, `form-textarea`: 40px min-height,
  `--radius-sm`, `--border-strong` border, focus = primary border + `3px`
  `--focus-ring` glow. Invalid fields swap to `--danger` border (`.is-invalid`).
- Search fields pair an inline icon with `.input-wrap`.
- Labels (`.form-label`) are `--text-sm` `--text-2`; hints `--text-xs`
  `--text-3`; errors `--text-xs` `--danger`.
- Date inputs cap at today for receiving (`:max`); a "วันนี้" shortcut fills
  the current date.

### Stat cards

`label` (uppercase micro) + `value` (22px tabular, `-0.02em`) + optional
`hint`, with a 36px tinted icon tile. Tones: `teal` (default), `peach`,
`sand`, `mint` - use two or three per strip, never the same tone twice in
one row.

### Tables

`.table-wrap` + `.data-table`: sticky header (`--surface-2`, uppercase
12px), hairline row dividers, hover fill, selected row `--primary-soft`,
numeric columns right-aligned with tabular numerals, sortable headers as
real buttons with `aria-sort`, row selection checkboxes with a
select-all/indeterminate header box. The wrapper scrolls both axes and caps
at `min(68vh, 760px)` so headers stay pinned.

### Pagination

`.pagination` pairs a "แสดง X-Y จาก Z" range, a 25/50/100 page-size select,
and circular previous/next buttons with `aria-label`s.

### Floating action bar

`.floating-bar` is a pill pinned bottom-center (bottom sheet on mobile),
`--shadow-lg`, and is `inert` + `aria-hidden` while hidden so keyboard
focus can never land inside it.

### States

- Loading: `.state-block` with a spinner; it fades in after 80ms so fast
  loads never flash.
- Empty: `.state-block` with a tinted icon tile, a title that explains what
  will appear, and a primary action when one exists.
- No-results: a distinct empty state with "ล้างตัวกรอง".
- Error: `.state-block.is-error` plus a retry button, or an inline
  `.alert-error` for non-blocking failures.

### Modal

`AppModal` (Teleport): `role="dialog"`, `aria-modal`, labelled by its
title, Escape closes, backdrop click closes, focus is trapped and restored,
and body scroll is locked. Sizes: 420 / 640 / 860px.

### Toasts

Single-slot live region, top-right on desktop and bottom on mobile.
Success 3.5s, info 4.5s, error 6s (errors are `role="alert"`). Left border
and icon carry the type color.

### Navigation

- Sidebar: brand, two nav sections with icon + label (count badges for the
  two action queues), theme toggle, user card with logout. Collapsible to a
  72px icon rail on desktop (persisted in localStorage); off-canvas drawer
  with scrim and body scroll lock below 1024px.
- Every route sets a Thai `document.title` (`หน้า · Tracker`).
- Navigation is instant: no page transition delay, no animated scroll, and
  the scrollbar gutter is stable so content never shifts sideways.

---

## Do's and Don'ts

### Do

- Keep teal as the primary action color in light mode and peach in dark.
- Use pill buttons, circular icon buttons, and pill chips/badges.
- Pair two or three sticky-note tints in a stat strip; keep them for tiles
  and quiet callouts only.
- Use tabular numerals for every metric, price, and date range.
- Use semantic tokens for all color, spacing, radius, and elevation.
- Design loading, empty, no-results, and error states for every data view.
- Keep Thai microcopy short and specific about the next action.

### Don't

- Don't introduce hues outside the mint/teal/charcoal/tan/peach families
  and the semantic red/blue/green states.
- Don't use status colors decoratively; they mean order state only.
- Don't soften or square button corners - the pill is the signature.
- Don't use font weights outside 400 / 500 / 600.
- Don't put `--shadow-lg` on flat content; it belongs to overlays only.
- Don't animate layout properties during navigation; opacity only.
- Don't hide focus: every interactive element keeps the visible
  `:focus-visible` ring.

---

## Responsive Behavior

| Breakpoint   | Key changes                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| ≤ 640px      | Single column; page padding tightens; icon buttons grow to 42px; floating bar becomes a bottom sheet; toasts dock to the bottom |
| 641 - 1023px | Sidebar becomes an off-canvas drawer with a 56px top bar                                                                        |
| ≥ 1024px     | Persistent sidebar (collapsible to 72px); full-width tables                                                                     |
| ≤ 900px      | Auth switches from split panel to a stacked form                                                                                |

Collapsing strategy: tables scroll horizontally inside `.table-wrap`;
toolbars wrap; stat strips reflow via `auto-fit`; the auth brand panel
hides its feature list before its headline.

---

## Accessibility

- `:focus-visible` rings on every control (`--focus-ring`, 2px outline).
- Real `<button>`, `<label>`, `<caption>`, `<th scope>` semantics; sort
  state via `aria-sort`; selection checkboxes carry `aria-label`s with the
  drug name.
- Modals trap focus and close on Escape; hidden bulk bars are `inert`.
- Live regions: toasts announce politely, errors assertively.
- `prefers-reduced-motion` collapses all animation and transition
  durations; `scrollbar-gutter: stable` prevents layout shift.
- Text contrast targets WCAG AA in both themes; status chips use tinted
  surfaces with dark ink instead of saturated fills.

---

## Iteration Guide

1. Work on one component at a time; primitives belong in
   `src/components/ui`, system styles in `src/assets/main.css`.
2. Reference tokens (never raw hex) and reuse an existing component before
   adding a variant.
3. Add new variants as documented entries in this file.
4. Default body copy to `--text-base`; emphatic copy to `--text-md` 500.
5. Keep `--accent` (peach) for tints, highlights, and the auth panel only.
6. Buttons are always pills; status is always a pill badge with a dot.
7. Run `npm run lint`, `npm run type-check`, and `npm run build` before
   committing.

---

## Known Gaps

- No automated visual-regression or accessibility test suite yet; both
  themes are verified by hand.
- Dark mode is fully tokenized but has no dedicated artwork (the auth
  gradient is shared).
- Row density is fixed at the comfortable height; a compact density toggle
  is not implemented.
- Charts are not part of the product yet, so no data-visualization palette
  exists.
- The toast region is single-slot: a new notification replaces the visible
  one rather than stacking.
