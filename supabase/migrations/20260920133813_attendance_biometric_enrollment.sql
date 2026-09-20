create table if not exists public.attendance_biometric_profiles (
  id uuid primary key default gen_random_uuid(),
  attendance_employee_id uuid not null,
  branch_id uuid null,
  source_device_id uuid null,
  device_pin text null,
  biometric_type text not null check (biometric_type in ('finger','face')),
  biometric_key text not null,
  finger_code text null,
  slot_no smallint null check (slot_no is null or (slot_no between 0 and 9)),
  status text not null default 'active' check (status in ('active','disabled','error')),
  version integer not null default 1 check (version > 0),
  last_enrolled_at timestamptz null,
  last_sync_at timestamptz null,
  last_result_code integer null,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  metadata jsonb not null default '{}'::jsonb,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_biometric_profiles_key_unique
    unique (attendance_employee_id, biometric_key, data_environment),
  constraint attendance_biometric_profiles_shape_check
    check (
      (biometric_type = 'face' and finger_code is null and slot_no is null and biometric_key = 'face')
      or
      (biometric_type = 'finger' and finger_code is not null and slot_no is not null and biometric_key = ('finger:' || finger_code))
    )
);

create index if not exists attendance_biometric_profiles_employee_idx
  on public.attendance_biometric_profiles(attendance_employee_id, data_environment);

create index if not exists attendance_biometric_profiles_branch_idx
  on public.attendance_biometric_profiles(branch_id, biometric_type, status);

create index if not exists attendance_biometric_profiles_device_idx
  on public.attendance_biometric_profiles(source_device_id, status);

alter table public.attendance_biometric_profiles enable row level security;
revoke all on table public.attendance_biometric_profiles from anon, authenticated;
grant select, insert, update, delete on table public.attendance_biometric_profiles to service_role;

create table if not exists public.attendance_biometric_enrollment_requests (
  id uuid primary key default gen_random_uuid(),
  attendance_employee_id uuid not null,
  branch_id uuid null,
  device_id uuid not null,
  device_pin text not null,
  biometric_type text not null check (biometric_type in ('finger','face')),
  biometric_key text not null,
  finger_code text null,
  slot_no smallint null check (slot_no is null or (slot_no between 0 and 9)),
  overwrite_existing boolean not null default true,
  retry_count smallint not null default 3 check (retry_count between 1 and 9),
  status text not null default 'queued' check (status in ('queued','sent','success','failed','cancelled')),
  command_id bigint null,
  result_code integer null,
  reason text null,
  requested_by text null,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_biometric_requests_shape_check
    check (
      (biometric_type = 'face' and finger_code is null and slot_no is null and biometric_key = 'face')
      or
      (biometric_type = 'finger' and finger_code is not null and slot_no is not null and biometric_key = ('finger:' || finger_code))
    )
);

create unique index if not exists attendance_biometric_requests_command_uidx
  on public.attendance_biometric_enrollment_requests(command_id)
  where command_id is not null;

create index if not exists attendance_biometric_requests_employee_idx
  on public.attendance_biometric_enrollment_requests(attendance_employee_id, requested_at desc);

create index if not exists attendance_biometric_requests_device_status_idx
  on public.attendance_biometric_enrollment_requests(device_id, status, requested_at desc);

create unique index if not exists attendance_biometric_requests_one_pending_uidx
  on public.attendance_biometric_enrollment_requests(attendance_employee_id, device_id, biometric_key, data_environment)
  where status in ('queued','sent');

alter table public.attendance_biometric_enrollment_requests enable row level security;
revoke all on table public.attendance_biometric_enrollment_requests from anon, authenticated;
grant select, insert, update, delete on table public.attendance_biometric_enrollment_requests to service_role;
