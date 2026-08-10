create extension if not exists pgcrypto;

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_users (
  id text primary key,
  name text not null,
  username text not null unique,
  password text not null default '',
  phone text,
  role text not null,
  branch_id uuid references public.branches(id) on delete set null,
  status text not null default 'نشط',
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_notifications_cloud (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.system_settings enable row level security;
alter table public.staff_users enable row level security;
alter table public.staff_notifications_cloud enable row level security;

revoke all on public.system_settings from anon, authenticated;
revoke all on public.staff_users from anon, authenticated;
revoke all on public.staff_notifications_cloud from anon, authenticated;
