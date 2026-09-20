create table if not exists public.attendance_incident_maintenance (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null unique references public.attendance_incidents(id) on delete cascade,
  root_cause_category text null,
  root_cause_text text null,
  maintenance_type text null,
  action_taken text null,
  preventive_action text null,
  recurrence_risk text null default 'medium',
  recurrence_prevented boolean not null default false,
  technician_staff_id text null,
  technician_name text null,
  vendor_name text null,
  maintenance_started_at timestamptz null,
  maintenance_completed_at timestamptz null,
  verified_at timestamptz null,
  verified_by text null,
  verification_note text null,
  parts_cost numeric(14,2) not null default 0,
  labor_cost numeric(14,2) not null default 0,
  other_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_incident_maintenance_cause_idx
  on public.attendance_incident_maintenance(root_cause_category,maintenance_type,updated_at desc);

create table if not exists public.attendance_incident_maintenance_actions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.attendance_incidents(id) on delete cascade,
  maintenance_id uuid null references public.attendance_incident_maintenance(id) on delete cascade,
  action_type text not null default 'work',
  description text not null,
  part_name text null,
  quantity numeric(12,2) null,
  unit_cost numeric(14,2) null,
  labor_cost numeric(14,2) not null default 0,
  other_cost numeric(14,2) not null default 0,
  performed_by text null,
  performed_at timestamptz not null default now(),
  outcome text null,
  created_by text null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_incident_maintenance_actions_incident_idx
  on public.attendance_incident_maintenance_actions(incident_id,performed_at desc);

alter table public.attendance_incident_maintenance enable row level security;
alter table public.attendance_incident_maintenance_actions enable row level security;
revoke all on table public.attendance_incident_maintenance from anon, authenticated;
revoke all on table public.attendance_incident_maintenance_actions from anon, authenticated;
