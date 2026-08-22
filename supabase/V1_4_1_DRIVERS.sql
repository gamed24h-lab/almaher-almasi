begin;

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete set null,
  name text not null,
  phone text not null,
  national_id text,
  license_no text,
  license_expiry date,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_drivers_branch_id on public.drivers(branch_id);
create index if not exists idx_drivers_status on public.drivers(status);

alter table public.drivers enable row level security;

commit;
