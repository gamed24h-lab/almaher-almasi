begin;

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

  -- Only access fields that actually exist on the current trigger table.
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
    new.data_environment := v_existing_environment;
  elsif tg_op = 'UPDATE' and new.data_environment in ('training','production') then
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

-- Reconcile legacy bookings only when all classified passengers agree.
with passenger_env as (
  select
    booking_id,
    min(data_environment) filter (where data_environment is not null) as env_min,
    max(data_environment) filter (where data_environment is not null) as env_max
  from public.booking_passengers
  group by booking_id
), unambiguous as (
  select booking_id, env_min as env
  from passenger_env
  where env_min is not null and env_min = env_max
)
update public.bookings b
set data_environment = u.env
from unambiguous u
where b.id = u.booking_id
  and b.data_environment is null;

-- Passengers inherit an already-classified booking when still unclassified.
update public.booking_passengers p
set data_environment = b.data_environment
from public.bookings b
where p.booking_id = b.id
  and p.data_environment is null
  and b.data_environment in ('training','production');

commit;
