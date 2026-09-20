alter table public.attendance_notifications
  add column if not exists escalation_level integer not null default 0,
  add column if not exists target_roles text[] not null default '{}'::text[],
  add column if not exists escalation_channels jsonb not null default '{"in_app":true,"whatsapp":false,"email":false}'::jsonb,
  add column if not exists escalation_rule_id uuid null,
  add column if not exists escalated_at timestamptz null,
  add column if not exists next_escalation_at timestamptz null;

create table if not exists public.attendance_notification_escalation_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  branch_id uuid null,
  category text not null default '*',
  severity text not null default '*',
  active boolean not null default true,
  level1_minutes integer null,
  level2_minutes integer null,
  level3_minutes integer null,
  level1_roles text[] not null default '{}'::text[],
  level2_roles text[] not null default '{}'::text[],
  level3_roles text[] not null default '{}'::text[],
  channels jsonb not null default '{"in_app":true,"whatsapp":false,"email":false}'::jsonb,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_notification_escalation_rules_match_idx
  on public.attendance_notification_escalation_rules(active,branch_id,category,severity);

create table if not exists public.attendance_notification_escalation_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  notification_id uuid not null references public.attendance_notifications(id) on delete cascade,
  escalation_level integer not null,
  target_roles text[] not null default '{}'::text[],
  channels jsonb not null default '{}'::jsonb,
  rule_id uuid null references public.attendance_notification_escalation_rules(id) on delete set null,
  summary text null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_notification_escalation_events_notification_idx
  on public.attendance_notification_escalation_events(notification_id,created_at desc);

alter table public.attendance_notification_escalation_rules enable row level security;
alter table public.attendance_notification_escalation_events enable row level security;
revoke all on table public.attendance_notification_escalation_rules from anon, authenticated;
revoke all on table public.attendance_notification_escalation_events from anon, authenticated;

insert into public.attendance_notification_escalation_rules
(rule_key,category,severity,level1_minutes,level2_minutes,level3_minutes,level1_roles,level2_roles,level3_roles,channels)
values
('default-critical','*','critical',0,30,60,array['الموارد البشرية'],array['مدير فرع'],array['مدير عام'],'{"in_app":true,"whatsapp":false,"email":false}'::jsonb),
('default-warning','*','warning',0,120,240,array['الموارد البشرية'],array['مدير فرع'],array['مدير عام'],'{"in_app":true,"whatsapp":false,"email":false}'::jsonb),
('default-info','*','info',60,360,720,array['الموارد البشرية'],array['مدير فرع'],array['مدير عام'],'{"in_app":true,"whatsapp":false,"email":false}'::jsonb)
on conflict (rule_key) do nothing;
