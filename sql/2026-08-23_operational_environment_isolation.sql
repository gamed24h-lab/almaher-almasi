-- AL-MAHER — SAFE OPERATIONAL ENVIRONMENT ISOLATION
-- Purpose:
--   1) Add data_environment to operational tables when missing.
--   2) Preserve ALL existing legacy rows as NULL (unlabeled) so nothing is silently reclassified.
--   3) Default ONLY future inserts to 'training' until production activation is explicitly approved.
--   4) Restrict non-null values to training/production.
--   5) Add lightweight indexes for environment filtering.
--
-- IMPORTANT: This migration does NOT update, delete, or reclassify any existing business row.

begin;

do $$
declare
  t text;
  tables text[] := array[
    'trips',
    'trip_branches',
    'bookings',
    'booking_passengers',
    'transactions',
    'expenses',
    'refunds',
    'cash_shifts',
    'room_assignments',
    'seat_assignments',
    'scan_events',
    'approval_requests'
  ];
  constraint_name text;
  index_name text;
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'Skipping missing table: %', t;
      continue;
    end if;

    -- No DEFAULT here on ADD COLUMN: existing rows must remain NULL/unlabeled.
    execute format(
      'alter table public.%I add column if not exists data_environment text',
      t
    );

    -- Future inserts default to training while launch remains locked.
    execute format(
      'alter table public.%I alter column data_environment set default %L',
      t,
      'training'
    );

    constraint_name := t || '_data_environment_chk';
    if not exists (
      select 1
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      where n.nspname = 'public'
        and r.relname = t
        and c.conname = constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I check (data_environment is null or data_environment in (%L,%L)) not valid',
        t,
        constraint_name,
        'training',
        'production'
      );
      execute format(
        'alter table public.%I validate constraint %I',
        t,
        constraint_name
      );
    end if;

    index_name := t || '_data_environment_idx';
    execute format(
      'create index if not exists %I on public.%I (data_environment)',
      index_name,
      t
    );
  end loop;
end $$;

commit;

-- Verification (read only)
select
  c.table_name,
  max(case when c.column_name = 'data_environment' then 1 else 0 end)::int as has_data_environment
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'trips','trip_branches','bookings','booking_passengers','transactions','expenses',
    'refunds','cash_shifts','room_assignments','seat_assignments','scan_events','approval_requests'
  )
group by c.table_name
order by c.table_name;
