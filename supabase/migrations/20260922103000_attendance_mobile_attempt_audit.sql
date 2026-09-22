-- Rejected / pending mobile attendance attempts for operational review.

create table if not exists public.attendance_mobile_attempts (
  id uuid primary key default gen_random_uuid(),
  attendance_employee_id uuid not null references public.attendance_employees(id) on delete cascade,
  staff_user_id text references public.staff_users(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  mobile_device_id uuid references public.attendance_mobile_devices(id) on delete set null,
  event_type text check (event_type in ('check_in','check_out')),
  outcome text not null check (outcome in ('rejected','pending_device')),
  reason_code text not null,
  reason_text text,
  attempted_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  distance_from_site_m double precision,
  device_label text,
  metadata jsonb not null default '{}'::jsonb,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  created_at timestamptz not null default now()
);

create index if not exists attendance_mobile_attempts_branch_time_idx
  on public.attendance_mobile_attempts(branch_id,attempted_at desc);

create index if not exists attendance_mobile_attempts_employee_time_idx
  on public.attendance_mobile_attempts(attendance_employee_id,attempted_at desc);

alter table public.attendance_mobile_attempts enable row level security;

comment on table public.attendance_mobile_attempts is
  'Service-role-only audit of rejected or pending mobile attendance attempts for HR review.';
