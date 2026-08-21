-- ====================================================================
-- AL-MAHER V9.4.0 — FULL SYSTEM COMPLETION MASTER MIGRATION
-- Additive/idempotent foundation. No DROP/TRUNCATE. Existing booking/passenger rows are not deleted.
-- Run in Supabase SQL Editor before deploying V9.4.0.
-- ====================================================================

-- Al-Maher Al-Masi V9.2 database completion patch
-- Reconcile the four tables created during the immediate hotfix with the master schema.

alter table if exists public.trip_meeting_points add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.trip_meeting_points add column if not exists map_url text;
alter table if exists public.trip_meeting_points add column if not exists meeting_at timestamptz;
alter table if exists public.trip_meeting_points add column if not exists departure_at timestamptz;
alter table if exists public.trip_meeting_points add column if not exists direction text default 'outbound';
alter table if exists public.trip_meeting_points add column if not exists responsible_staff_id text;
alter table if exists public.trip_meeting_points add column if not exists status text default 'open';

alter table if exists public.passenger_meeting_points add column if not exists passenger_id uuid references public.booking_passengers(id) on delete cascade;
alter table if exists public.passenger_meeting_points add column if not exists meeting_point_id uuid references public.trip_meeting_points(id) on delete cascade;

alter table if exists public.passenger_qr_tokens add column if not exists token_hash text;
alter table if exists public.passenger_qr_tokens add column if not exists ticket_version integer default 1;
alter table if exists public.passenger_qr_tokens add column if not exists active boolean default true;
create unique index if not exists passenger_qr_tokens_token_hash_uidx on public.passenger_qr_tokens(token_hash) where token_hash is not null;

alter table if exists public.scan_events add column if not exists trip_vehicle_id uuid references public.trip_vehicles(id) on delete set null;
alter table if exists public.scan_events add column if not exists result text default 'success';
alter table if exists public.scan_events add column if not exists device_id text;

-- Continue with the complete idempotent master migration.
-- الماهر الماسي V9 MEGA MASTER UPDATE — Cloud-first foundation
-- تاريخ التصميم: 2026-08-11
-- الهدف: تجهيز قاعدة البيانات للتحديث الشامل بدون المساس بالنسخة الحية قبل اكتمال الاختبارات.
-- ملاحظة: خذ Backup قبل التشغيل. صُمم الملف ليكون idempotent قدر الإمكان.

create extension if not exists pgcrypto;

-- ============================================================
-- A) إعدادات عامة / تعدد الفروع / السحابة
-- ============================================================
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  scope text not null default 'global',
  branch_id uuid references public.branches(id) on delete cascade,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null,
  scope text not null default 'global',
  branch_id uuid references public.branches(id) on delete cascade,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique(flag_key, scope, branch_id)
);

create table if not exists public.system_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  component text not null,
  status text not null check(status in ('ok','warning','error','unknown')),
  latency_ms integer,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  entity_type text,
  entity_id text,
  direction text not null default 'cloud',
  status text not null default 'pending' check(status in ('pending','running','done','failed','conflict','cancelled')),
  attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- B) المستخدمون، الجلسات، الصلاحيات الدقيقة، الأجهزة
-- ============================================================
alter table if exists public.staff_users add column if not exists preferred_language text default 'ar';
alter table if exists public.staff_users add column if not exists home_branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.staff_users add column if not exists last_login_at timestamptz;
alter table if exists public.staff_users add column if not exists force_password_reset boolean not null default false;
alter table if exists public.staff_users add column if not exists security_meta jsonb not null default '{}'::jsonb;

create table if not exists public.role_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_en text,
  permissions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  staff_user_id text not null references public.staff_users(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null,
  valid_from timestamptz,
  valid_until timestamptz,
  reason text,
  granted_by text,
  created_at timestamptz not null default now(),
  unique(staff_user_id, permission_key, valid_until)
);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_user_id text references public.staff_users(id) on delete cascade,
  session_token_hash text,
  device_name text,
  device_type text,
  browser text,
  ip_hash text,
  trusted boolean not null default false,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.permission_delegations (
  id uuid primary key default gen_random_uuid(),
  from_staff_id text references public.staff_users(id) on delete cascade,
  to_staff_id text references public.staff_users(id) on delete cascade,
  permissions jsonb not null default '[]'::jsonb,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- ============================================================
-- C) المواسم، البرامج، الرحلات المشتركة بين الفروع
-- ============================================================
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  status text not null default 'draft',
  budget numeric(14,2) not null default 0,
  settings jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete set null,
  name text not null,
  code text,
  status text not null default 'draft',
  settings jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.trips add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table if exists public.trips add column if not exists lead_branch_id uuid references public.branches(id) on delete set null;
alter table if exists public.trips add column if not exists is_shared boolean not null default false;
alter table if exists public.trips add column if not exists default_bus_capacity integer not null default 49;
alter table if exists public.trips add column if not exists booking_capacity integer;
alter table if exists public.trips add column if not exists public_seat_selection boolean not null default false;
alter table if exists public.trips add column if not exists staff_seat_selection boolean not null default true;
alter table if exists public.trips add column if not exists seat_selection_required boolean not null default false;
alter table if exists public.trips add column if not exists return_meeting_time time;
alter table if exists public.trips add column if not exists return_departure_time time;
alter table if exists public.trips add column if not exists return_meeting_point text;
alter table if exists public.trips add column if not exists attendance_lead_minutes integer not null default 30;
alter table if exists public.trips add column if not exists boarding_close_minutes integer not null default 10;
alter table if exists public.trips add column if not exists reminder_mode text not null default 'automatic';
alter table if exists public.trips add column if not exists reminder_settings jsonb not null default '{}'::jsonb;
alter table if exists public.trips add column if not exists operations_status text not null default 'scheduled';
alter table if exists public.trips add column if not exists version_no integer not null default 1;

create table if not exists public.trip_branches (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  is_lead boolean not null default false,
  seat_quota integer,
  room_quota integer,
  quota_release_at timestamptz,
  operations_access boolean not null default true,
  finance_access boolean not null default false,
  created_at timestamptz not null default now(),
  unique(trip_id, branch_id)
);
create index if not exists trip_branches_trip_idx on public.trip_branches(trip_id);
create index if not exists trip_branches_branch_idx on public.trip_branches(branch_id);

create table if not exists public.trip_status_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  event_key text not null,
  planned_at timestamptz,
  actual_at timestamptz,
  actor_id text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- D) الباصات / المركبات / خرائط المقاعد / السائقين
-- ============================================================
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete set null,
  code text,
  name text,
  plate_no text,
  vehicle_type text not null default 'bus',
  physical_capacity integer not null default 49,
  booking_capacity integer not null default 49,
  status text not null default 'available',
  seat_map_template jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_seats (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  seat_no text not null,
  seat_index integer,
  seat_type text not null default 'passenger',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  unique(vehicle_id, seat_no)
);

create table if not exists public.trip_vehicles (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  bus_label text,
  capacity integer not null default 49,
  booking_capacity integer not null default 49,
  driver_id text,
  extra_driver_id text,
  supervisor_id text,
  status text not null default 'assigned',
  seat_map_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_maintenance (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  maintenance_type text,
  due_date date,
  completed_at timestamptz,
  status text not null default 'planned',
  cost numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- E) العملاء، العائلات، المجموعات، المسافرون والوثائق
-- ============================================================
alter table if exists public.customer_profiles add column if not exists preferred_language text default 'ar';
alter table if exists public.customer_profiles add column if not exists marketing_opt_in boolean not null default false;
alter table if exists public.customer_profiles add column if not exists tags jsonb not null default '[]'::jsonb;
alter table if exists public.customer_profiles add column if not exists communication_preferences jsonb not null default '{}'::jsonb;

create table if not exists public.travel_groups (
  id uuid primary key default gen_random_uuid(),
  group_type text not null default 'family' check(group_type in ('individual','family','group','company')),
  name text,
  primary_contact_name text,
  primary_contact_phone text,
  keep_together_bus boolean not null default true,
  keep_together_housing boolean not null default true,
  preferred_language text default 'ar',
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.bookings add column if not exists group_id uuid references public.travel_groups(id) on delete set null;
alter table if exists public.bookings add column if not exists source_channel text default 'staff';
alter table if exists public.bookings add column if not exists booking_type text default 'individual';
alter table if exists public.bookings add column if not exists price_snapshot jsonb not null default '{}'::jsonb;
alter table if exists public.bookings add column if not exists version_no integer not null default 1;
alter table if exists public.bookings add column if not exists soft_deleted_at timestamptz;
alter table if exists public.bookings add column if not exists archived_at timestamptz;

alter table if exists public.booking_passengers add column if not exists group_id uuid references public.travel_groups(id) on delete set null;
alter table if exists public.booking_passengers add column if not exists passenger_type text not null default 'adult';
alter table if exists public.booking_passengers add column if not exists preferred_language text default 'ar';
alter table if exists public.booking_passengers add column if not exists assistance_flags jsonb not null default '[]'::jsonb;
alter table if exists public.booking_passengers add column if not exists document_status text not null default 'unknown';
alter table if exists public.booking_passengers add column if not exists boarding_outbound_at timestamptz;
alter table if exists public.booking_passengers add column if not exists boarding_return_at timestamptz;
alter table if exists public.booking_passengers add column if not exists arrival_outbound_at timestamptz;
alter table if exists public.booking_passengers add column if not exists arrival_return_at timestamptz;

create table if not exists public.passenger_documents (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.booking_passengers(id) on delete cascade,
  document_type text not null,
  document_number text,
  country_code text,
  issued_at date,
  expires_at date,
  status text not null default 'pending',
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- F) نقاط التجمع والمسارات والتشغيل الجغرافي
-- ============================================================
create table if not exists public.trip_meeting_points (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  name text not null,
  address text,
  map_url text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  meeting_at timestamptz,
  departure_at timestamptz,
  direction text not null default 'outbound' check(direction in ('outbound','return')),
  responsible_staff_id text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.passenger_meeting_points (
  passenger_id uuid not null references public.booking_passengers(id) on delete cascade,
  meeting_point_id uuid not null references public.trip_meeting_points(id) on delete cascade,
  primary key(passenger_id, meeting_point_id)
);

-- ============================================================
-- G) المقاعد والحجز المؤقت والتوزيع
-- ============================================================
create table if not exists public.seat_assignments (
  id uuid primary key default gen_random_uuid(),
  trip_vehicle_id uuid not null references public.trip_vehicles(id) on delete cascade,
  passenger_id uuid references public.booking_passengers(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  segment_type text not null default 'outbound' check(segment_type in ('outbound','return')),
  seat_no text not null,
  status text not null default 'assigned' check(status in ('hold','assigned','blocked','released')),
  hold_until timestamptz,
  assigned_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists seat_assignments_unique_active
  on public.seat_assignments(trip_vehicle_id,segment_type,seat_no)
  where status in ('hold','assigned','blocked');

-- ============================================================
-- H) السكن والفنادق والغرف والكشوف المجمعة/الفروع
-- ============================================================
create table if not exists public.hotels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  address text,
  map_url text,
  phone text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  check_in_time time,
  check_out_time time,
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_hotels (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  hotel_id uuid not null references public.hotels(id) on delete restrict,
  check_in_date date,
  check_out_date date,
  status text not null default 'planned',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.hotel_rooms (
  id uuid primary key default gen_random_uuid(),
  trip_hotel_id uuid not null references public.trip_hotels(id) on delete cascade,
  room_no text,
  room_type text not null,
  capacity integer not null,
  branch_quota_id uuid references public.branches(id) on delete set null,
  status text not null default 'available',
  locked boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.room_assignments (
  id uuid primary key default gen_random_uuid(),
  hotel_room_id uuid not null references public.hotel_rooms(id) on delete cascade,
  passenger_id uuid not null references public.booking_passengers(id) on delete cascade,
  group_id uuid references public.travel_groups(id) on delete set null,
  status text not null default 'assigned',
  assigned_by text,
  created_at timestamptz not null default now(),
  unique(hotel_room_id, passenger_id)
);

-- ============================================================
-- I) QR / Check-in / الصعود / الوصول / السكن / العودة
-- ============================================================
create table if not exists public.passenger_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.booking_passengers(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  token_hash text not null unique,
  ticket_version integer not null default 1,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.scan_events (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid references public.booking_passengers(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  trip_vehicle_id uuid references public.trip_vehicles(id) on delete set null,
  scan_mode text not null check(scan_mode in ('outbound_boarding','outbound_arrival','housing_checkin','return_boarding','return_arrival','verify')),
  result text not null default 'success' check(result in ('success','duplicate','wrong_trip','wrong_bus','invalid','offline_pending','conflict')),
  scanned_by text,
  device_id text,
  scanned_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists scan_events_trip_idx on public.scan_events(trip_id, scanned_at desc);
create index if not exists scan_events_passenger_idx on public.scan_events(passenger_id, scanned_at desc);

-- ============================================================
-- J) الرسائل والتذكيرات والقوالب متعددة اللغات
-- ============================================================
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  language_code text not null default 'ar',
  channel text not null default 'whatsapp',
  subject text,
  body text not null,
  active boolean not null default true,
  version_no integer not null default 1,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique(template_key, language_code, channel, version_no)
);

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  trigger_key text not null,
  offset_minutes integer,
  direction text,
  channel text not null default 'whatsapp',
  template_key text not null,
  mode text not null default 'automatic' check(mode in ('automatic','manual','disabled')),
  audience_rule jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  passenger_id uuid references public.booking_passengers(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  channel text not null,
  recipient text not null,
  language_code text default 'ar',
  template_key text,
  payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  status text not null default 'scheduled' check(status in ('draft','scheduled','sending','sent','delivered','failed','cancelled','manual')),
  attempts integer not null default 0,
  provider_ref text,
  error_text text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists notifications_schedule_idx on public.notifications(status,scheduled_at);

-- ============================================================
-- K) العملاء المحتملون / CRM / الشكاوى / المهام
-- ============================================================
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete set null,
  name text,
  phone text,
  preferred_language text default 'ar',
  source_channel text,
  interest jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  assigned_to text,
  next_follow_up_at timestamptz,
  converted_booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text,
  booking_id uuid references public.bookings(id) on delete set null,
  customer_id uuid,
  branch_id uuid references public.branches(id) on delete set null,
  category text,
  priority text not null default 'normal',
  status text not null default 'open',
  assigned_to text,
  subject text,
  description text,
  resolution text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete cascade,
  assigned_to text,
  entity_type text,
  entity_id text,
  title text not null,
  description text,
  priority text not null default 'normal',
  status text not null default 'open',
  due_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================================
-- L) الموردون والعقود والميزانية
-- ============================================================
alter table if exists public.suppliers add column if not exists score numeric(5,2);
alter table if exists public.suppliers add column if not exists settings jsonb not null default '{}'::jsonb;

create table if not exists public.supplier_contracts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  program_id uuid references public.programs(id) on delete set null,
  contract_type text,
  start_date date,
  end_date date,
  amount numeric(14,2) not null default 0,
  status text not null default 'active',
  storage_path text,
  terms jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_payables (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  due_date date,
  amount numeric(14,2) not null,
  paid_amount numeric(14,2) not null default 0,
  status text not null default 'open',
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- M) المالية المتقدمة / الصناديق / الورديات / الموافقات
-- ============================================================
create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.cash_registers(id) on delete restrict,
  staff_user_id text references public.staff_users(id) on delete set null,
  opening_balance numeric(14,2) not null default 0,
  expected_closing numeric(14,2),
  actual_closing numeric(14,2),
  variance numeric(14,2),
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closing_notes text
);

alter table if exists public.transactions add column if not exists cash_shift_id uuid references public.cash_shifts(id) on delete set null;
alter table if exists public.transactions add column if not exists status text not null default 'posted';
alter table if exists public.transactions add column if not exists reversed_transaction_id uuid references public.transactions(id) on delete set null;
alter table if exists public.transactions add column if not exists idempotency_key text;
create unique index if not exists transactions_idempotency_idx on public.transactions(idempotency_key) where idempotency_key is not null;

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null,
  entity_type text,
  entity_id text,
  branch_id uuid references public.branches(id) on delete set null,
  requested_by text,
  approver_role text,
  approver_id text,
  status text not null default 'pending',
  request_payload jsonb not null default '{}'::jsonb,
  decision_notes text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ============================================================
-- N) الوكلاء / B2B / الحصص والائتمان والعمولات
-- ============================================================
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete set null,
  name text not null,
  company_name text,
  phone text,
  email text,
  credit_limit numeric(14,2) not null default 0,
  current_credit numeric(14,2) not null default 0,
  pricing_policy jsonb not null default '{}'::jsonb,
  commission_policy jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.agent_allocations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  seat_quota integer not null default 0,
  used_seats integer not null default 0,
  release_at timestamptz,
  special_price numeric(12,2),
  active boolean not null default true,
  unique(agent_id, trip_id)
);

alter table if exists public.bookings add column if not exists agent_id uuid references public.agents(id) on delete set null;

-- ============================================================
-- O) Checklists / المخاطر / الحوادث / المفقودات / العهد
-- ============================================================
create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_checklist_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  template_id uuid references public.checklist_templates(id) on delete set null,
  direction text default 'outbound',
  items jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  incident_type text not null,
  severity text not null default 'normal',
  status text not null default 'open',
  description text,
  affected_entities jsonb not null default '[]'::jsonb,
  assigned_to text,
  created_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.lost_found (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete set null,
  item_type text,
  description text,
  storage_path text,
  status text not null default 'found',
  found_by text,
  handed_to text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

-- ============================================================
-- P) الترجمة والتذاكر متعددة اللغات
-- ============================================================
create table if not exists public.translation_entries (
  id uuid primary key default gen_random_uuid(),
  translation_key text not null,
  language_code text not null,
  value text not null,
  status text not null default 'approved',
  updated_by text,
  updated_at timestamptz not null default now(),
  unique(translation_key, language_code)
);

create table if not exists public.ticket_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  language_code text not null default 'ar',
  format text not null default 'a4',
  content jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  version_no integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(template_key, language_code, format, version_no)
);

create table if not exists public.print_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  passenger_id uuid references public.booking_passengers(id) on delete set null,
  document_type text not null,
  language_code text,
  format text,
  version_no integer,
  printed_by text,
  printed_at timestamptz not null default now()
);

-- ============================================================
-- Q) التقارير، الحفظ، الأرشفة، التصدير
-- ============================================================
create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id text,
  branch_id uuid references public.branches(id) on delete cascade,
  report_type text not null,
  config jsonb not null default '{}'::jsonb,
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by text,
  branch_id uuid references public.branches(id) on delete set null,
  export_type text not null,
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  storage_path text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================================
-- R) النسخ الاحتياطي / الإصدارات / الـ snapshot / migrations
-- ============================================================
create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  backup_type text not null default 'manual',
  status text not null default 'running',
  storage_path text,
  checksum text,
  restore_tested boolean not null default false,
  initiated_by text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  details jsonb not null default '{}'::jsonb
);

create table if not exists public.schema_migrations (
  version text primary key,
  description text,
  checksum text,
  applied_by text,
  applied_at timestamptz not null default now()
);

create table if not exists public.system_snapshots (
  id uuid primary key default gen_random_uuid(),
  release_version text,
  schema_version text,
  settings_snapshot jsonb not null default '{}'::jsonb,
  feature_flags_snapshot jsonb not null default '{}'::jsonb,
  health_snapshot jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- S) الأداء / الأخطاء / التشخيص / feedback
-- ============================================================
create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id text,
  severity text not null default 'error',
  source text,
  route text,
  user_id text,
  branch_id uuid references public.branches(id) on delete set null,
  message text,
  stack text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.performance_events (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null,
  value numeric,
  unit text,
  route text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  reported_by text,
  page_key text,
  release_version text,
  category text,
  description text,
  diagnostic jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

-- ============================================================
-- T) RLS: الجداول الإدارية لا تُفتح مباشرة للعميل.
--    المسار الأساسي: Cloudflare Worker باستخدام Service Role + صلاحيات التطبيق.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'system_settings','feature_flags','system_health_snapshots','sync_jobs','role_templates',
    'staff_permission_overrides','user_sessions','permission_delegations','seasons','programs',
    'trip_branches','trip_status_events','vehicles','vehicle_seats','trip_vehicles','vehicle_maintenance',
    'travel_groups','passenger_documents','trip_meeting_points','passenger_meeting_points','seat_assignments',
    'hotels','trip_hotels','hotel_rooms','room_assignments','passenger_qr_tokens','scan_events',
    'message_templates','notification_rules','notifications','leads','service_tickets','tasks',
    'supplier_contracts','supplier_payables','cash_registers','cash_shifts','approval_requests',
    'agents','agent_allocations','checklist_templates','trip_checklist_runs','incidents','lost_found',
    'translation_entries','ticket_templates','print_events','saved_reports','export_jobs','backup_runs',
    'schema_migrations','system_snapshots','error_events','performance_events','feedback_reports'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security',t);
      execute format('revoke all on public.%I from anon, authenticated',t);
    end if;
  end loop;
end $$;

-- ============================================================
-- U) قيم افتراضية للتحديث
-- ============================================================
insert into public.system_settings(key,value,scope)
values
 ('transport.default_bus_capacity', '{"value":49}'::jsonb, 'global'),
 ('transport.default_attendance_lead_minutes', '{"value":30}'::jsonb, 'global'),
 ('notifications.default_mode', '{"value":"automatic"}'::jsonb, 'global'),
 ('cloud.source_of_truth', '{"value":"supabase"}'::jsonb, 'global'),
 ('booking.seat_selection_required', '{"value":false}'::jsonb, 'global')
on conflict(key) do nothing;

insert into public.feature_flags(flag_key,scope,enabled,config)
values
 ('public_seat_selection','global',false,'{}'),
 ('staff_seat_selection','global',true,'{}'),
 ('qr_mobile_scanner','global',true,'{}'),
 ('automatic_trip_reminders','global',true,'{}'),
 ('shared_trip_branches','global',true,'{}'),
 ('housing_rooming','global',true,'{}'),
 ('multi_language_tickets','global',true,'{}'),
 ('offline_safe_queue','global',false,'{}'),
 ('b2b_agents','global',false,'{}'),
 ('executive_analytics','global',true,'{}')
on conflict do nothing;

insert into public.schema_migrations(version,description)
values('9.0.0-foundation','V9 Mega Master Update cloud-first foundation')
on conflict(version) do nothing;

-- فهارس عامة
create index if not exists notifications_trip_idx on public.notifications(trip_id,created_at desc);
create index if not exists tasks_assignee_idx on public.tasks(assigned_to,status,due_at);
create index if not exists service_tickets_branch_idx on public.service_tickets(branch_id,status,created_at desc);
create index if not exists incidents_trip_idx on public.incidents(trip_id,status,created_at desc);
create index if not exists approvals_status_idx on public.approval_requests(status,requested_at desc);
create index if not exists error_events_created_idx on public.error_events(created_at desc);

-- نهاية V9 Foundation



-- =============================================================
-- V9.4 auxiliary cloud-persistence tables (additive only)
-- =============================================================
create extension if not exists pgcrypto;
create table if not exists public.operations_drivers (
 id uuid primary key default gen_random_uuid(), name text not null, phone text, identity_number text,
 nationality text, license_number text, license_expiry date, status text not null default 'active', notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists operations_drivers_identity_uq on public.operations_drivers(identity_number) where identity_number is not null and identity_number<>'';
create table if not exists public.app_runtime_state (state_key text primary key,payload jsonb not null default '{}'::jsonb,updated_by text,updated_at timestamptz not null default now());
create table if not exists public.trip_runtime_extensions (trip_code text primary key,trip_id uuid references public.trips(id) on delete set null,branch_id uuid references public.branches(id) on delete set null,payload jsonb not null default '{}'::jsonb,updated_by text,updated_at timestamptz not null default now());
create table if not exists public.customer_portal_accounts (id uuid primary key default gen_random_uuid(),email text not null,password_hash text not null,status text not null default 'active',preferred_language text not null default 'ar',failed_login_attempts integer not null default 0,locked_until timestamptz,last_login_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
alter table public.customer_portal_accounts add column if not exists failed_login_attempts integer not null default 0;
alter table public.customer_portal_accounts add column if not exists locked_until timestamptz;
alter table public.customer_portal_accounts add column if not exists last_login_at timestamptz;
create unique index if not exists customer_portal_accounts_email_uq on public.customer_portal_accounts(lower(email));
create table if not exists public.customer_saved_travelers (id uuid primary key default gen_random_uuid(),account_id uuid not null references public.customer_portal_accounts(id) on delete cascade,full_name text not null,gender text,nationality text,identity_number text not null,phone text,relation text,preferred_language text not null default 'ar',archived_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(account_id,identity_number));
alter table public.customer_saved_travelers add column if not exists archived_at timestamptz;
create index if not exists customer_saved_travelers_account_idx on public.customer_saved_travelers(account_id);
do $$ declare t text; begin foreach t in array array['operations_drivers','app_runtime_state','trip_runtime_extensions','customer_portal_accounts','customer_saved_travelers'] loop if to_regclass('public.'||t) is not null then execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon, authenticated',t);end if;end loop;end $$;


-- =============================================================
-- AL-MAHER V9.3.0 — FUNCTIONAL HARDENING / NO-DATA-LOSS
-- Safe/idempotent migration. Run once in Supabase SQL Editor.
-- Main goals:
--   1) preserve passenger IDs and linked QR/docs/seats
--   2) atomic seat reservation / release / booking transfer
--   3) safe trip capacity edits
--   4) staff login lockout + legacy plaintext password migration support
--   5) append-only activity audit for sensitive booking/payment changes
-- =============================================================

begin;

create extension if not exists pgcrypto;

-- ---------- Security/account hardening ----------
alter table if exists public.staff_users add column if not exists failed_login_attempts integer not null default 0;
alter table if exists public.staff_users add column if not exists locked_until timestamptz;
alter table if exists public.staff_users add column if not exists password_changed_at timestamptz;
alter table if exists public.staff_users add column if not exists last_login_at timestamptz;
alter table if exists public.staff_users add column if not exists force_password_reset boolean not null default false;
alter table if exists public.staff_users add column if not exists security_meta jsonb not null default '{}'::jsonb;

-- ---------- Booking fields used by the hardened Worker ----------
alter table if exists public.bookings add column if not exists financial_status text not null default 'unpaid';
alter table if exists public.bookings add column if not exists ticket_version integer not null default 1;
alter table if exists public.bookings add column if not exists last_modified_by text;
alter table if exists public.bookings add column if not exists last_modified_at timestamptz;
alter table if exists public.bookings add column if not exists version_no integer not null default 1;

alter table if exists public.booking_passengers add column if not exists status text not null default 'confirmed';
alter table if exists public.booking_passengers add column if not exists accommodation_status text not null default 'active';
alter table if exists public.booking_passengers add column if not exists preferred_language text not null default 'ar';
alter table if exists public.booking_passengers add column if not exists assistance_flags jsonb not null default '[]'::jsonb;
alter table if exists public.booking_passengers add column if not exists document_status text not null default 'unknown';

-- ---------- Append-only activity log ----------
create table if not exists public.activity_events (
  id bigserial primary key,
  actor_id text,
  actor_name text,
  actor_role text,
  branch_id uuid references public.branches(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_events_created_idx on public.activity_events(created_at desc);
create index if not exists activity_events_branch_idx on public.activity_events(branch_id,created_at desc);
alter table public.activity_events enable row level security;
revoke all on public.activity_events from anon,authenticated;

-- ---------- Atomic contact replacement ----------
create or replace function public.replace_branch_contacts(p_branch_id uuid,p_contacts jsonb)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer:=0;
begin
  if p_branch_id is null then raise exception 'branch id required'; end if;
  delete from public.branch_contacts where branch_id=p_branch_id;
  insert into public.branch_contacts(branch_id,label,phone,sort_order)
  select p_branch_id,
         coalesce(nullif(x->>'label',''),'رقم التواصل'),
         coalesce(x->>'phone',''),
         coalesce(nullif(x->>'sort_order','')::integer,ord::integer)
  from jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) with ordinality as e(x,ord);
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.replace_branch_contacts(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_branch_contacts(uuid,jsonb) to service_role;

-- ---------- Safe trip upsert: never overwrite reserved seats from a stale browser cache ----------
create or replace function public.almaher_upsert_trip_safe(p_trip jsonb,p_actor jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_old public.trips%rowtype;
  v_code text:=nullif(p_trip->>'trip_code','');
  v_capacity integer;
  v_reserved integer:=0;
  v_remaining integer;
begin
  if v_code is null then raise exception 'trip_code is required'; end if;

  if coalesce(p_trip->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into v_old from public.trips where id=(p_trip->>'id')::uuid for update;
  end if;
  if v_old.id is null then select * into v_old from public.trips where trip_code=v_code for update; end if;

  v_capacity:=greatest(0,coalesce(nullif(p_trip->>'bus_capacity','')::integer,v_old.bus_capacity,0));
  if v_old.id is not null then
    v_reserved:=greatest(0,coalesce(v_old.bus_capacity,0)-coalesce(v_old.remaining_seats,v_old.bus_capacity,0));
    if v_capacity < v_reserved then
      raise exception 'لا يمكن خفض سعة الرحلة إلى % لأن هناك % مقعداً محجوزاً',v_capacity,v_reserved;
    end if;
    v_remaining:=v_capacity-v_reserved;
    update public.trips set
      trip_name=coalesce(p_trip->>'trip_name',trip_name),
      from_city=coalesce(p_trip->>'from_city',from_city),
      to_city=coalesce(p_trip->>'to_city',to_city),
      departure_date=coalesce(nullif(p_trip->>'departure_date','')::date,departure_date),
      departure_time=coalesce(nullif(p_trip->>'departure_time','')::time,departure_time),
      return_date=case when p_trip ? 'return_date' then nullif(p_trip->>'return_date','')::date else return_date end,
      return_time=case when p_trip ? 'return_time' then nullif(p_trip->>'return_time','')::time else return_time end,
      bus_type=case when p_trip ? 'bus_type' then nullif(p_trip->>'bus_type','') else bus_type end,
      bus_number=case when p_trip ? 'bus_number' then nullif(p_trip->>'bus_number','') else bus_number end,
      bus_plate=case when p_trip ? 'bus_plate' then nullif(p_trip->>'bus_plate','') else bus_plate end,
      bus_capacity=v_capacity,
      remaining_seats=v_remaining,
      branch_id=case when p_trip ? 'branch_id' then nullif(p_trip->>'branch_id','')::uuid else branch_id end,
      price_one_way=coalesce(nullif(p_trip->>'price_one_way','')::numeric,price_one_way),
      price_no_accommodation=coalesce(nullif(p_trip->>'price_no_accommodation','')::numeric,price_no_accommodation),
      price_shared=coalesce(nullif(p_trip->>'price_shared','')::numeric,price_shared),
      price_private_room=coalesce(nullif(p_trip->>'price_private_room','')::numeric,price_private_room),
      hotel_name=case when p_trip ? 'hotel_name' then nullif(p_trip->>'hotel_name','') else hotel_name end,
      hotel_city=case when p_trip ? 'hotel_city' then nullif(p_trip->>'hotel_city','') else hotel_city end,
      status=case when p_trip ? 'status' then coalesce(nullif(p_trip->>'status',''),status) else status end,
      updated_at=now()
    where id=v_old.id returning id into v_id;
  else
    v_remaining:=v_capacity;
    insert into public.trips(
      trip_code,trip_name,from_city,to_city,departure_date,departure_time,return_date,return_time,
      bus_type,bus_number,bus_plate,bus_capacity,remaining_seats,branch_id,
      price_one_way,price_no_accommodation,price_shared,price_private_room,hotel_name,hotel_city,status
    ) values (
      v_code,coalesce(nullif(p_trip->>'trip_name',''),'رحلة'),coalesce(p_trip->>'from_city',''),coalesce(p_trip->>'to_city',''),
      nullif(p_trip->>'departure_date','')::date,nullif(p_trip->>'departure_time','')::time,
      nullif(p_trip->>'return_date','')::date,nullif(p_trip->>'return_time','')::time,
      nullif(p_trip->>'bus_type',''),nullif(p_trip->>'bus_number',''),nullif(p_trip->>'bus_plate',''),
      v_capacity,v_remaining,nullif(p_trip->>'branch_id','')::uuid,
      coalesce(nullif(p_trip->>'price_one_way','')::numeric,0),coalesce(nullif(p_trip->>'price_no_accommodation','')::numeric,0),
      coalesce(nullif(p_trip->>'price_shared','')::numeric,0),coalesce(nullif(p_trip->>'price_private_room','')::numeric,0),
      nullif(p_trip->>'hotel_name',''),nullif(p_trip->>'hotel_city',''),coalesce(nullif(p_trip->>'status',''),'available')
    ) returning id into v_id;
  end if;

  return jsonb_build_object('ok',true,'id',v_id,'trip_code',v_code,'reserved_seats',v_reserved,'remaining_seats',v_remaining);
end;
$$;
revoke all on function public.almaher_upsert_trip_safe(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.almaher_upsert_trip_safe(jsonb,jsonb) to service_role;

-- ---------- Internal atomic booking save ----------
create or replace function public.almaher_save_booking_atomic(
  p_booking jsonb,
  p_passengers jsonb default null,
  p_actor jsonb default '{}'::jsonb,
  p_require_existing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old public.bookings%rowtype;
  v_booking_id uuid;
  v_booking_no text:=nullif(p_booking->>'booking_number','');
  v_old_total integer:=0;
  v_old_active integer:=0;
  v_new_total integer:=0;
  v_new_active integer:=0;
  v_old_reserve integer:=0;
  v_new_reserve integer:=0;
  v_new_status text;
  v_new_trip uuid;
  v_new_return uuid;
  v_old_trip uuid;
  v_old_return uuid;
  v_seen uuid[]:='{}'::uuid[];
  v_x jsonb;
  v_ord integer:=0;
  v_pid uuid;
  v_match uuid;
  v_identity text;
  v_financial_status text;
  v_old_paid numeric:=0;
  v_new_paid numeric:=0;
begin
  if v_booking_no is null then raise exception 'booking_number is required'; end if;

  select * into v_old from public.bookings where booking_number=v_booking_no for update;
  if p_require_existing and v_old.id is null then raise exception 'الحجز غير موجود سحابياً'; end if;

  v_old_trip:=v_old.trip_id; v_old_return:=v_old.return_trip_id;
  if v_old.id is not null then
    select count(*),count(*) filter(where coalesce(status,'confirmed') not in ('cancelled','canceled','ملغي'))
      into v_old_total,v_old_active from public.booking_passengers where booking_id=v_old.id;
    if v_old_total=0 then v_old_active:=greatest(1,coalesce(v_old.travelers,1)); end if;
    if coalesce(v_old.status,'new') in ('cancelled','canceled','ملغي') then v_old_reserve:=0; else v_old_reserve:=v_old_active; end if;
    v_old_paid:=coalesce(v_old.paid_amount,0);
  end if;

  v_new_status:=coalesce(nullif(p_booking->>'status',''),v_old.status,'new');
  v_new_trip:=case when p_booking ? 'trip_id' then nullif(p_booking->>'trip_id','')::uuid else v_old.trip_id end;
  v_new_return:=case when p_booking ? 'return_trip_id' then nullif(p_booking->>'return_trip_id','')::uuid else v_old.return_trip_id end;

  if p_passengers is not null and jsonb_typeof(p_passengers)='array' then
    v_new_total:=jsonb_array_length(p_passengers);
    select count(*) into v_new_active
      from jsonb_array_elements(p_passengers) z
      where coalesce(z->>'status','confirmed') not in ('cancelled','canceled','ملغي');
    if v_new_total=0 and v_new_status not in ('cancelled','canceled','ملغي') then raise exception 'الحجز النشط يجب أن يحتوي مسافراً واحداً على الأقل'; end if;
  elsif v_old.id is not null then
    v_new_total:=greatest(v_old_total,coalesce(v_old.travelers,1));
    v_new_active:=v_old_active;
  else
    v_new_total:=greatest(1,coalesce(nullif(p_booking->>'travelers','')::integer,1));
    v_new_active:=v_new_total;
  end if;

  if v_new_status in ('cancelled','canceled','ملغي') then v_new_reserve:=0; else v_new_reserve:=v_new_active; end if;
  if v_new_reserve>0 and v_new_trip is null then raise exception 'trip_id is required for an active booking'; end if;

  -- Lock all affected trips in stable order to avoid race conditions/deadlocks.
  perform 1 from public.trips
   where id in (select distinct unnest(array_remove(array[v_old_trip,v_old_return,v_new_trip,v_new_return],null::uuid)))
   order by id for update;

  -- Release the old reservation first.
  if v_old.id is not null and v_old_reserve>0 and v_old_trip is not null then
    update public.trips set remaining_seats=least(coalesce(bus_capacity,0),coalesce(remaining_seats,bus_capacity,0)+v_old_reserve),updated_at=now()
     where id=v_old_trip;
    if v_old_return is not null and v_old_return<>v_old_trip then
      update public.trips set remaining_seats=least(coalesce(bus_capacity,0),coalesce(remaining_seats,bus_capacity,0)+v_old_reserve),updated_at=now()
       where id=v_old_return;
    end if;
  end if;

  -- Reserve the new outbound/return seats atomically.
  if v_new_reserve>0 then
    if not exists(select 1 from public.trips where id=v_new_trip) then raise exception 'رحلة الذهاب غير موجودة'; end if;
    if (select coalesce(remaining_seats,bus_capacity,0) from public.trips where id=v_new_trip)<v_new_reserve then
      raise exception 'المقاعد المتاحة في رحلة الذهاب غير كافية';
    end if;
    update public.trips set remaining_seats=coalesce(remaining_seats,bus_capacity,0)-v_new_reserve,
      status=case when status in ('available','full') then case when coalesce(remaining_seats,bus_capacity,0)-v_new_reserve>0 then 'available' else 'full' end else status end,
      updated_at=now() where id=v_new_trip;

    if v_new_return is not null and v_new_return<>v_new_trip then
      if not exists(select 1 from public.trips where id=v_new_return) then raise exception 'رحلة العودة غير موجودة'; end if;
      if (select coalesce(remaining_seats,bus_capacity,0) from public.trips where id=v_new_return)<v_new_reserve then
        raise exception 'المقاعد المتاحة في رحلة العودة غير كافية';
      end if;
      update public.trips set remaining_seats=coalesce(remaining_seats,bus_capacity,0)-v_new_reserve,
        status=case when status in ('available','full') then case when coalesce(remaining_seats,bus_capacity,0)-v_new_reserve>0 then 'available' else 'full' end else status end,
        updated_at=now() where id=v_new_return;
    end if;
  end if;

  v_new_paid:=coalesce(nullif(p_booking->>'paid_amount','')::numeric,v_old.paid_amount,0);
  v_financial_status:=case when v_new_paid<=0 then 'unpaid'
                           when v_new_paid>=coalesce(nullif(p_booking->>'total_price','')::numeric,v_old.total_price,0) then 'paid'
                           else 'partial' end;

  if v_old.id is null then
    insert into public.bookings(
      booking_number,trip_id,return_trip_id,branch_id,customer_name,customer_gender,customer_nationality,customer_phone,customer_identity,
      travelers,journey_mode,accommodation_type,accommodation_label,private_rooms,private_room_types,capacity_warning,
      hotel_name,hotel_city,payment_method,original_price,total_price,paid_amount,price_override_reason,notes,status,source,created_by,
      terms_accepted,terms_version,terms_accepted_at,terms_snapshot,outbound_leg_price,return_leg_price,snapshot,
      financial_status,ticket_version,last_modified_by,last_modified_at,version_no,created_at,updated_at
    ) values (
      v_booking_no,v_new_trip,v_new_return,nullif(p_booking->>'branch_id','')::uuid,coalesce(p_booking->>'customer_name',''),nullif(p_booking->>'customer_gender',''),nullif(p_booking->>'customer_nationality',''),
      coalesce(p_booking->>'customer_phone',''),coalesce(p_booking->>'customer_identity',''),greatest(1,v_new_active),coalesce(nullif(p_booking->>'journey_mode',''),'oneway'),
      coalesce(nullif(p_booking->>'accommodation_type',''),'none'),p_booking->>'accommodation_label',coalesce(nullif(p_booking->>'private_rooms','')::integer,0),coalesce(p_booking->'private_room_types','[]'::jsonb),
      coalesce((p_booking->>'capacity_warning')::boolean,false),nullif(p_booking->>'hotel_name',''),nullif(p_booking->>'hotel_city',''),nullif(p_booking->>'payment_method',''),
      coalesce(nullif(p_booking->>'original_price','')::numeric,0),coalesce(nullif(p_booking->>'total_price','')::numeric,0),v_new_paid,nullif(p_booking->>'price_override_reason',''),p_booking->>'notes',
      v_new_status,coalesce(nullif(p_booking->>'source',''),'customer'),p_booking->>'created_by',coalesce((p_booking->>'terms_accepted')::boolean,false),p_booking->>'terms_version',
      nullif(p_booking->>'terms_accepted_at','')::timestamptz,coalesce(p_booking->'terms_snapshot','[]'::jsonb),nullif(p_booking->>'outbound_leg_price','')::numeric,nullif(p_booking->>'return_leg_price','')::numeric,
      coalesce(p_booking->'snapshot','{}'::jsonb),v_financial_status,coalesce(nullif(p_booking->>'ticket_version','')::integer,1),p_actor->>'name',now(),1,now(),now()
    ) returning id into v_booking_id;
  else
    v_booking_id:=v_old.id;
    update public.bookings set
      trip_id=v_new_trip,return_trip_id=v_new_return,
      branch_id=case when p_booking ? 'branch_id' then nullif(p_booking->>'branch_id','')::uuid else branch_id end,
      customer_name=case when p_booking ? 'customer_name' then p_booking->>'customer_name' else customer_name end,
      customer_gender=case when p_booking ? 'customer_gender' then nullif(p_booking->>'customer_gender','') else customer_gender end,
      customer_nationality=case when p_booking ? 'customer_nationality' then nullif(p_booking->>'customer_nationality','') else customer_nationality end,
      customer_phone=case when p_booking ? 'customer_phone' then p_booking->>'customer_phone' else customer_phone end,
      customer_identity=case when p_booking ? 'customer_identity' then p_booking->>'customer_identity' else customer_identity end,
      travelers=greatest(1,v_new_active),
      journey_mode=case when p_booking ? 'journey_mode' then coalesce(nullif(p_booking->>'journey_mode',''),'oneway') else journey_mode end,
      accommodation_type=case when p_booking ? 'accommodation_type' then coalesce(nullif(p_booking->>'accommodation_type',''),'none') else accommodation_type end,
      accommodation_label=case when p_booking ? 'accommodation_label' then p_booking->>'accommodation_label' else accommodation_label end,
      private_rooms=case when p_booking ? 'private_rooms' then coalesce(nullif(p_booking->>'private_rooms','')::integer,0) else private_rooms end,
      private_room_types=case when p_booking ? 'private_room_types' then coalesce(p_booking->'private_room_types','[]'::jsonb) else private_room_types end,
      hotel_name=case when p_booking ? 'hotel_name' then nullif(p_booking->>'hotel_name','') else hotel_name end,
      hotel_city=case when p_booking ? 'hotel_city' then nullif(p_booking->>'hotel_city','') else hotel_city end,
      payment_method=case when p_booking ? 'payment_method' then nullif(p_booking->>'payment_method','') else payment_method end,
      original_price=case when p_booking ? 'original_price' then coalesce(nullif(p_booking->>'original_price','')::numeric,original_price) else original_price end,
      total_price=case when p_booking ? 'total_price' then coalesce(nullif(p_booking->>'total_price','')::numeric,total_price) else total_price end,
      paid_amount=v_new_paid,
      financial_status=v_financial_status,
      price_override_reason=case when p_booking ? 'price_override_reason' then nullif(p_booking->>'price_override_reason','') else price_override_reason end,
      notes=case when p_booking ? 'notes' then p_booking->>'notes' else notes end,
      status=v_new_status,
      snapshot=case when p_booking ? 'snapshot' then coalesce(p_booking->'snapshot','{}'::jsonb) else snapshot end,
      ticket_version=case when p_booking ? 'ticket_version' then coalesce(nullif(p_booking->>'ticket_version','')::integer,ticket_version) else ticket_version end,
      last_modified_by=coalesce(p_actor->>'name',p_actor->>'id',last_modified_by),last_modified_at=now(),version_no=coalesce(version_no,1)+1,updated_at=now()
     where id=v_booking_id;
  end if;

  -- Non-destructive passenger merge. Existing passenger UUIDs are retained.
  if p_passengers is not null and jsonb_typeof(p_passengers)='array' then
    for v_x in select value from jsonb_array_elements(p_passengers) loop
      v_ord:=v_ord+1; v_match:=null; v_pid:=null; v_identity:=coalesce(v_x->>'identity_number','');
      if coalesce(v_x->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then v_pid:=(v_x->>'id')::uuid; end if;
      if v_pid is not null then select id into v_match from public.booking_passengers where id=v_pid and booking_id=v_booking_id; end if;
      if v_match is null and v_identity<>'' then select id into v_match from public.booking_passengers where booking_id=v_booking_id and identity_number=v_identity order by created_at asc limit 1; end if;
      if v_match is null then select id into v_match from public.booking_passengers where booking_id=v_booking_id and passenger_order=coalesce(nullif(v_x->>'passenger_order','')::integer,v_ord) order by created_at asc limit 1; end if;

      if v_match is null then
        insert into public.booking_passengers(
          booking_id,passenger_order,full_name,gender,nationality,identity_number,phone,status,accommodation_status,preferred_language,assistance_flags,document_status
        ) values (
          v_booking_id,coalesce(nullif(v_x->>'passenger_order','')::integer,v_ord),coalesce(v_x->>'full_name',''),nullif(v_x->>'gender',''),nullif(v_x->>'nationality',''),v_identity,
          nullif(v_x->>'phone',''),coalesce(nullif(v_x->>'status',''),'confirmed'),coalesce(nullif(v_x->>'accommodation_status',''),'active'),
          coalesce(nullif(v_x->>'preferred_language',''),'ar'),coalesce(v_x->'assistance_flags','[]'::jsonb),coalesce(nullif(v_x->>'document_status',''),'unknown')
        ) returning id into v_match;
      else
        update public.booking_passengers set
          passenger_order=coalesce(nullif(v_x->>'passenger_order','')::integer,v_ord),full_name=coalesce(v_x->>'full_name',''),gender=nullif(v_x->>'gender',''),nationality=nullif(v_x->>'nationality',''),
          identity_number=v_identity,phone=nullif(v_x->>'phone',''),status=coalesce(nullif(v_x->>'status',''),'confirmed'),
          accommodation_status=coalesce(nullif(v_x->>'accommodation_status',''),accommodation_status,'active'),preferred_language=coalesce(nullif(v_x->>'preferred_language',''),'ar'),
          assistance_flags=coalesce(v_x->'assistance_flags',assistance_flags,'[]'::jsonb),document_status=coalesce(nullif(v_x->>'document_status',''),document_status,'unknown')
        where id=v_match;
      end if;
      v_seen:=array_append(v_seen,v_match);
    end loop;
    -- Rows removed by older clients are cancelled, NEVER deleted. This preserves linked QR/docs/seat history.
    update public.booking_passengers set status='cancelled'
     where booking_id=v_booking_id and not(id=any(v_seen)) and coalesce(status,'confirmed')<>'cancelled';
  end if;

  insert into public.activity_events(actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,metadata)
  values(p_actor->>'id',p_actor->>'name',p_actor->>'role',coalesce(nullif(p_booking->>'branch_id','')::uuid,v_old.branch_id),
         case when v_old.id is null then 'booking_created' when v_old_paid>v_new_paid then 'booking_refund' else 'booking_updated' end,
         'booking',v_booking_id::text,jsonb_build_object('booking_number',v_booking_no,'old_paid',v_old_paid,'new_paid',v_new_paid,'old_reserved',v_old_reserve,'new_reserved',v_new_reserve,'old_trip_id',v_old_trip,'new_trip_id',v_new_trip,'old_return_trip_id',v_old_return,'new_return_trip_id',v_new_return));

  return jsonb_build_object('ok',true,'booking_id',v_booking_id,'booking_number',v_booking_no,'reserved_seats',v_new_reserve);
end;
$$;
revoke all on function public.almaher_save_booking_atomic(jsonb,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.almaher_save_booking_atomic(jsonb,jsonb,jsonb,boolean) to service_role;

-- Public/customer creation wrapper used by the Worker. Worker calls with service_role.
create or replace function public.create_booking_with_passengers(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare b jsonb:=coalesce(p_payload->'booking','{}'::jsonb); p jsonb:=coalesce(p_payload->'passengers','[]'::jsonb);
begin
  if coalesce((b->>'terms_accepted')::boolean,false) is not true then raise exception 'terms must be accepted'; end if;
  if jsonb_array_length(p)<1 then raise exception 'passengers are required'; end if;
  return public.almaher_save_booking_atomic(b,p,jsonb_build_object('id','public','name',coalesce(b->>'created_by','العميل'),'role',coalesce(b->>'source','customer')),false);
end;
$$;
revoke all on function public.create_booking_with_passengers(jsonb) from public,anon,authenticated;
grant execute on function public.create_booking_with_passengers(jsonb) to service_role;

-- Staff update wrapper used only after Worker permission checks.
create or replace function public.almaher_update_booking_atomic(p_booking_number text,p_booking jsonb,p_passengers jsonb default null,p_actor jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  return public.almaher_save_booking_atomic(jsonb_set(coalesce(p_booking,'{}'::jsonb),'{booking_number}',to_jsonb(p_booking_number),true),p_passengers,p_actor,true);
end;
$$;
revoke all on function public.almaher_update_booking_atomic(text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.almaher_update_booking_atomic(text,jsonb,jsonb,jsonb) to service_role;

notify pgrst,'reload schema';
commit;

-- Verification (read only)
select object_name,ok from (
  values
    ('activity_events',to_regclass('public.activity_events') is not null),
    ('almaher_upsert_trip_safe',to_regprocedure('public.almaher_upsert_trip_safe(jsonb,jsonb)') is not null),
    ('almaher_save_booking_atomic',to_regprocedure('public.almaher_save_booking_atomic(jsonb,jsonb,jsonb,boolean)') is not null),
    ('almaher_update_booking_atomic',to_regprocedure('public.almaher_update_booking_atomic(text,jsonb,jsonb,jsonb)') is not null),
    ('create_booking_with_passengers',to_regprocedure('public.create_booking_with_passengers(jsonb)') is not null)
) v(object_name,ok);


-- =============================================================
-- AL-MAHER V9.3.3 — SCAN EVENTS COMPLETE COMPATIBILITY
-- Safe / additive / idempotent.
-- Ensures every column used by the field QR scanner exists.
-- =============================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.scan_events (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid,
  booking_id uuid,
  trip_id uuid,
  trip_vehicle_id uuid,
  scan_mode text,
  result text,
  scanned_by text,
  device_id text,
  scanned_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.scan_events add column if not exists passenger_id uuid;
alter table public.scan_events add column if not exists booking_id uuid;
alter table public.scan_events add column if not exists trip_id uuid;
alter table public.scan_events add column if not exists trip_vehicle_id uuid;
alter table public.scan_events add column if not exists scan_mode text;
alter table public.scan_events add column if not exists result text;
alter table public.scan_events add column if not exists scanned_by text;
alter table public.scan_events add column if not exists device_id text;
alter table public.scan_events add column if not exists scanned_at timestamptz;
alter table public.scan_events add column if not exists metadata jsonb;

update public.scan_events
set scanned_at = coalesce(scanned_at, now()),
    scan_mode = coalesce(nullif(scan_mode,''), metadata->>'scan_mode', 'verify'),
    result = coalesce(nullif(result,''), metadata->>'scan_result', 'success'),
    metadata = coalesce(metadata, '{}'::jsonb);

alter table public.scan_events alter column scanned_at set default now();
alter table public.scan_events alter column metadata set default '{}'::jsonb;
alter table public.scan_events alter column result set default 'success';

create index if not exists scan_events_booking_idx
  on public.scan_events(booking_id, scanned_at desc);

create index if not exists scan_events_booking_mode_idx
  on public.scan_events(booking_id, scan_mode, scanned_at desc);

create index if not exists scan_events_trip_idx
  on public.scan_events(trip_id, scanned_at desc);

notify pgrst, 'reload schema';

commit;

-- Verification: all rows below should return ok = true.
with required_columns(column_name) as (
  values
    ('passenger_id'),
    ('booking_id'),
    ('trip_id'),
    ('trip_vehicle_id'),
    ('scan_mode'),
    ('result'),
    ('scanned_by'),
    ('device_id'),
    ('scanned_at'),
    ('metadata')
)
select
  'scan_events.' || r.column_name as object_name,
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema='public'
      and c.table_name='scan_events'
      and c.column_name=r.column_name
  ) as ok
from required_columns r
order by r.column_name;



-- =============================================================
-- V9.4 FINAL VERIFICATION — every row should be true
-- =============================================================
notify pgrst,'reload schema';
select object_name, ok from (
 values
 ('bookings',to_regclass('public.bookings') is not null),('booking_passengers',to_regclass('public.booking_passengers') is not null),('trips',to_regclass('public.trips') is not null),('branches',to_regclass('public.branches') is not null),('staff_users',to_regclass('public.staff_users') is not null),
 ('scan_events',to_regclass('public.scan_events') is not null),('vehicles',to_regclass('public.vehicles') is not null),('seat_assignments',to_regclass('public.seat_assignments') is not null),('hotels',to_regclass('public.hotels') is not null),('room_assignments',to_regclass('public.room_assignments') is not null),
 ('notifications',to_regclass('public.notifications') is not null),('leads',to_regclass('public.leads') is not null),('service_tickets',to_regclass('public.service_tickets') is not null),('tasks',to_regclass('public.tasks') is not null),('agents',to_regclass('public.agents') is not null),('supplier_contracts',to_regclass('public.supplier_contracts') is not null),
 ('approval_requests',to_regclass('public.approval_requests') is not null),('incidents',to_regclass('public.incidents') is not null),('translation_entries',to_regclass('public.translation_entries') is not null),('system_releases',to_regclass('public.system_releases') is not null),('activity_events',to_regclass('public.activity_events') is not null),
 ('passenger_documents',to_regclass('public.passenger_documents') is not null),('trip_meeting_points',to_regclass('public.trip_meeting_points') is not null),('passenger_meeting_points',to_regclass('public.passenger_meeting_points') is not null),('checklist_templates',to_regclass('public.checklist_templates') is not null),('trip_checklist_runs',to_regclass('public.trip_checklist_runs') is not null),
 ('operations_drivers',to_regclass('public.operations_drivers') is not null),('app_runtime_state',to_regclass('public.app_runtime_state') is not null),('trip_runtime_extensions',to_regclass('public.trip_runtime_extensions') is not null),
 ('scan_events.result',exists(select 1 from information_schema.columns where table_schema='public' and table_name='scan_events' and column_name='result')),
 ('scan_events.device_id',exists(select 1 from information_schema.columns where table_schema='public' and table_name='scan_events' and column_name='device_id')),
 ('scan_events.metadata',exists(select 1 from information_schema.columns where table_schema='public' and table_name='scan_events' and column_name='metadata')),
 ('booking.financial_status',exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='financial_status')),
 ('passenger.preferred_language',exists(select 1 from information_schema.columns where table_schema='public' and table_name='booking_passengers' and column_name='preferred_language')),
 ('almaher_upsert_trip_safe',to_regprocedure('public.almaher_upsert_trip_safe(jsonb,jsonb)') is not null),
 ('almaher_save_booking_atomic',to_regprocedure('public.almaher_save_booking_atomic(jsonb,jsonb,jsonb,boolean)') is not null),
 ('almaher_update_booking_atomic',to_regprocedure('public.almaher_update_booking_atomic(text,jsonb,jsonb,jsonb)') is not null),
 ('create_booking_with_passengers',to_regprocedure('public.create_booking_with_passengers(jsonb)') is not null)
) v(object_name,ok) order by object_name;
