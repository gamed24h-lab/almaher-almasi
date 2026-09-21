create table if not exists public.attendance_device_clock_checks (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  branch_id uuid null,
  serial_number text null,
  source text not null default 'attlog_live',
  device_time_raw text null,
  server_time timestamptz not null default now(),
  drift_seconds integer null,
  status text not null default 'unknown',
  confirmed boolean not null default false,
  sample_count integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attendance_device_clock_checks_device_idx
  on public.attendance_device_clock_checks(device_id,created_at desc);

create index if not exists attendance_device_clock_checks_status_idx
  on public.attendance_device_clock_checks(status,confirmed,created_at desc);

alter table public.attendance_device_clock_checks enable row level security;
revoke all on table public.attendance_device_clock_checks from anon, authenticated;
