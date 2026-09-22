-- Mobile attendance capture and trusted-device registry.

alter table public.attendance_branch_policies
  add column if not exists mobile_max_accuracy_m integer not null default 120;

alter table public.attendance_branch_policies
  drop constraint if exists attendance_branch_policies_mobile_max_accuracy_check;

alter table public.attendance_branch_policies
  add constraint attendance_branch_policies_mobile_max_accuracy_check
    check (mobile_max_accuracy_m between 10 and 1000);

create table if not exists public.attendance_mobile_devices (
  id uuid primary key default gen_random_uuid(),
  attendance_employee_id uuid not null references public.attendance_employees(id) on delete cascade,
  staff_user_id text not null references public.staff_users(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  device_key_hash text not null,
  device_label text,
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  revoked_at timestamptz,
  revoked_by text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_mobile_devices_employee_key_unique unique (attendance_employee_id,device_key_hash,data_environment)
);

create index if not exists attendance_mobile_devices_branch_status_idx
  on public.attendance_mobile_devices(branch_id,status,updated_at desc);

create table if not exists public.attendance_mobile_events (
  id uuid primary key default gen_random_uuid(),
  attendance_employee_id uuid not null references public.attendance_employees(id) on delete restrict,
  staff_user_id text references public.staff_users(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  mobile_device_id uuid references public.attendance_mobile_devices(id) on delete set null,
  event_type text not null check (event_type in ('check_in','check_out')),
  occurred_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  distance_from_site_m double precision,
  inside_geofence boolean,
  source text not null default 'mobile_web',
  policy_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists attendance_mobile_events_employee_time_idx
  on public.attendance_mobile_events(attendance_employee_id,occurred_at desc);

create index if not exists attendance_mobile_events_branch_time_idx
  on public.attendance_mobile_events(branch_id,occurred_at desc);

alter table public.attendance_mobile_devices enable row level security;
alter table public.attendance_mobile_events enable row level security;

comment on table public.attendance_mobile_devices is
  'Opaque trusted-device registrations for employee mobile attendance. Access is service-role only through the Worker.';
comment on table public.attendance_mobile_events is
  'Server-timestamped mobile attendance events normalized into attendance reports by the Worker.';
