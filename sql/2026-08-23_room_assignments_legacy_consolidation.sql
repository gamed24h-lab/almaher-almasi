begin;

-- =========================================================
-- AL-MAHER — room_assignments legacy consolidation
-- Safe/idempotent migration for the current housing module.
-- Keeps passenger_id + hotel_room_id as the active path while
-- preserving legacy columns for backward inspection.
-- =========================================================

-- Old triggers still depend on trip_room_id/legacy housing tables.
drop trigger if exists validate_room_assignment_trigger
  on public.room_assignments;

drop trigger if exists room_assignment_refresh_status_trigger
  on public.room_assignments;

drop trigger if exists room_assignment_booking_status_trigger
  on public.room_assignments;

-- Current status values used by the new housing flow.
alter table public.room_assignments
  drop constraint if exists room_assignments_status_check;

alter table public.room_assignments
  alter column status set default 'assigned';

alter table public.room_assignments
  add constraint room_assignments_status_check
  check (status in ('assigned','released','cancelled','active'));

-- Derive booking_id from passenger_id so the UI does not need to
-- duplicate booking ownership when assigning a passenger to a room.
create or replace function public.almaher_room_assignment_fill_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
begin
  if new.passenger_id is null then
    raise exception 'Passenger is required for room assignment';
  end if;

  select bp.booking_id
    into v_booking_id
  from public.booking_passengers bp
  where bp.id = new.passenger_id
  limit 1;

  if v_booking_id is null then
    raise exception 'Passenger does not belong to a valid booking';
  end if;

  new.booking_id := v_booking_id;
  return new;
end;
$$;

drop trigger if exists almaher_room_assignment_fill_booking_bi
  on public.room_assignments;

create trigger almaher_room_assignment_fill_booking_bi
before insert or update of passenger_id
on public.room_assignments
for each row
execute function public.almaher_room_assignment_fill_booking();

-- Repair existing rows defensively where booking_id can be inferred.
update public.room_assignments ra
set booking_id = bp.booking_id
from public.booking_passengers bp
where bp.id = ra.passenger_id
  and ra.booking_id is distinct from bp.booking_id;

commit;
