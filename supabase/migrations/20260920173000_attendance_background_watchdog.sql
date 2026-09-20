create table if not exists public.attendance_watchdog_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'scheduled',
  status text not null default 'running',
  runtime_mode text not null default 'training',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  duration_ms integer null,
  devices_count integer not null default 0,
  active_notifications integer not null default 0,
  critical_notifications integer not null default 0,
  escalations_count integer not null default 0,
  deliveries_queued integer not null default 0,
  deliveries_failed integer not null default 0,
  error_text text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attendance_watchdog_runs_started_idx
  on public.attendance_watchdog_runs(started_at desc);

create index if not exists attendance_watchdog_runs_status_idx
  on public.attendance_watchdog_runs(status,started_at desc);

alter table public.attendance_watchdog_runs enable row level security;
revoke all on table public.attendance_watchdog_runs from anon, authenticated;
