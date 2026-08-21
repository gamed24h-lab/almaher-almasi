-- =============================================================
-- AL-MAHER V9.2.8 — CLOUD PERSISTENCE SAFETY
-- Run once in Supabase SQL Editor BEFORE deploying V9.2.8
-- Safe: CREATE IF NOT EXISTS / ADDITIVE ONLY
-- =============================================================

begin;

create table if not exists public.operations_drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  identity_number text,
  nationality text,
  license_number text,
  license_expiry date,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists operations_drivers_identity_uq on public.operations_drivers(identity_number) where identity_number is not null and identity_number<>'';
create index if not exists operations_drivers_phone_idx on public.operations_drivers(phone);

create table if not exists public.app_runtime_state (
  state_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_runtime_extensions (
  trip_code text primary key,
  trip_id uuid references public.trips(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
create index if not exists trip_runtime_extensions_branch_idx on public.trip_runtime_extensions(branch_id);

create table if not exists public.activity_events (
  id bigserial primary key,
  actor_id text,
  actor_name text,
  actor_role text,
  branch_id uuid references public.branches(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_events_created_idx on public.activity_events(created_at desc);
create index if not exists activity_events_branch_idx on public.activity_events(branch_id,created_at desc);

create table if not exists public.customer_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  status text not null default 'active' check(status in ('active','inactive','blocked')),
  preferred_language text not null default 'ar',
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_portal_accounts add column if not exists failed_login_attempts integer not null default 0;
alter table public.customer_portal_accounts add column if not exists locked_until timestamptz;
alter table public.customer_portal_accounts add column if not exists last_login_at timestamptz;
create unique index if not exists customer_portal_accounts_email_uq on public.customer_portal_accounts(lower(email));

create table if not exists public.customer_saved_travelers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_portal_accounts(id) on delete cascade,
  full_name text not null,
  gender text,
  nationality text,
  identity_number text not null,
  phone text,
  relation text,
  preferred_language text not null default 'ar',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id,identity_number)
);
alter table public.customer_saved_travelers add column if not exists archived_at timestamptz;
create index if not exists customer_saved_travelers_account_idx on public.customer_saved_travelers(account_id);

-- Atomic branch contact replacement: old contacts remain intact if an insert fails.
create or replace function public.replace_branch_contacts(p_branch_id uuid,p_contacts jsonb)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer:=0;
begin
  if p_branch_id is null then raise exception 'branch id required'; end if;
  delete from public.branch_contacts where branch_id=p_branch_id;
  insert into public.branch_contacts(branch_id,label,phone,sort_order)
  select p_branch_id,coalesce(nullif(x->>'label',''),'رقم التواصل'),coalesce(x->>'phone',''),coalesce((x->>'sort_order')::integer,ord::integer)
  from jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) with ordinality as e(x,ord);
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.replace_branch_contacts(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_branch_contacts(uuid,jsonb) to service_role;

-- Atomic passenger replacement: delete + insert occurs in one PostgreSQL transaction.
create or replace function public.replace_booking_passengers(p_booking_id uuid,p_passengers jsonb)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer:=0;
begin
  if p_booking_id is null then raise exception 'booking id required'; end if;
  delete from public.booking_passengers where booking_id=p_booking_id;
  insert into public.booking_passengers(
    booking_id,passenger_order,full_name,gender,nationality,identity_number,phone,status,accommodation_status,
    preferred_language,assistance_flags,document_status
  )
  select p_booking_id,
         coalesce((x->>'passenger_order')::integer,ord::integer),
         coalesce(x->>'full_name',''),nullif(x->>'gender',''),nullif(x->>'nationality',''),coalesce(x->>'identity_number',''),
         nullif(x->>'phone',''),coalesce(nullif(x->>'status',''),'confirmed'),coalesce(nullif(x->>'accommodation_status',''),'active'),
         coalesce(nullif(x->>'preferred_language',''),'ar'),coalesce(x->'assistance_flags','[]'::jsonb),coalesce(nullif(x->>'document_status',''),'unknown')
  from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) with ordinality as e(x,ord);
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function public.replace_booking_passengers(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_booking_passengers(uuid,jsonb) to service_role;

-- All new persistence tables are backend-only. The Worker uses service_role server-side.
alter table public.operations_drivers enable row level security;
alter table public.app_runtime_state enable row level security;
alter table public.trip_runtime_extensions enable row level security;
alter table public.activity_events enable row level security;
alter table public.customer_portal_accounts enable row level security;
alter table public.customer_saved_travelers enable row level security;
revoke all on public.operations_drivers from anon,authenticated;
revoke all on public.app_runtime_state from anon,authenticated;
revoke all on public.trip_runtime_extensions from anon,authenticated;
revoke all on public.activity_events from anon,authenticated;
revoke all on public.customer_portal_accounts from anon,authenticated;
revoke all on public.customer_saved_travelers from anon,authenticated;

notify pgrst,'reload schema';
commit;

-- Verification
select 'operations_drivers' object_name,to_regclass('public.operations_drivers') is not null ok
union all select 'app_runtime_state',to_regclass('public.app_runtime_state') is not null
union all select 'trip_runtime_extensions',to_regclass('public.trip_runtime_extensions') is not null
union all select 'activity_events',to_regclass('public.activity_events') is not null
union all select 'customer_portal_accounts',to_regclass('public.customer_portal_accounts') is not null
union all select 'customer_saved_travelers',to_regclass('public.customer_saved_travelers') is not null;
