create table if not exists public.attendance_preventive_maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  branch_id uuid null,
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  title text not null,
  active boolean not null default true,
  frequency_days integer not null default 30,
  lead_days integer not null default 7,
  checklist jsonb not null default '[]'::jsonb,
  assigned_staff_id text null,
  assigned_staff_name text null,
  vendor_name text null,
  next_due_at timestamptz not null,
  last_completed_at timestamptz null,
  recurrence_window_days integer not null default 90,
  recurrence_threshold integer not null default 3,
  notes text null,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_pm_plans_due_idx
  on public.attendance_preventive_maintenance_plans(active,next_due_at);
create index if not exists attendance_pm_plans_device_idx
  on public.attendance_preventive_maintenance_plans(device_id,active);

create table if not exists public.attendance_preventive_maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.attendance_preventive_maintenance_plans(id) on delete cascade,
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  branch_id uuid null,
  due_at timestamptz not null,
  status text not null default 'completed',
  started_at timestamptz null,
  completed_at timestamptz null,
  performed_by_staff_id text null,
  performed_by_name text null,
  checklist_results jsonb not null default '{}'::jsonb,
  findings text null,
  action_taken text null,
  total_cost numeric(14,2) not null default 0,
  skip_reason text null,
  linked_incident_id uuid null references public.attendance_incidents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_pm_runs_plan_idx
  on public.attendance_preventive_maintenance_runs(plan_id,completed_at desc,created_at desc);
create index if not exists attendance_pm_runs_device_idx
  on public.attendance_preventive_maintenance_runs(device_id,created_at desc);

alter table public.attendance_preventive_maintenance_plans enable row level security;
alter table public.attendance_preventive_maintenance_runs enable row level security;
revoke all on table public.attendance_preventive_maintenance_plans from anon, authenticated;
revoke all on table public.attendance_preventive_maintenance_runs from anon, authenticated;
