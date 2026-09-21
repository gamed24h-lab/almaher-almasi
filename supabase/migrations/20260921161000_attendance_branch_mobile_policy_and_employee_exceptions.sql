-- Attendance policy engine: branch capture mode + effective-dated policy snapshots + employee exceptions.
-- Additive foundation for mobile attendance without changing current biometric behavior.

alter table public.attendance_branch_policies
  add column if not exists attendance_mode text not null default 'biometric',
  add column if not exists mobile_geofence_enabled boolean not null default true,
  add column if not exists mobile_geofence_radius_m integer not null default 100,
  add column if not exists mobile_location_lat double precision,
  add column if not exists mobile_location_lng double precision,
  add column if not exists mobile_require_trusted_device boolean not null default true,
  add column if not exists mobile_require_selfie boolean not null default false,
  add column if not exists mobile_require_dynamic_qr boolean not null default false,
  add column if not exists policy_effective_from date not null default current_date;

alter table public.attendance_branch_policies
  drop constraint if exists attendance_branch_policies_attendance_mode_check,
  drop constraint if exists attendance_branch_policies_mobile_geofence_radius_check,
  drop constraint if exists attendance_branch_policies_mobile_location_lat_check,
  drop constraint if exists attendance_branch_policies_mobile_location_lng_check;

alter table public.attendance_branch_policies
  add constraint attendance_branch_policies_attendance_mode_check
    check (attendance_mode in ('biometric','mobile','hybrid')),
  add constraint attendance_branch_policies_mobile_geofence_radius_check
    check (mobile_geofence_radius_m between 20 and 5000),
  add constraint attendance_branch_policies_mobile_location_lat_check
    check (mobile_location_lat is null or mobile_location_lat between -90 and 90),
  add constraint attendance_branch_policies_mobile_location_lng_check
    check (mobile_location_lng is null or mobile_location_lng between -180 and 180);

create table if not exists public.attendance_branch_policy_versions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  effective_from date not null,
  effective_to date,
  policy_snapshot jsonb not null default '{}'::jsonb,
  reason text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_branch_policy_versions_range_check check (effective_to is null or effective_to >= effective_from),
  constraint attendance_branch_policy_versions_unique unique (branch_id,data_environment,effective_from)
);

create index if not exists attendance_branch_policy_versions_lookup_idx
  on public.attendance_branch_policy_versions(branch_id,data_environment,effective_from desc);

insert into public.attendance_branch_policy_versions
  (branch_id,data_environment,effective_from,effective_to,policy_snapshot,reason,created_by,updated_by)
select
  p.branch_id,
  p.data_environment,
  date '2000-01-01',
  null,
  to_jsonb(p),
  'خط أساس تلقائي قبل تفعيل سجل سياسات الحضور',
  p.created_by,
  p.updated_by
from public.attendance_branch_policies p
on conflict (branch_id,data_environment,effective_from) do nothing;

alter table public.attendance_employee_calendar_rules
  add column if not exists policy_payload jsonb not null default '{}'::jsonb;

alter table public.attendance_employee_calendar_rules
  drop constraint if exists attendance_employee_calendar_rules_rule_type_check;

alter table public.attendance_employee_calendar_rules
  add constraint attendance_employee_calendar_rules_rule_type_check
  check (rule_type in (
    'leave',
    'permission',
    'overtime',
    'work_override',
    'off',
    'attendance_exempt',
    'location_exempt',
    'late_exempt',
    'checkout_exempt',
    'attendance_mode_override'
  ));

create index if not exists attendance_employee_policy_exception_lookup_idx
  on public.attendance_employee_calendar_rules(attendance_employee_id,rule_type,start_date,end_date)
  where status='active' and rule_type in (
    'attendance_exempt',
    'location_exempt',
    'late_exempt',
    'checkout_exempt',
    'attendance_mode_override'
  );

comment on column public.attendance_branch_policies.attendance_mode is
  'biometric = device only, mobile = phone attendance, hybrid = either source.';
comment on column public.attendance_employee_calendar_rules.policy_payload is
  'Structured settings for policy exceptions, such as attendance_mode override.';
