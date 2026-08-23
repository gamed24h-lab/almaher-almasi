begin;

create table if not exists public.system_runtime_state (
  id text primary key default 'main' check (id = 'main'),
  runtime_mode text not null default 'training' check (runtime_mode in ('training','production')),
  changed_at timestamptz not null default now(),
  changed_by text,
  details jsonb not null default '{}'::jsonb
);

insert into public.system_runtime_state (id,runtime_mode,changed_by,details)
values ('main','training','migration',jsonb_build_object('note','Initial safe runtime mode'))
on conflict (id) do nothing;

create or replace function public.almaher_apply_runtime_environment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_parent_environment text;
  v_existing_environment text;
begin
  select runtime_mode into v_mode
  from public.system_runtime_state
  where id='main';

  -- Only touch table-specific fields after confirming the table name.
  if tg_table_name = 'booking_passengers' then
    if new.booking_id is not null then
      select data_environment into v_parent_environment
      from public.bookings
      where id = new.booking_id;
    end if;
  elsif tg_table_name = 'room_assignments' then
    if new.passenger_id is not null then
      select b.data_environment into v_parent_environment
      from public.booking_passengers p
      join public.bookings b on b.id = p.booking_id
      where p.id = new.passenger_id;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    v_existing_environment := old.data_environment;
  end if;

  if v_parent_environment in ('training','production') then
    new.data_environment := v_parent_environment;
  elsif v_existing_environment in ('training','production') then
    -- Never flip an already-classified row just because runtime mode changed.
    new.data_environment := v_existing_environment;
  elsif tg_op = 'UPDATE' and new.data_environment in ('training','production') then
    -- Allows deliberate one-time reconciliation of legacy NULL rows.
    new.data_environment := new.data_environment;
  else
    new.data_environment := coalesce(v_mode,'training');
  end if;

  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'trips','trip_branches','bookings','booking_passengers','transactions','expenses',
    'refunds','cash_shifts','room_assignments','seat_assignments','scan_events','approval_requests'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists almaher_runtime_environment_bi on public.%I',t);
      execute format(
        'create trigger almaher_runtime_environment_bi before insert or update on public.%I for each row execute function public.almaher_apply_runtime_environment()',
        t
      );
    end if;
  end loop;
end $$;

alter table public.system_runtime_state enable row level security;

commit;
