create or replace function public.merge_booking_passenger_duplicates(
  p_canonical uuid,
  p_duplicate uuid,
  p_actor_id text default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.booking_passengers%rowtype;
  d public.booking_passengers%rowtype;
  b public.bookings%rowtype;
  c_id text; d_id text; c_phone text; d_phone text; c_name text; d_name text;
  n integer;
  moved jsonb := '{}'::jsonb;
begin
  if p_canonical is null or p_duplicate is null or p_canonical = p_duplicate then raise exception 'MERGE_INVALID_PAIR'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'MERGE_REASON_REQUIRED'; end if;

  select * into c from public.booking_passengers where id=p_canonical for update;
  select * into d from public.booking_passengers where id=p_duplicate for update;
  if c.id is null or d.id is null then raise exception 'MERGE_PASSENGER_NOT_FOUND'; end if;
  if c.booking_id is distinct from d.booking_id then raise exception 'MERGE_SAME_BOOKING_ONLY'; end if;
  if coalesce(c.data_environment,'') is distinct from coalesce(d.data_environment,'') then raise exception 'MERGE_ENVIRONMENT_MISMATCH'; end if;
  if lower(coalesce(c.status,'')) in ('merged','deleted') or lower(coalesce(d.status,'')) in ('merged','deleted') then raise exception 'MERGE_INACTIVE_PASSENGER'; end if;

  c_id := lower(regexp_replace(coalesce(c.identity_number,''),'\s+','','g'));
  d_id := lower(regexp_replace(coalesce(d.identity_number,''),'\s+','','g'));
  c_phone := regexp_replace(coalesce(c.phone,''),'\D','','g');
  d_phone := regexp_replace(coalesce(d.phone,''),'\D','','g');
  c_name := lower(regexp_replace(coalesce(c.full_name,''),'\s+','','g'));
  d_name := lower(regexp_replace(coalesce(d.full_name,''),'\s+','','g'));
  if not ((c_id<>'' and d_id<>'' and c_id=d_id) or (c_phone<>'' and d_phone<>'' and c_phone=d_phone and c_name<>'' and d_name<>'' and c_name=d_name)) then
    raise exception 'MERGE_STRONG_MATCH_REQUIRED';
  end if;

  select * into b from public.bookings where id=c.booking_id;
  if b.id is null then raise exception 'MERGE_BOOKING_NOT_FOUND'; end if;

  if exists(
    select 1 from public.seat_assignments x join public.seat_assignments y
      on y.trip_vehicle_id=x.trip_vehicle_id and coalesce(y.segment_type,'')=coalesce(x.segment_type,'')
    where x.passenger_id=c.id and y.passenger_id=d.id
      and lower(coalesce(x.status,'assigned')) not in ('released','cancelled','canceled')
      and lower(coalesce(y.status,'assigned')) not in ('released','cancelled','canceled')
  ) then raise exception 'MERGE_SEAT_CONFLICT'; end if;

  if exists(
    select 1 from public.trip_seat_assignments x join public.trip_seat_assignments y
      on y.trip_bus_id=x.trip_bus_id and coalesce(y.direction,'')=coalesce(x.direction,'')
    where x.booking_passenger_id=c.id and y.booking_passenger_id=d.id
      and lower(coalesce(x.assignment_status,'assigned')) not in ('released','cancelled','canceled')
      and lower(coalesce(y.assignment_status,'assigned')) not in ('released','cancelled','canceled')
  ) then raise exception 'MERGE_TRIP_SEAT_CONFLICT'; end if;

  if exists(select 1 from public.room_assignments where passenger_id=c.id and lower(coalesce(status,'assigned')) not in ('released','cancelled','canceled'))
     and exists(select 1 from public.room_assignments where passenger_id=d.id and lower(coalesce(status,'assigned')) not in ('released','cancelled','canceled'))
  then raise exception 'MERGE_ROOM_CONFLICT'; end if;

  if exists(select 1 from public.housing_assignments where booking_passenger_id=c.id and lower(coalesce(assignment_status,'assigned')) not in ('released','cancelled','canceled'))
     and exists(select 1 from public.housing_assignments where booking_passenger_id=d.id and lower(coalesce(assignment_status,'assigned')) not in ('released','cancelled','canceled'))
  then raise exception 'MERGE_HOUSING_CONFLICT'; end if;

  update public.booking_passengers set
    full_name=coalesce(nullif(c.full_name,''),d.full_name),
    gender=coalesce(nullif(c.gender,''),d.gender),
    nationality=coalesce(nullif(c.nationality,''),d.nationality),
    identity_number=coalesce(nullif(c.identity_number,''),d.identity_number),
    phone=coalesce(nullif(c.phone,''),d.phone),
    special_assistance=coalesce(nullif(c.special_assistance,''),d.special_assistance),
    group_id=coalesce(c.group_id,d.group_id),
    preferred_language=coalesce(nullif(c.preferred_language,''),d.preferred_language),
    passenger_type=coalesce(nullif(c.passenger_type,''),d.passenger_type),
    relation_to_primary=coalesce(nullif(c.relation_to_primary,''),d.relation_to_primary),
    special_requirements=case when c.special_requirements is null or c.special_requirements='{}'::jsonb then d.special_requirements else c.special_requirements end,
    assistance_flags=case when c.assistance_flags is null or c.assistance_flags='[]'::jsonb then d.assistance_flags else c.assistance_flags end,
    document_status=case when lower(coalesce(c.document_status,'')) in ('','unknown','pending') and nullif(d.document_status,'') is not null then d.document_status else c.document_status end,
    accommodation_status=case when lower(coalesce(c.accommodation_status,'')) in ('','pending') and nullif(d.accommodation_status,'') is not null then d.accommodation_status else c.accommodation_status end,
    seat_outbound=coalesce(nullif(c.seat_outbound,''),d.seat_outbound),
    seat_return=coalesce(nullif(c.seat_return,''),d.seat_return),
    outbound_boarding_status=coalesce(nullif(c.outbound_boarding_status,''),d.outbound_boarding_status),
    outbound_boarded_at=coalesce(c.outbound_boarded_at,d.outbound_boarded_at),
    outbound_boarded_by=coalesce(c.outbound_boarded_by,d.outbound_boarded_by),
    return_boarding_status=coalesce(nullif(c.return_boarding_status,''),d.return_boarding_status),
    return_boarded_at=coalesce(c.return_boarded_at,d.return_boarded_at),
    return_boarded_by=coalesce(c.return_boarded_by,d.return_boarded_by),
    outbound_arrival_status=coalesce(nullif(c.outbound_arrival_status,''),d.outbound_arrival_status),
    outbound_arrived_at=coalesce(c.outbound_arrived_at,d.outbound_arrived_at),
    outbound_arrived_by=coalesce(c.outbound_arrived_by,d.outbound_arrived_by),
    return_arrival_status=coalesce(nullif(c.return_arrival_status,''),d.return_arrival_status),
    return_arrived_at=coalesce(c.return_arrived_at,d.return_arrived_at),
    return_arrived_by=coalesce(c.return_arrived_by,d.return_arrived_by),
    boarding_outbound_at=coalesce(c.boarding_outbound_at,d.boarding_outbound_at),
    boarding_return_at=coalesce(c.boarding_return_at,d.boarding_return_at),
    arrival_outbound_at=coalesce(c.arrival_outbound_at,d.arrival_outbound_at),
    arrival_return_at=coalesce(c.arrival_return_at,d.arrival_return_at),
    last_scan_at=coalesce(c.last_scan_at,d.last_scan_at),
    last_scan_mode=coalesce(nullif(c.last_scan_mode,''),d.last_scan_mode),
    ticket_language=coalesce(nullif(c.ticket_language,''),d.ticket_language)
  where id=c.id;

  update public.housing_assignments set booking_passenger_id=c.id where booking_passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('housing_assignments',n);
  update public.ticket_scan_events set booking_passenger_id=c.id where booking_passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('ticket_scan_events',n);
  update public.notification_jobs set booking_passenger_id=c.id where booking_passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('notification_jobs',n);
  update public.trip_seat_assignments set booking_passenger_id=c.id where booking_passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('trip_seat_assignments',n);
  update public.ticket_print_log set booking_passenger_id=c.id where booking_passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('ticket_print_log',n);
  update public.room_assignments set passenger_id=c.id where passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('room_assignments',n);
  update public.seat_assignments set passenger_id=c.id where passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('seat_assignments',n);
  update public.print_events set passenger_id=c.id where passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('print_events',n);
  update public.passenger_documents set passenger_id=c.id where passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('passenger_documents',n);
  update public.passenger_meeting_points set passenger_id=c.id where passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('passenger_meeting_points',n);
  update public.passenger_qr_tokens set passenger_id=c.id where passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('passenger_qr_tokens',n);
  update public.lost_found set passenger_id=c.id where passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('lost_found',n);
  update public.refunds set passenger_id=c.id where passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('refunds',n);
  update public.scan_events set passenger_id=c.id where passenger_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('scan_events',n);

  update public.booking_passengers set
    status='merged',
    cancelled_at=now(),
    cancellation_reason='Merged into '||c.id::text||' — '||trim(p_reason),
    ticket_qr_token=null,
    ticket_qr_issued_at=null,
    ticket_qr_version=coalesce(ticket_qr_version,0)+1
  where id=d.id;

  insert into public.activity_events(actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,metadata,created_at)
  values(
    coalesce(p_actor_id,''),coalesce(p_actor_name,''),coalesce(p_actor_role,''),b.branch_id,
    'passenger_merged','booking_passengers',c.id::text,
    jsonb_build_object('canonical_id',c.id,'duplicate_id',d.id,'booking_id',c.booking_id,'booking_number',b.booking_number,'reason',trim(p_reason),'moved_references',moved,'changes',jsonb_build_array(jsonb_build_object('field','duplicate_record','before',d.id::text,'after',c.id::text))),
    now()
  );

  return jsonb_build_object('ok',true,'canonical_id',c.id,'duplicate_id',d.id,'booking_id',c.booking_id,'booking_number',b.booking_number,'moved_references',moved);
end;
$$;

revoke execute on function public.merge_booking_passenger_duplicates(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.merge_booking_passenger_duplicates(uuid,uuid,text,text,text,text) to service_role;
