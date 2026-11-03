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
-- Scope: the Tracker tables only (suppliers, drugs, import_batches,
--        purchase_orders, purchase_order_events, auto_order_plans,
--        auto_order_runs, profiles, telegram_notifications).
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

-- Staff allowlist for Tracker. An auth user with no row here (or with
-- role = 'pending') is signed in but has no access to procurement data.
-- Rows are created by an administrator, never by self-service sign-up.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'pending'
    constraint profiles_role_check check (role in ('pending', 'viewer', 'pharmacist', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'รายชื่อเจ้าหน้าที่ที่ได้รับอนุญาตและบทบาทใน Tracker (allowlist)';
comment on column public.profiles.role is 'pending = รออนุมัติ, viewer = ดูเท่านั้น, pharmacist = สร้าง/แก้ไข, admin = จัดการทั้งหมด';

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

-- Append-only audit trail for purchase_orders. Rows are written by the
-- triggers below, never by clients. order_id deliberately has no foreign key:
-- deleting an order must not erase its history, so the deleted snapshot is
-- kept here with actor and timestamp.
create table if not exists public.purchase_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null,
  actor_id uuid,
  actor_email text,
  event_type text not null,
  from_status text,
  to_status text,
  order_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.purchase_order_events is 'ประวัติการเปลี่ยนแปลงใบสั่งซื้อแบบ append-only พร้อมผู้กระทำและเวลา';
comment on column public.purchase_order_events.event_type is 'created = เพิ่มใบสั่งซื้อ, baseline = snapshot ตอน migration, updated = แก้ไขที่ไม่ใช่สถานะ, status_changed = เปลี่ยนสถานะ, deleted = ลบใบสั่งซื้อ';
comment on column public.purchase_order_events.order_snapshot is 'สำเนาข้อมูลใบสั่งซื้อ ณ เวลาที่เกิดเหตุการณ์ เพื่อให้ยังตรวจสอบได้แม้ใบสั่งซื้อถูกลบ';
comment on column public.purchase_order_events.actor_id is 'auth.uid() ของผู้กระทำ; null เมื่อระบบเป็นผู้สร้าง (service role)';
comment on column public.purchase_order_events.created_at is 'เวลาที่เหตุการณ์ถูกบันทึกโดยเซิร์ฟเวอร์ ไม่สามารถแก้ไขได้';

create index if not exists purchase_order_events_order_created_idx
  on public.purchase_order_events (order_id, created_at desc, id desc);

-- Kept as explicit ALTERs so re-applying this file updates the constraints on
-- a table created by an earlier revision.
alter table public.purchase_order_events
  drop constraint if exists purchase_order_events_type_check;
alter table public.purchase_order_events
  add constraint purchase_order_events_type_check
  check (event_type in ('created', 'baseline', 'updated', 'status_changed', 'deleted'));

alter table public.purchase_order_events
  drop constraint if exists purchase_order_events_transition_check;
alter table public.purchase_order_events
  add constraint purchase_order_events_transition_check check (
    (event_type in ('created', 'baseline') and from_status is null and to_status is not null)
    or (event_type = 'updated' and from_status is not null and to_status is not null and from_status = to_status)
    or (event_type = 'status_changed' and from_status is not null and to_status is not null and from_status <> to_status)
    or (event_type = 'deleted' and from_status is not null and to_status is null)
  );

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

-- Idempotency ledger for the `send-telegram-notify` edge function. One row
-- per supplier order group, keyed by the sorted purchase-order ids, so a
-- retry after a timeout cannot send the same Telegram message twice.
create table if not exists public.telegram_notifications (
  idempotency_key text primary key,
  order_ids jsonb not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.telegram_notifications is 'บันทึกการส่ง Telegram แบบ idempotent ต่อกลุ่มใบสั่งซื้อ เพื่อกันการส่งซ้ำเมื่อผู้ใช้กด retry';
comment on column public.telegram_notifications.order_ids is 'รายการ purchase_orders.id ที่อยู่ในข้อความนี้ (เรียงลำดับแล้ว)';

create index if not exists telegram_notifications_status_started_idx
  on public.telegram_notifications (status, started_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.drugs enable row level security;
alter table public.import_batches enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_events enable row level security;
alter table public.auto_order_plans enable row level security;
alter table public.auto_order_runs enable row level security;
alter table public.telegram_notifications enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
--
-- Least privilege: anon has no table privileges, authenticated gets only DML
-- (no TRUNCATE/REFERENCES/TRIGGER), and the service role keeps full access.
-- The RLS policies below decide which rows each signed-in staff role may touch.
-- ─────────────────────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated, service_role;

revoke all on table
  public.profiles,
  public.suppliers,
  public.drugs,
  public.import_batches,
  public.purchase_orders,
  public.purchase_order_events,
  public.auto_order_plans,
  public.auto_order_runs,
  public.telegram_notifications
from anon, authenticated, public;

grant select, insert, update, delete on table
  public.profiles,
  public.suppliers,
  public.drugs,
  public.import_batches,
  public.purchase_orders,
  public.auto_order_plans
to authenticated;

-- Run logs are written by the service role and read-only in the app.
grant select on table public.auto_order_runs to authenticated;

-- The audit trail is written by triggers and read-only for every client role.
grant select on table public.purchase_order_events to authenticated;

grant all on table
  public.profiles,
  public.suppliers,
  public.drugs,
  public.import_batches,
  public.purchase_orders,
  public.auto_order_plans,
  public.auto_order_runs,
  public.telegram_notifications
to service_role;

-- History is never writable by an application role, including the service
-- role: only the trigger, running as the table owner, appends events.
revoke all on table public.purchase_order_events from service_role;
grant select on table public.purchase_order_events to service_role;

-- Internal ledger: only the service role used by the edge function may access it.
revoke all on table public.telegram_notifications from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Role helpers
--
-- SECURITY DEFINER lets a policy on public.profiles call these helpers without
-- recursing into the profiles policy. The empty search_path keeps the lookup
-- pinned to the fully-qualified table.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('viewer', 'pharmacist', 'admin')
  );
$$;

create or replace function public.can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('pharmacist', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_staff() from public;
revoke all on function public.can_write() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.can_write() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Notification helpers
--
-- The notifier uses this before claiming a group, so an order that was already
-- delivered cannot be sent again just because a new order joined the group.
-- Only the service role may call it; telegram_notifications stays internal.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.sent_order_ids(p_order_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct (item.order_id)::uuid
  from public.telegram_notifications tn
  cross join lateral jsonb_array_elements_text(tn.order_ids) as item(order_id)
  where tn.status = 'sent'
    and (item.order_id)::uuid = any(p_order_ids);
$$;

revoke all on function public.sent_order_ids(uuid[]) from public;
grant execute on function public.sent_order_ids(uuid[]) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drug helpers
--
-- `unique (name, form, strength)` treats NULLs as distinct, so a blank form
-- or strength never conflicts and every manual add inserts another master
-- row. Normalize blanks to NULL, serialize concurrent creates with an
-- advisory lock, and return the existing row when the identity already exists.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_or_create_drug(
  p_name text,
  p_form text default null,
  p_strength text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_form text := nullif(btrim(coalesce(p_form, '')), '');
  v_strength text := nullif(btrim(coalesce(p_strength, '')), '');
  v_id uuid;
begin
  if not public.can_write() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'drug name is required' using errcode = '22023';
  end if;

  -- The unique constraint cannot see NULLs, so the lock is the duplicate guard.
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_name || '|' || coalesce(v_form, '') || '|' || coalesce(v_strength, ''),
      0
    )
  );

  select d.id
    into v_id
    from public.drugs d
   where d.name = v_name
     and coalesce(d.form, '') = coalesce(v_form, '')
     and coalesce(d.strength, '') = coalesce(v_strength, '')
   order by d.created_at nulls last, d.id
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.drugs (name, form, strength)
  values (v_name, v_form, v_strength)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.get_or_create_drug(text, text, text) from public;
grant execute on function public.get_or_create_drug(text, text, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies
--
-- viewer     -> read every Tracker table
-- pharmacist -> read + insert/update; may delete automatic plans
-- admin      -> everything, including deleting records and managing profiles
-- pending / no profile -> nothing
-- ─────────────────────────────────────────────────────────────────────────────

-- profiles: everyone may read their own row; only admins manage the allowlist.
drop policy if exists "Staff can read own profile" on public.profiles;
create policy "Staff can read own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or public.is_admin());

drop policy if exists "Admins can insert profiles" on public.profiles;
create policy "Admins can insert profiles"
  on public.profiles
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete profiles" on public.profiles;
create policy "Admins can delete profiles"
  on public.profiles
  for delete
  to authenticated
  using (public.is_admin());

-- suppliers
drop policy if exists "Allow full access for authenticated users" on public.suppliers;
drop policy if exists "Staff can read suppliers" on public.suppliers;
drop policy if exists "Writers can insert suppliers" on public.suppliers;
drop policy if exists "Writers can update suppliers" on public.suppliers;
drop policy if exists "Admins can delete suppliers" on public.suppliers;

create policy "Staff can read suppliers"
  on public.suppliers for select to authenticated
  using (public.is_staff());

create policy "Writers can insert suppliers"
  on public.suppliers for insert to authenticated
  with check (public.can_write());

create policy "Writers can update suppliers"
  on public.suppliers for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy "Admins can delete suppliers"
  on public.suppliers for delete to authenticated
  using (public.is_admin());

-- drugs
drop policy if exists "Allow full access for authenticated users" on public.drugs;
drop policy if exists "Staff can read drugs" on public.drugs;
drop policy if exists "Writers can insert drugs" on public.drugs;
drop policy if exists "Writers can update drugs" on public.drugs;
drop policy if exists "Admins can delete drugs" on public.drugs;

create policy "Staff can read drugs"
  on public.drugs for select to authenticated
  using (public.is_staff());

create policy "Writers can insert drugs"
  on public.drugs for insert to authenticated
  with check (public.can_write());

create policy "Writers can update drugs"
  on public.drugs for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy "Admins can delete drugs"
  on public.drugs for delete to authenticated
  using (public.is_admin());

-- import_batches
drop policy if exists "Allow full access for authenticated users" on public.import_batches;
drop policy if exists "Staff can read import batches" on public.import_batches;
drop policy if exists "Writers can insert import batches" on public.import_batches;
drop policy if exists "Writers can update import batches" on public.import_batches;
drop policy if exists "Admins can delete import batches" on public.import_batches;

create policy "Staff can read import batches"
  on public.import_batches for select to authenticated
  using (public.is_staff());

create policy "Writers can insert import batches"
  on public.import_batches for insert to authenticated
  with check (public.can_write());

create policy "Writers can update import batches"
  on public.import_batches for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy "Admins can delete import batches"
  on public.import_batches for delete to authenticated
  using (public.is_admin());

-- purchase_orders
drop policy if exists "Allow full access for authenticated users" on public.purchase_orders;
drop policy if exists "Staff can read purchase orders" on public.purchase_orders;
drop policy if exists "Writers can insert purchase orders" on public.purchase_orders;
drop policy if exists "Writers can update purchase orders" on public.purchase_orders;
drop policy if exists "Admins can delete purchase orders" on public.purchase_orders;

create policy "Staff can read purchase orders"
  on public.purchase_orders for select to authenticated
  using (public.is_staff());

create policy "Writers can insert purchase orders"
  on public.purchase_orders for insert to authenticated
  with check (public.can_write());

create policy "Writers can update purchase orders"
  on public.purchase_orders for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy "Admins can delete purchase orders"
  on public.purchase_orders for delete to authenticated
  using (public.is_admin());

-- purchase_order_events: append-only. Staff may read the trail; no client
-- role has insert, update, or delete privileges. The triggers below write it.
drop policy if exists "Staff can read purchase order events" on public.purchase_order_events;
create policy "Staff can read purchase order events"
  on public.purchase_order_events for select to authenticated
  using (public.is_staff());

-- auto_order_plans
drop policy if exists "Allow full access for authenticated users" on public.auto_order_plans;
drop policy if exists "Staff can read automatic plans" on public.auto_order_plans;
drop policy if exists "Writers can insert automatic plans" on public.auto_order_plans;
drop policy if exists "Writers can update automatic plans" on public.auto_order_plans;
drop policy if exists "Writers can delete automatic plans" on public.auto_order_plans;

create policy "Staff can read automatic plans"
  on public.auto_order_plans for select to authenticated
  using (public.is_staff());

create policy "Writers can insert automatic plans"
  on public.auto_order_plans for insert to authenticated
  with check (public.can_write());

create policy "Writers can update automatic plans"
  on public.auto_order_plans for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy "Writers can delete automatic plans"
  on public.auto_order_plans for delete to authenticated
  using (public.can_write());

-- auto_order_runs: written by the service role, read-only for staff.
drop policy if exists "Allow full access for authenticated users" on public.auto_order_runs;
drop policy if exists "Staff can read automatic run logs" on public.auto_order_runs;

create policy "Staff can read automatic run logs"
  on public.auto_order_runs for select to authenticated
  using (public.is_staff());

-- telegram_notifications has RLS enabled with no policies: service role only.

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit triggers
--
-- The event table is append-only: every insert, update, status transition,
-- and delete on purchase_orders appends one row with auth.uid() as the actor
-- and the server timestamp. No client role can write, rewrite, or delete events.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.record_purchase_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
begin
  select p.email
    into v_actor_email
    from public.profiles p
   where p.id = v_actor_id;

  if tg_op = 'INSERT' then
    insert into public.purchase_order_events
      (order_id, actor_id, actor_email, event_type, from_status, to_status, order_snapshot)
    values
      (new.id, v_actor_id, v_actor_email, 'created', null, new.status, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.purchase_order_events
        (order_id, actor_id, actor_email, event_type, from_status, to_status, order_snapshot)
      values
        (new.id, v_actor_id, v_actor_email, 'status_changed', old.status, new.status, to_jsonb(new));
    else
      insert into public.purchase_order_events
        (order_id, actor_id, actor_email, event_type, from_status, to_status, order_snapshot)
      values
        (new.id, v_actor_id, v_actor_email, 'updated', old.status, new.status, to_jsonb(new));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.purchase_order_events
      (order_id, actor_id, actor_email, event_type, from_status, to_status, order_snapshot)
    values
      (old.id, v_actor_id, v_actor_email, 'deleted', old.status, null, to_jsonb(old));
    return old;
  end if;

  return null;
end;
$$;

-- created_at and id are the immutable anchors of the audit trail.
create or replace function public.purchase_orders_created_at_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_at is distinct from old.created_at
     or new.id is distinct from old.id then
    raise exception 'purchase_orders.created_at and id are immutable'
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;

-- Defence in depth: even a role with table privileges cannot rewrite history.
create or replace function public.reject_purchase_order_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'purchase_order_events is append-only';
end;
$$;

revoke all on function public.record_purchase_order_event() from public;
revoke all on function public.purchase_orders_created_at_immutable() from public;
revoke all on function public.reject_purchase_order_event_mutation() from public;

drop trigger if exists purchase_orders_created_at_immutable on public.purchase_orders;
create trigger purchase_orders_created_at_immutable
  before update on public.purchase_orders
  for each row execute function public.purchase_orders_created_at_immutable();

drop trigger if exists purchase_orders_record_event on public.purchase_orders;
create trigger purchase_orders_record_event
  after insert or update or delete on public.purchase_orders
  for each row execute function public.record_purchase_order_event();

drop trigger if exists purchase_order_events_append_only on public.purchase_order_events;
create trigger purchase_order_events_append_only
  before update or delete on public.purchase_order_events
  for each row execute function public.reject_purchase_order_event_mutation();

-- Baseline snapshots for orders created before the trigger existed. `baseline`
-- is deliberately distinct from `created`: the row shows the status at
-- migration time, not the status the order had when it was first inserted.
-- Existing event rows (including a later deletion) win, so re-running this
-- file never duplicates a baseline.
insert into public.purchase_order_events
  (order_id, actor_id, actor_email, event_type, from_status, to_status, order_snapshot, created_at)
select
  po.id,
  null,
  null,
  'baseline',
  null,
  po.status,
  to_jsonb(po),
  coalesce(po.created_at, now())
from public.purchase_orders po
where not exists (
  select 1
  from public.purchase_order_events e
  where e.order_id = po.id
);

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

-- 2026-10-26: added telegram_notifications for idempotent supplier
--             notifications (no duplicate Telegram message on retry).
-- 2026-10-28: added profiles and role-scoped RLS (issue #92).
--             - profiles is the staff allowlist; no trigger creates rows on
--               sign-up, so a new auth user has no access until an admin
--               explicitly grants a role.
--             - replaced the blanket authenticated policies with role-scoped
--               policies; anon lost every table privilege.
--             - bootstrap the first admin immediately after applying this file:
--                 insert into public.profiles (id, email, role)
--                 select id, email, 'admin' from auth.users
--                 where email = 'admin@hospital.go.th'
--                 on conflict (id) do update
--                   set email = excluded.email, role = 'admin',
--                       updated_at = now();
--             - then disable public sign-ups (Dashboard or `supabase config push`).
-- 2026-11-03: added purchase_order_events and audit triggers (issue #93).
--             - every insert, update, status transition, and delete appends
--               an immutable event with actor, from/to status, and server time.
--             - clients may read the trail but can never insert, update, or
--               delete events; purchase_orders.created_at and id are immutable.
--             - existing orders receive one 'baseline' snapshot event, which
--               is distinct from an original 'created' event.
-- 2026-11-03: added sent_order_ids(uuid[]) for the Telegram notifier (issue #94).
--             Returns the order ids that already have a delivered notification,
--             so a stale order cannot be resent when grouped with a new one.
-- 2026-11-03: added get_or_create_drug for manual order entry (issue #95).
--             Normalizes blank form/strength to NULL and serializes concurrent
--             creates so one drug never becomes several master rows.
