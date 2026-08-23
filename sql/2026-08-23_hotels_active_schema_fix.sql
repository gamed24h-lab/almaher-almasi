begin;

-- Restore the column expected by the housing module and by the V9.4 master schema.
-- Additive/idempotent only: no existing hotel rows are deleted or rewritten.
alter table if exists public.hotels
  add column if not exists active boolean not null default true;

commit;
