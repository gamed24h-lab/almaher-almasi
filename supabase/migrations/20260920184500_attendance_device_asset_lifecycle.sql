create table if not exists public.attendance_device_assets (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null unique references public.attendance_devices(id) on delete cascade,
  branch_id uuid null,
  asset_tag text null unique,
  purchase_date date null,
  installation_date date null,
  purchase_cost numeric(14,2) not null default 0,
  replacement_cost numeric(14,2) not null default 0,
  expected_life_months integer not null default 60,
  warranty_start_date date null,
  warranty_end_date date null,
  service_contract_end_date date null,
  vendor_name text null,
  vendor_contact text null,
  criticality text not null default 'medium',
  asset_status text not null default 'active',
  notes text null,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_device_assets_branch_idx
  on public.attendance_device_assets(branch_id,asset_status,updated_at desc);

create table if not exists public.attendance_device_asset_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  asset_id uuid null references public.attendance_device_assets(id) on delete cascade,
  event_type text not null,
  event_date timestamptz not null default now(),
  title text not null,
  details text null,
  amount numeric(14,2) not null default 0,
  actor_id text null,
  actor_name text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attendance_device_asset_events_device_idx
  on public.attendance_device_asset_events(device_id,event_date desc);

alter table public.attendance_device_assets enable row level security;
alter table public.attendance_device_asset_events enable row level security;
revoke all on table public.attendance_device_assets from anon, authenticated;
revoke all on table public.attendance_device_asset_events from anon, authenticated;
