begin;

alter table if exists public.drivers
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

alter table if exists public.drivers
  add column if not exists national_id text;

alter table if exists public.drivers
  add column if not exists license_no text;

alter table if exists public.drivers
  add column if not exists license_expiry date;

alter table if exists public.drivers
  add column if not exists status text not null default 'active';

alter table if exists public.drivers
  add column if not exists notes text;

create index if not exists drivers_branch_id_idx
  on public.drivers(branch_id);

notify pgrst, 'reload schema';

commit;
