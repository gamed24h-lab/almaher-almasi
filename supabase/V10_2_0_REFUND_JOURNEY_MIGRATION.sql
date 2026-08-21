-- =============================================================
-- AL-MAHER V10.2.0 — REFUND WORKFLOW + JOURNEY MODE COMPATIBILITY
-- Safe / additive / idempotent. No booking or passenger deletion.
-- Run once in Supabase SQL Editor BEFORE deploying index.js V10.2.0.
-- =============================================================

begin;
create extension if not exists pgcrypto;

-- 1) Normalize legacy journey-mode values first.
update public.bookings
set journey_mode = case
  when lower(regexp_replace(coalesce(journey_mode,''),'[ _-]+','','g')) in ('oneway','onewaytrip','one') then 'oneway'
  when journey_mode in ('ذهاب','ذهاب فقط') then 'oneway'
  when lower(regexp_replace(coalesce(journey_mode,''),'[ _-]+','','g')) in ('roundtrip','round') then 'roundtrip'
  when journey_mode in ('ذهاب وعودة','ذهاب + عودة') then 'roundtrip'
  when lower(regexp_replace(coalesce(journey_mode,''),'[ _-]+','','g')) in ('separate','separatereturn') then 'separate'
  when journey_mode in ('رحلة عودة منفصلة','ذهاب وعودة من رحلة أخرى') then 'separate'
  when lower(regexp_replace(coalesce(journey_mode,''),'[ _-]+','','g')) = 'returnonly' then 'returnonly'
  when journey_mode = 'عودة فقط' then 'returnonly'
  when return_trip_id is not null then 'separate'
  else 'oneway'
end
where coalesce(journey_mode,'') not in ('oneway','roundtrip','separate','returnonly');

alter table public.bookings alter column journey_mode set default 'oneway';
alter table public.bookings alter column journey_mode set not null;
alter table public.bookings drop constraint if exists bookings_journey_mode_check;
alter table public.bookings
  add constraint bookings_journey_mode_check
  check (journey_mode in ('oneway','roundtrip','separate','returnonly'));

-- 2) Dedicated refund ledger / approval workflow.
create table if not exists public.booking_refunds (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  booking_number text not null,
  branch_id uuid references public.branches(id) on delete restrict,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  customer_name text,
  customer_phone text,
  amount numeric(12,2) not null check (amount > 0),
  paid_amount_snapshot numeric(12,2) not null default 0,
  previous_refunded_amount numeric(12,2) not null default 0,
  reason text not null,
  refund_method text not null default 'cash'
    check (refund_method in ('cash','bank_transfer','same_method','other')),
  customer_ack_name text,
  cancel_booking boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','completed','cancelled')),
  requested_by text,
  requested_by_id text,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_by_id text,
  decided_at timestamptz,
  decision_notes text,
  completed_by text,
  completed_by_id text,
  completed_at timestamptz,
  signed_document_path text,
  signed_document_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_refunds add column if not exists approval_request_id uuid references public.approval_requests(id) on delete set null;
alter table public.booking_refunds add column if not exists customer_ack_name text;
alter table public.booking_refunds add column if not exists cancel_booking boolean not null default false;
alter table public.booking_refunds add column if not exists signed_document_path text;
alter table public.booking_refunds add column if not exists signed_document_url text;
alter table public.booking_refunds add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.booking_refunds add column if not exists updated_at timestamptz not null default now();

create index if not exists booking_refunds_booking_idx on public.booking_refunds(booking_id, status, requested_at desc);
create index if not exists booking_refunds_branch_idx on public.booking_refunds(branch_id, status, requested_at desc);
create index if not exists booking_refunds_receipt_idx on public.booking_refunds(receipt_no);
create index if not exists booking_refunds_approval_idx on public.booking_refunds(approval_request_id) where approval_request_id is not null;

-- Service-key Worker is the only writer/reader for this financial ledger.
alter table public.booking_refunds enable row level security;
revoke all on public.booking_refunds from anon, authenticated;

-- Ensure booking financial status can express refund states without forcing a constraint change.
alter table if exists public.bookings add column if not exists financial_status text not null default 'unpaid';

notify pgrst, 'reload schema';
commit;

-- Verification: every row should be true.
select object_name, ok from (values
 ('booking_refunds', to_regclass('public.booking_refunds') is not null),
 ('journey_mode_constraint', exists(select 1 from pg_constraint where conname='bookings_journey_mode_check')),
 ('approval_requests', to_regclass('public.approval_requests') is not null),
 ('activity_events', to_regclass('public.activity_events') is not null)
) v(object_name,ok);
