create table if not exists public.attendance_notification_delivery_settings (
  id text primary key default 'default',
  whatsapp_enabled boolean not null default false,
  email_enabled boolean not null default false,
  auto_dispatch boolean not null default false,
  whatsapp_provider text null default 'notification_jobs',
  email_provider text null,
  updated_by text null,
  updated_at timestamptz not null default now()
);

insert into public.attendance_notification_delivery_settings(id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.attendance_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null unique,
  notification_id uuid not null references public.attendance_notifications(id) on delete cascade,
  escalation_event_id uuid null references public.attendance_notification_escalation_events(id) on delete set null,
  escalation_level integer not null default 0,
  recipient_staff_id text null,
  recipient_name text null,
  recipient_role text null,
  branch_id uuid null,
  channel text not null,
  destination text null,
  status text not null default 'ready',
  provider text null,
  provider_job_id uuid null references public.notification_jobs(id) on delete set null,
  attempt_count integer not null default 0,
  error_text text null,
  queued_at timestamptz null,
  sent_at timestamptz null,
  delivered_at timestamptz null,
  failed_at timestamptz null,
  read_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_notification_deliveries_notification_idx
  on public.attendance_notification_deliveries(notification_id,created_at desc);

create index if not exists attendance_notification_deliveries_status_idx
  on public.attendance_notification_deliveries(status,channel,created_at desc);

alter table public.attendance_notification_delivery_settings enable row level security;
alter table public.attendance_notification_deliveries enable row level security;
revoke all on table public.attendance_notification_delivery_settings from anon, authenticated;
revoke all on table public.attendance_notification_deliveries from anon, authenticated;

insert into public.notification_templates
(template_key,category,channel,language_code,title,body,active,variables)
select
'attendance_escalation_alert',
'operational',
'whatsapp',
'ar',
'تنبيه حضور',
'تنبيه حضور: {{alert_title}}
{{alert_message}}
الجهاز: {{device_name}}
الفرع: {{branch_name}}
مستوى التصعيد: {{escalation_level}}
وقت ظهور التنبيه: {{first_seen_at}}',
true,
'["alert_title","alert_message","device_name","branch_name","escalation_level","first_seen_at"]'::jsonb
where not exists (
  select 1 from public.notification_templates
  where template_key='attendance_escalation_alert'
    and channel='whatsapp'
    and language_code='ar'
);
