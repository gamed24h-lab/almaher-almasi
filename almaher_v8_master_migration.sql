-- الماهر الماسي V8.0 — Master Migration
-- آمن للتشغيل أكثر من مرة قدر الإمكان. شغّله في Supabase > SQL Editor بعد أخذ نسخة احتياطية.

create extension if not exists pgcrypto;

-- 1) توسعة بيانات الفروع
alter table if exists public.branches add column if not exists commercial_registration text;
alter table if exists public.branches add column if not exists tax_number text;
alter table if exists public.branches add column if not exists email text;
alter table if exists public.branches add column if not exists working_hours text;
alter table if exists public.branches add column if not exists map_url text;
alter table if exists public.branches add column if not exists show_legal_on_ticket boolean not null default true;
alter table if exists public.branches add column if not exists settings jsonb not null default '{}'::jsonb;

-- 2) توسعة الرحلات: النشر/الظهور/الحالة والتجهيزات
alter table if exists public.trips add column if not exists publish_scope text not null default 'internal';
alter table if exists public.trips add column if not exists visibility text not null default 'visible';
alter table if exists public.trips add column if not exists lifecycle text not null default 'open';
alter table if exists public.trips add column if not exists meeting_point text;
alter table if exists public.trips add column if not exists meeting_instructions text;
alter table if exists public.trips add column if not exists trip_type text not null default 'travel';
alter table if exists public.trips add column if not exists public_notes text;
alter table if exists public.trips add column if not exists operational_notes text;
alter table if exists public.trips add column if not exists updated_at timestamptz not null default now();

-- 3) توسعة الحجوزات: حالة مالية/إصدارات/segments/عميل
alter table if exists public.bookings add column if not exists customer_account_id uuid;
alter table if exists public.bookings add column if not exists financial_status text not null default 'unpaid';
alter table if exists public.bookings add column if not exists ticket_version integer not null default 1;
alter table if exists public.bookings add column if not exists ticket_printed_at timestamptz;
alter table if exists public.bookings add column if not exists last_modified_by text;
alter table if exists public.bookings add column if not exists last_modified_at timestamptz;
alter table if exists public.bookings add column if not exists cancellation_reason text;
alter table if exists public.bookings add column if not exists branch_snapshot jsonb not null default '{}'::jsonb;

-- رحلة واحدة يمكن أن تحتوي قطاع ذهاب وقطاع عودة من رحلتين مختلفتين.
create table if not exists public.booking_segments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  segment_type text not null check (segment_type in ('outbound','return')),
  trip_id uuid references public.trips(id) on delete restrict,
  departure_date date,
  departure_time time,
  from_city text,
  to_city text,
  seat_number text,
  status text not null default 'booked',
  price numeric(12,2) not null default 0,
  qr_token text,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(booking_id, segment_type)
);
create index if not exists booking_segments_booking_idx on public.booking_segments(booking_id);
create index if not exists booking_segments_trip_idx on public.booking_segments(trip_id);

-- حالة كل مسافر مستقلة وإلغاء جزئي/سكن مستقل
alter table if exists public.booking_passengers add column if not exists status text not null default 'confirmed';
alter table if exists public.booking_passengers add column if not exists accommodation_status text not null default 'active';
alter table if exists public.booking_passengers add column if not exists seat_outbound text;
alter table if exists public.booking_passengers add column if not exists seat_return text;
alter table if exists public.booking_passengers add column if not exists special_assistance text;
alter table if exists public.booking_passengers add column if not exists cancelled_at timestamptz;
alter table if exists public.booking_passengers add column if not exists cancellation_reason text;

-- 4) السنة المالية والمصروفات والدفعات/المرتجعات
create table if not exists public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null,
  end_date date not null,
  status text not null default 'open',
  closed_at timestamptz,
  closed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  fiscal_year_id uuid references public.fiscal_years(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  category text not null,
  amount numeric(12,2) not null check(amount >= 0),
  payment_method text,
  supplier_id uuid,
  notes text,
  status text not null default 'approved',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses(expense_date);
create index if not exists expenses_branch_idx on public.expenses(branch_id);
create index if not exists expenses_trip_idx on public.expenses(trip_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  fiscal_year_id uuid references public.fiscal_years(id) on delete set null,
  transaction_type text not null check(transaction_type in ('payment','refund','credit','adjustment')),
  amount numeric(12,2) not null check(amount >= 0),
  payment_method text,
  reference_no text,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists transactions_booking_idx on public.transactions(booking_id);
create index if not exists transactions_created_idx on public.transactions(created_at);

-- 5) الموردون ومراكز التكلفة والعهد (أساس للتوسع المالي)
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  supplier_type text,
  phone text,
  email text,
  commercial_registration text,
  tax_number text,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  staff_user_id text references public.staff_users(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  amount numeric(12,2) not null check(amount >= 0),
  advance_type text not null default 'advance',
  status text not null default 'open',
  notes text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

-- 6) الأتمتة والبريد
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch_id uuid references public.branches(id) on delete cascade,
  trigger_key text not null,
  mode text not null default 'manual',
  recipient_emails jsonb not null default '[]'::jsonb,
  payload_fields jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_logs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.automation_rules(id) on delete set null,
  event_key text,
  recipient text,
  status text,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 7) بيانات ديناميكية: أنواع الحافلات، المصروفات، طرق الدفع، حالات الحجز...
create table if not exists public.master_data (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  code text not null,
  label_ar text not null,
  label_en text,
  sort_order integer not null default 0,
  active boolean not null default true,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(category, code)
);
insert into public.master_data(category,code,label_ar,sort_order) values
 ('bus_type','vip','VIP',10),('bus_type','vip30','VIP 30',20),('bus_type','vip49','VIP 49',30),('bus_type','standard','عادي',40),('bus_type','minibus','ميني باص',50),
 ('expense_category','fuel','وقود',10),('expense_category','housing','سكن',20),('expense_category','maintenance','صيانة',30),('expense_category','salary','رواتب',40),('expense_category','commission','عمولة',50),('expense_category','operations','تشغيل',60),('expense_category','other','أخرى',99)
on conflict(category,code) do nothing;

-- 8) سجل مراجعة مفصل
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id text,
  actor_name text,
  actor_role text,
  action text not null,
  entity_type text,
  entity_id text,
  branch_id uuid references public.branches(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_entity_idx on public.audit_events(entity_type,entity_id);
create index if not exists audit_events_created_idx on public.audit_events(created_at desc);

-- 9) نظام التحديث بدون Deploy — يحتفظ بملف HTML للإصدار النشط
create table if not exists public.system_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  channel text not null default 'test' check(channel in ('test','stable')),
  notes text,
  content text not null,
  active boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(version,channel)
);
create unique index if not exists one_active_system_release_per_channel
  on public.system_releases(channel) where active = true;

-- 10) ملفات العملاء والمسافرون المحفوظون
create table if not exists public.customer_profiles (
  user_id uuid primary key,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.saved_travelers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  full_name text not null,
  gender text,
  nationality text,
  identity_number text,
  phone text,
  relation text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_travelers_owner_idx on public.saved_travelers(owner_user_id);

-- 11) حماية الجداول الإدارية: الوصول من Netlify Functions (Service Role) هو المسار الأساسي.
do $$
declare t text;
begin
  foreach t in array array['fiscal_years','expenses','transactions','suppliers','employee_advances','automation_rules','automation_logs','master_data','audit_events','system_releases'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security',t);
      execute format('revoke all on public.%I from anon, authenticated',t);
    end if;
  end loop;
end $$;

-- بيانات العملاء: المستخدم المسجل يرى بياناته فقط.
alter table public.customer_profiles enable row level security;
alter table public.saved_travelers enable row level security;

drop policy if exists "customer profile own select" on public.customer_profiles;
create policy "customer profile own select" on public.customer_profiles for select to authenticated using (user_id=auth.uid());
drop policy if exists "customer profile own write" on public.customer_profiles;
create policy "customer profile own write" on public.customer_profiles for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists "saved travelers own" on public.saved_travelers;
create policy "saved travelers own" on public.saved_travelers for all to authenticated using (owner_user_id=auth.uid()) with check (owner_user_id=auth.uid());

-- رحلة عامة: لو لديك سياسة trips قائمة، احتفظ بها. هذا العمود يتيح فلترة الرحلات المنشورة فقط من الواجهة.

-- انتهى Master Migration V8.0
