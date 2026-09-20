create table if not exists public.attendance_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_key text not null unique,
  branch_id uuid null,
  device_id uuid null references public.attendance_devices(id) on delete cascade,
  category text not null default 'device_health',
  severity text not null default 'warning',
  title text not null,
  message text null,
  status text not null default 'new',
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_at timestamptz null,
  seen_by text null,
  resolved_at timestamptz null,
  resolved_by text null,
  resolved_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_notifications_branch_status_idx
  on public.attendance_notifications(branch_id,status,active,last_seen_at desc);

create index if not exists attendance_notifications_device_idx
  on public.attendance_notifications(device_id,last_seen_at desc);

create index if not exists attendance_notifications_active_idx
  on public.attendance_notifications(active,severity,last_seen_at desc);

alter table public.attendance_notifications enable row level security;
revoke all on table public.attendance_notifications from anon, authenticated;
