begin;

-- =========================================================
-- AL-MAHER — atomic seat assignment / concurrency hardening
-- Safe/idempotent migration.
-- Goals:
--   1) one active occupant per seat/segment
--   2) one active assigned seat per passenger/segment
--   3) seat moves happen in a single transaction
-- =========================================================

-- Existing master migration already defines this protection; keep it explicit.
create unique index if not exists seat_assignments_unique_active
  on public.seat_assignments(trip_vehicle_id, segment_type, seat_no)
  where status in ('hold','assigned','blocked');

-- A passenger must not hold two active assigned seats on the same bus segment.
create unique index if not exists seat_assignments_unique_passenger_active
  on public.seat_assignments(trip_vehicle_id, segment_type, passenger_id)
  where status = 'assigned' and passenger_id is not null;

create or replace function public.almaher_assign_seat_atomic(
  p_trip_vehicle_id uuid,
  p_segment_type text,
  p_seat_no text,
  p_passenger_id uuid,
  p_booking_id uuid default null,
  p_assigned_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking_id uuid;
  v_new_id uuid;
begin
  if p_trip_vehicle_id is null then
    raise exception 'Trip vehicle is required';
  end if;
  if p_segment_type not in ('outbound','return') then
    raise exception 'Invalid seat segment';
  end if;
  if coalesce(trim(p_seat_no),'') = '' then
    raise exception 'Seat number is required';
  end if;
  if p_passenger_id is null then
    raise exception 'Passenger is required';
  end if;

  select bp.booking_id into v_booking_id
  from public.booking_passengers bp
  where bp.id = p_passenger_id;

  if v_booking_id is null then
    raise exception 'Passenger does not exist';
  end if;

  if p_booking_id is not null and p_booking_id <> v_booking_id then
    raise exception 'Passenger does not belong to this booking';
  end if;

  -- Serialize writers for the target seat and passenger inside this transaction.
  perform pg_advisory_xact_lock(hashtext(
    'almaher-seat:' || p_trip_vehicle_id::text || ':' || p_segment_type || ':' || trim(p_seat_no)
  ));
  perform pg_advisory_xact_lock(hashtext(
    'almaher-passenger-seat:' || p_trip_vehicle_id::text || ':' || p_segment_type || ':' || p_passenger_id::text
  ));

  -- Release previous assignment for this passenger on this segment.
  update public.seat_assignments
  set status = 'released', updated_at = now()
  where trip_vehicle_id = p_trip_vehicle_id
    and segment_type = p_segment_type
    and passenger_id = p_passenger_id
    and status = 'assigned';

  -- Release hold/blocked rows on the target seat only. Never silently replace
  -- another passenger's active assignment; that is a conflict and must be retried.
  if exists (
    select 1 from public.seat_assignments
    where trip_vehicle_id = p_trip_vehicle_id
      and segment_type = p_segment_type
      and seat_no = trim(p_seat_no)
      and status = 'assigned'
      and passenger_id is distinct from p_passenger_id
  ) then
    raise exception 'SEAT_ALREADY_ASSIGNED';
  end if;

  update public.seat_assignments
  set status = 'released', updated_at = now()
  where trip_vehicle_id = p_trip_vehicle_id
    and segment_type = p_segment_type
    and seat_no = trim(p_seat_no)
    and status in ('hold','blocked');

  insert into public.seat_assignments(
    trip_vehicle_id,
    passenger_id,
    booking_id,
    segment_type,
    seat_no,
    status,
    assigned_by,
    created_at,
    updated_at
  ) values (
    p_trip_vehicle_id,
    p_passenger_id,
    v_booking_id,
    p_segment_type,
    trim(p_seat_no),
    'assigned',
    p_assigned_by,
    now(),
    now()
  ) returning id into v_new_id;

  return jsonb_build_object(
    'ok', true,
    'assignment_id', v_new_id,
    'trip_vehicle_id', p_trip_vehicle_id,
    'segment_type', p_segment_type,
    'seat_no', trim(p_seat_no),
    'passenger_id', p_passenger_id,
    'booking_id', v_booking_id
  );
exception
  when unique_violation then
    raise exception 'SEAT_CONCURRENCY_CONFLICT';
end;
$$;

create or replace function public.almaher_set_seat_state_atomic(
  p_trip_vehicle_id uuid,
  p_segment_type text,
  p_seat_no text,
  p_status text,
  p_assigned_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_id uuid;
begin
  if p_trip_vehicle_id is null then raise exception 'Trip vehicle is required'; end if;
  if p_segment_type not in ('outbound','return') then raise exception 'Invalid seat segment'; end if;
  if coalesce(trim(p_seat_no),'') = '' then raise exception 'Seat number is required'; end if;
  if p_status not in ('hold','blocked','released') then raise exception 'Invalid seat state'; end if;

  perform pg_advisory_xact_lock(hashtext(
    'almaher-seat:' || p_trip_vehicle_id::text || ':' || p_segment_type || ':' || trim(p_seat_no)
  ));

  if p_status = 'released' then
    update public.seat_assignments
    set status='released', updated_at=now()
    where trip_vehicle_id=p_trip_vehicle_id
      and segment_type=p_segment_type
      and seat_no=trim(p_seat_no)
      and status in ('hold','assigned','blocked');

    return jsonb_build_object('ok',true,'status','released','seat_no',trim(p_seat_no));
  end if;

  if exists (
    select 1 from public.seat_assignments
    where trip_vehicle_id=p_trip_vehicle_id
      and segment_type=p_segment_type
      and seat_no=trim(p_seat_no)
      and status='assigned'
  ) then
    raise exception 'SEAT_ALREADY_ASSIGNED';
  end if;

  update public.seat_assignments
  set status='released', updated_at=now()
  where trip_vehicle_id=p_trip_vehicle_id
    and segment_type=p_segment_type
    and seat_no=trim(p_seat_no)
    and status in ('hold','blocked');

  insert into public.seat_assignments(
    trip_vehicle_id, passenger_id, booking_id, segment_type, seat_no,
    status, assigned_by, created_at, updated_at
  ) values (
    p_trip_vehicle_id, null, null, p_segment_type, trim(p_seat_no),
    p_status, p_assigned_by, now(), now()
  ) returning id into v_new_id;

  return jsonb_build_object('ok',true,'assignment_id',v_new_id,'status',p_status,'seat_no',trim(p_seat_no));
exception
  when unique_violation then
    raise exception 'SEAT_CONCURRENCY_CONFLICT';
end;
$$;

revoke all on function public.almaher_assign_seat_atomic(uuid,text,text,uuid,uuid,text) from public;
revoke all on function public.almaher_set_seat_state_atomic(uuid,text,text,text,text) from public;
grant execute on function public.almaher_assign_seat_atomic(uuid,text,text,uuid,uuid,text) to authenticated, service_role;
grant execute on function public.almaher_set_seat_state_atomic(uuid,text,text,text,text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
