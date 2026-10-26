-- ═══════════════════════════════════════════════════════════════════════════════
-- Tracker | Supabase schema (public schema)
--
-- Current database structure for the drug-tracker-system project
-- (project ref: zfqdpsaxumpcqvfusiub), inspected from the live database on 2026-10-09.
--
-- How to use
--   1) Supabase Dashboard > SQL Editor: paste this file and Run
--   2) Via CLI (no Docker required):
--        supabase db query --linked --file supabase-schema.sql
--
-- Every statement is idempotent: create table if not exists,
-- drop policy if exists before create policy, enable row level security.
--
-- Future table changes
--   - Edit the create table statements here to match the live schema, then run
--     the file again against the database.
--   - create table if not exists does NOT modify an existing table, even when
--     its definition differs and even when the table already holds data.
--     Structural changes to existing tables must be written explicitly as
--     alter table statements here.
--   - For a new column on a table that already has data, append a conditional
--     statement, for example:
--       alter table public.purchase_orders
--         add column if not exists note text;
--   - Avoid destructive drop/truncate statements; always back up first.
--
-- Scope: the 4 Tracker tables only.
-- Note: this project shares its public schema with another system (reading_*),
--       so never drop the public schema.
-- ═══════════════════════════════════════════════════════════════════════════════

-- gen_random_uuid() is the default for every primary key.
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now(),
  constraint suppliers_name_key unique (name)
);

comment on table public.suppliers is 'เก็บข้อมูลบริษัทผู้จัดจำหน่ายยา';

create table if not exists public.drugs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  form text,
  strength text,
  created_at timestamptz default now(),
  constraint unique_drug_entry unique (name, form, strength)
);

comment on table public.drugs is 'เก็บรายการยาหลัก (Master Data) เพื่อลดความซ้ำซ้อน';

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  imported_at timestamptz default now(),
  constraint import_batches_file_name_key unique (file_name)
);

comment on table public.import_batches is 'เก็บประวัติการนำเข้าไฟล์ CSV ในแต่ละครั้ง';

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  drug_id uuid not null references public.drugs (id),
  supplier_id uuid not null references public.suppliers (id),
  import_batch_id uuid not null references public.import_batches (id),
  quantity numeric not null,
  unit_count text,
  price_per_unit numeric,
  total_price numeric,
  order_date date,
  received_date date,
  status text not null default 'ต้องสั่งซื้อ', -- app statuses: ต้องสั่งซื้อ | สั่งแล้ว | รับของแล้ว | ยกเลิก
  created_at timestamptz default now(),
  packaging text
);

comment on table public.purchase_orders is 'ตารางหลักสำหรับบันทึกและติดตามการสั่งซื้อแต่ละรายการ';

comment on column public.purchase_orders.packaging is 'ข้อมูลบรรจุภัณฑ์ของยาในรายการสั่งซื้อนั้นๆ เช่น ขวด, กล่อง 100 เม็ด';

create table if not exists public.auto_order_plans (
  id uuid primary key default gen_random_uuid(),
  drug_id uuid not null references public.drugs (id),
  supplier_id uuid not null references public.suppliers (id),
  usage_quantity numeric not null check (usage_quantity > 0),
  usage_months integer not null check (usage_months > 0),
  interval_months integer not null check (interval_months > 0),
  order_quantity numeric check (order_quantity > 0),
  next_order_date date not null,
  unit_count text not null default '-',
  packaging text,
  price_per_unit numeric not null default 0 check (price_per_unit >= 0),
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.auto_order_plans is 'แผนสั่งซื้ออัตโนมัติรายยา: ยอดใช้ย้อนหลัง รอบสั่งซื้อ และวันที่สร้างร่างครั้งถัดไป';

comment on column public.auto_order_plans.usage_quantity is 'ยอดใช้ย้อนหลังที่ผู้ใช้กรอก (จำนวน)';
comment on column public.auto_order_plans.usage_months is 'จำนวนเดือนของยอดใช้ย้อนหลัง';
comment on column public.auto_order_plans.interval_months is 'รอบการสร้างร่างใบสั่งซื้อ (เดือน)';
comment on column public.auto_order_plans.order_quantity is 'จำนวนที่ผู้ใช้กำหนดต่อรอบ (null = คำนวณอัตโนมัติจากยอดใช้ย้อนหลัง)';
comment on column public.auto_order_plans.next_order_date is 'วันที่ระบบจะสร้างร่างใบสั่งซื้อครั้งถัดไป';

-- Only one active plan per drug; paused plans are kept for history/editing.
create unique index if not exists auto_order_plans_one_active_per_drug
  on public.auto_order_plans (drug_id)
  where is_active;

create table if not exists public.auto_order_runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.auto_order_plans (id) on delete cascade,
  run_date date not null,
  purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  quantity numeric,
  status text not null check (status in ('created', 'skipped_open_draft', 'error')),
  message text,
  created_at timestamptz default now()
);

comment on table public.auto_order_runs is 'บันทึกผลการรันแผนสั่งซื้ออัตโนมัติในแต่ละครั้ง เพื่อการตรวจสอบย้อนหลัง';

create index if not exists auto_order_runs_plan_created_idx
  on public.auto_order_runs (plan_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.suppliers enable row level security;
alter table public.drugs enable row level security;
alter table public.import_batches enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.auto_order_plans enable row level security;
alter table public.auto_order_runs enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated, service_role;

grant all on table public.suppliers to anon, authenticated, service_role;
grant all on table public.drugs to anon, authenticated, service_role;
grant all on table public.import_batches to anon, authenticated, service_role;
grant all on table public.purchase_orders to anon, authenticated, service_role;
grant all on table public.auto_order_plans to anon, authenticated, service_role;
grant all on table public.auto_order_runs to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies
--
-- Full access for signed-in users only (auth.role() = 'authenticated');
-- the anon role is filtered out entirely by RLS.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Allow full access for authenticated users" on public.suppliers;
create policy "Allow full access for authenticated users"
  on public.suppliers
  for all
  using (auth.role() = 'authenticated'::text);

drop policy if exists "Allow full access for authenticated users" on public.drugs;
create policy "Allow full access for authenticated users"
  on public.drugs
  for all
  using (auth.role() = 'authenticated'::text);

drop policy if exists "Allow full access for authenticated users" on public.import_batches;
create policy "Allow full access for authenticated users"
  on public.import_batches
  for all
  using (auth.role() = 'authenticated'::text);

drop policy if exists "Allow full access for authenticated users" on public.purchase_orders;
create policy "Allow full access for authenticated users"
  on public.purchase_orders
  for all
  using (auth.role() = 'authenticated'::text);

drop policy if exists "Allow full access for authenticated users" on public.auto_order_plans;
create policy "Allow full access for authenticated users"
  on public.auto_order_plans
  for all
  using (auth.role() = 'authenticated'::text);

drop policy if exists "Allow full access for authenticated users" on public.auto_order_runs;
create policy "Allow full access for authenticated users"
  on public.auto_order_runs
  for all
  using (auth.role() = 'authenticated'::text);

-- ═══════════════════════════════════════════════════════════════════════════════
-- [MIGRATIONS] Log changes made after the 2026-10-09 baseline
-- ═══════════════════════════════════════════════════════════════════════════════
-- 2026-10-25: added auto_order_plans and auto_order_runs for the automatic
--             purchase-plan feature (draft orders + Telegram review alert).
-- 2026-10-26: allow an explicit per-cycle quantity on automatic plans.
--             NULL keeps the calculated quantity, so existing plans are
--             unchanged.
alter table public.auto_order_plans
  add column if not exists order_quantity numeric check (order_quantity > 0);

comment on column public.auto_order_plans.order_quantity is 'จำนวนที่ผู้ใช้กำหนดต่อรอบ (null = คำนวณอัตโนมัติจากยอดใช้ย้อนหลัง)';
