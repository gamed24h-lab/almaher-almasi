create table if not exists public.attendance_device_health_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  branch_id uuid null,
  event_type text not null,
  severity text not null default 'warning',
  status text not null default 'closed',
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  duration_seconds integer null,
  command_id bigint null references public.attendance_device_commands(id) on delete set null,
  result_code integer null,
  summary text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attendance_device_health_events_device_started_idx
  on public.attendance_device_health_events(device_id, started_at desc);

create index if not exists attendance_device_health_events_branch_started_idx
  on public.attendance_device_health_events(branch_id, started_at desc);

create index if not exists attendance_device_health_events_type_started_idx
  on public.attendance_device_health_events(event_type, started_at desc);

alter table public.attendance_device_health_events enable row level security;
revoke all on table public.attendance_device_health_events from anon, authenticated;

insert into public.attendance_device_health_events
(event_key,device_id,branch_id,event_type,severity,status,started_at,ended_at,duration_seconds,command_id,result_code,summary,metadata)
select
  'command_failed:'||c.id::text,
  c.device_id,
  d.branch_id,
  'command_failed',
  case when c.command_type in ('history_attlog','history_attlog_replay','sync_attlog','sync_users','diagnostic_info') then 'warning' else 'info' end,
  'closed',
  coalesce(c.completed_at,c.updated_at,c.created_at),
  coalesce(c.completed_at,c.updated_at,c.created_at),
  0,
  c.id,
  c.result_code,
  'فشل أمر '||c.command_type||coalesce(' (Code '||c.result_code::text||')',''),
  jsonb_build_object('command_type',c.command_type,'backfilled',true)
from public.attendance_device_commands c
join public.attendance_devices d on d.id=c.device_id
where c.status='failed'
on conflict (event_key) do nothing;
