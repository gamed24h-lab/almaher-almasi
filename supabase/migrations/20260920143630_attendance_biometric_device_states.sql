create table if not exists public.attendance_biometric_device_states (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  attendance_employee_id uuid not null,
  branch_id uuid null,
  device_pin text not null,
  biometric_type text not null check (biometric_type in ('finger','face')),
  biometric_key text not null,
  finger_code text null,
  slot_no smallint null check (slot_no is null or slot_no between 0 and 9),
  status text not null default 'active' check (status in ('active','disabled','error')),
  last_seen_at timestamptz null,
  last_result_code integer null,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_biometric_device_states_unique
    unique (device_id, attendance_employee_id, biometric_key, data_environment),
  constraint attendance_biometric_device_states_shape_check
    check (
      (biometric_type='face' and finger_code is null and slot_no is null and biometric_key='face')
      or
      (biometric_type='finger' and finger_code is not null and slot_no is not null and biometric_key=('finger:'||finger_code))
    )
);

create index if not exists attendance_biometric_device_states_device_idx
  on public.attendance_biometric_device_states(device_id, status, data_environment);

create index if not exists attendance_biometric_device_states_employee_idx
  on public.attendance_biometric_device_states(attendance_employee_id, status, data_environment);

create index if not exists attendance_biometric_device_states_branch_idx
  on public.attendance_biometric_device_states(branch_id, status, data_environment);

alter table public.attendance_biometric_device_states enable row level security;
revoke all on table public.attendance_biometric_device_states from anon, authenticated;
grant select, insert, update, delete on table public.attendance_biometric_device_states to service_role;
