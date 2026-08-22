-- =============================================================
-- AL-MAHER V1.4 — TRAINING / PRODUCTION DATA ISOLATION FOUNDATION
-- Additive + idempotent. Existing operational rows are classified as training.
-- Do NOT delete production data here. Final go-live cleanup is a separate guarded action.
-- =============================================================

begin;

-- Staff account operating mode. Existing staff remain in training until promoted explicitly.
alter table if exists public.staff_users
  add column if not exists account_mode text not null default 'training';

alter table if exists public.staff_users
  drop constraint if exists staff_users_account_mode_check;
alter table if exists public.staff_users
  add constraint staff_users_account_mode_check
  check (account_mode in ('training','production'));

-- Core operational entities. Default is deliberately training while the system is being prepared.
alter table if exists public.trips add column if not exists data_environment text not null default 'training';
alter table if exists public.bookings add column if not exists data_environment text not null default 'training';
alter table if exists public.booking_passengers add column if not exists data_environment text not null default 'training';
alter table if exists public.transactions add column if not exists data_environment text not null default 'training';
alter table if exists public.expenses add column if not exists data_environment text not null default 'training';
alter table if exists public.refunds add column if not exists data_environment text not null default 'training';
alter table if exists public.cash_shifts add column if not exists data_environment text not null default 'training';
alter table if exists public.payment_intents add column if not exists data_environment text not null default 'training';
alter table if exists public.saved_reports add column if not exists data_environment text not null default 'training';
alter table if exists public.export_jobs add column if not exists data_environment text not null default 'training';
alter table if exists public.room_assignments add column if not exists data_environment text not null default 'training';
alter table if exists public.seat_assignments add column if not exists data_environment text not null default 'training';
alter table if exists public.scan_events add column if not exists data_environment text not null default 'training';
alter table if exists public.approval_requests add column if not exists data_environment text not null default 'training';

-- Defensive checks, added only to tables that exist.
do $$
declare
  t text;
begin
  foreach t in array array[
    'trips','bookings','booking_passengers','transactions','expenses','refunds',
    'cash_shifts','payment_intents','saved_reports','export_jobs','room_assignments',
    'seat_assignments','scan_events','approval_requests'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I drop constraint if exists %I', t, t||'_data_environment_check');
      execute format(
        'alter table public.%I add constraint %I check (data_environment in (''training'',''production''))',
        t, t||'_data_environment_check'
      );
      execute format('create index if not exists %I on public.%I(data_environment)', t||'_data_environment_idx', t);
    end if;
  end loop;
end $$;

-- Explicitly classify everything currently in the system as training data.
-- This is safe before go-live and matches the current project stage.
do $$
declare
  t text;
begin
  foreach t in array array[
    'trips','bookings','booking_passengers','transactions','expenses','refunds',
    'cash_shifts','payment_intents','saved_reports','export_jobs','room_assignments',
    'seat_assignments','scan_events','approval_requests'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('update public.%I set data_environment=''training'' where data_environment is null or data_environment<>''production''', t);
    end if;
  end loop;
end $$;

comment on column public.staff_users.account_mode is 'training = isolated training account; production = live operational account';

commit;
