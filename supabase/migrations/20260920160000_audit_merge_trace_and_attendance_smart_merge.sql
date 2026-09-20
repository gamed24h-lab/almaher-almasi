-- Timeline / Audit Center + Smart Duplicate Merge trace
-- Applied remotely as: audit_merge_trace_and_attendance_smart_merge

alter table public.booking_passengers
  add column if not exists merged_into_id uuid references public.booking_passengers(id) on delete restrict,
  add column if not exists merged_at timestamptz,
  add column if not exists merge_reason text;

create index if not exists booking_passengers_merged_into_idx
  on public.booking_passengers(merged_into_id) where merged_into_id is not null;

alter table public.attendance_employees
  add column if not exists merged_into_id uuid references public.attendance_employees(id) on delete restrict,
  add column if not exists merged_at timestamptz,
  add column if not exists merge_reason text;

create index if not exists attendance_employees_merged_into_idx
  on public.attendance_employees(merged_into_id) where merged_into_id is not null;

create table if not exists public.record_merge_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  canonical_id text not null,
  duplicate_id text not null,
  branch_id uuid references public.branches(id) on delete set null,
  actor_id text,
  actor_name text,
  actor_role text,
  reason text not null,
  match_type text,
  canonical_before jsonb,
  duplicate_before jsonb,
  canonical_after jsonb,
  duplicate_after jsonb,
  moved_references jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists record_merge_history_entity_idx
  on public.record_merge_history(entity_type, canonical_id, created_at desc);
create index if not exists record_merge_history_duplicate_idx
  on public.record_merge_history(entity_type, duplicate_id, created_at desc);
create index if not exists record_merge_history_branch_idx
  on public.record_merge_history(branch_id, created_at desc);

alter table public.record_merge_history enable row level security;
revoke all on table public.record_merge_history from public, anon, authenticated;
grant select, insert on table public.record_merge_history to service_role;

CREATE OR REPLACE FUNCTION public.merge_attendance_employee_duplicates(p_canonical uuid, p_duplicate uuid, p_actor_id text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text, p_actor_role text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.attendance_employees%rowtype;
  d public.attendance_employees%rowtype;
  ca public.attendance_employees%rowtype;
  da public.attendance_employees%rowtype;
  c_nid text; d_nid text; c_phone text; d_phone text; c_name text; d_name text;
  match_kind text := null;
  n integer;
  c_periods integer := 0;
  d_periods integer := 0;
  moved jsonb := '{}'::jsonb;
begin
  if p_canonical is null or p_duplicate is null or p_canonical = p_duplicate then
    raise exception 'MERGE_INVALID_PAIR';
  end if;
  if length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'MERGE_REASON_REQUIRED';
  end if;

  select * into c from public.attendance_employees where id=p_canonical for update;
  select * into d from public.attendance_employees where id=p_duplicate for update;
  if c.id is null or d.id is null then raise exception 'MERGE_EMPLOYEE_NOT_FOUND'; end if;
  if lower(coalesce(c.status,'')) <> 'active' or lower(coalesce(d.status,'')) <> 'active' then
    raise exception 'MERGE_INACTIVE_EMPLOYEE';
  end if;
  if c.branch_id is distinct from d.branch_id then raise exception 'MERGE_SAME_BRANCH_ONLY'; end if;
  if coalesce(c.data_environment,'') is distinct from coalesce(d.data_environment,'') then
    raise exception 'MERGE_ENVIRONMENT_MISMATCH';
  end if;
  if c.merged_into_id is not null or d.merged_into_id is not null then
    raise exception 'MERGE_ALREADY_MERGED';
  end if;

  c_nid := lower(regexp_replace(coalesce(c.national_id,''),'\s+','','g'));
  d_nid := lower(regexp_replace(coalesce(d.national_id,''),'\s+','','g'));
  c_phone := regexp_replace(coalesce(c.phone,''),'\D','','g');
  d_phone := regexp_replace(coalesce(d.phone,''),'\D','','g');
  c_name := lower(regexp_replace(coalesce(c.name,''),'\s+','','g'));
  d_name := lower(regexp_replace(coalesce(d.name,''),'\s+','','g'));

  if c.staff_user_id is not null and d.staff_user_id is not null and c.staff_user_id <> d.staff_user_id then
    raise exception 'MERGE_STAFF_ACCOUNT_CONFLICT';
  end if;
  if c_nid <> '' and d_nid <> '' and c_nid <> d_nid then
    raise exception 'MERGE_NATIONAL_ID_CONFLICT';
  end if;

  if c.staff_user_id is not null and d.staff_user_id is not null and c.staff_user_id = d.staff_user_id then
    match_kind := 'staff_user';
  elsif c_nid <> '' and d_nid <> '' and c_nid = d_nid then
    match_kind := 'national_id';
  elsif c_phone <> '' and d_phone <> '' and c_phone = d_phone and c_name <> '' and d_name <> '' and c_name = d_name then
    match_kind := 'phone_name';
  else
    raise exception 'MERGE_STRONG_MATCH_REQUIRED';
  end if;

  select count(*) into c_periods from public.attendance_employee_shift_periods where attendance_employee_id=c.id;
  select count(*) into d_periods from public.attendance_employee_shift_periods where attendance_employee_id=d.id;
  if c_periods > 0 and d_periods > 0 then raise exception 'MERGE_SHIFT_CONFLICT'; end if;

  if exists(
    select 1
    from public.attendance_violation_decisions x
    join public.attendance_violation_decisions y
      on y.work_date=x.work_date and y.data_environment=x.data_environment
    where x.attendance_employee_id=c.id and y.attendance_employee_id=d.id
  ) then raise exception 'MERGE_VIOLATION_CONFLICT'; end if;

  update public.attendance_employees set
    phone=coalesce(nullif(c.phone,''),d.phone),
    national_id=coalesce(nullif(c.national_id,''),d.national_id),
    department=coalesce(nullif(c.department,''),d.department),
    job_title=coalesce(nullif(c.job_title,''),d.job_title),
    staff_user_id=coalesce(c.staff_user_id,d.staff_user_id),
    shift_start=coalesce(c.shift_start,d.shift_start),
    shift_end=coalesce(c.shift_end,d.shift_end),
    grace_minutes=case when coalesce(c.grace_minutes,0)=0 and coalesce(d.grace_minutes,0)>0 then d.grace_minutes else c.grace_minutes end,
    weekly_off_days=case when c.weekly_off_days is null or c.weekly_off_days='[]'::jsonb then d.weekly_off_days else c.weekly_off_days end,
    notes=coalesce(nullif(c.notes,''),d.notes),
    updated_by=coalesce(nullif(p_actor_id,''),nullif(p_actor_name,''),c.updated_by),
    updated_at=now()
  where id=c.id;

  update public.attendance_employee_links set
    attendance_employee_id=c.id,
    staff_user_id=coalesce(c.staff_user_id,d.staff_user_id,staff_user_id),
    display_name=c.name,
    updated_by=coalesce(nullif(p_actor_id,''),nullif(p_actor_name,''),updated_by),
    updated_at=now()
  where attendance_employee_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('attendance_employee_links',n);

  update public.attendance_raw_logs set
    attendance_employee_id=c.id,
    staff_user_id=coalesce(c.staff_user_id,d.staff_user_id,staff_user_id),
    employee_name=c.name
  where attendance_employee_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('attendance_raw_logs',n);

  if c_periods = 0 and d_periods > 0 then
    update public.attendance_employee_shift_periods set
      attendance_employee_id=c.id,
      updated_by=coalesce(nullif(p_actor_id,''),nullif(p_actor_name,''),updated_by),
      updated_at=now()
    where attendance_employee_id=d.id;
    get diagnostics n = row_count;
  else
    n := 0;
  end if;
  moved := moved || jsonb_build_object('attendance_employee_shift_periods',n);

  update public.attendance_employee_calendar_rules set
    attendance_employee_id=c.id,
    updated_by=coalesce(nullif(p_actor_id,''),nullif(p_actor_name,''),updated_by),
    updated_at=now()
  where attendance_employee_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('attendance_employee_calendar_rules',n);

  update public.attendance_violation_decisions set
    attendance_employee_id=c.id,
    updated_by=coalesce(nullif(p_actor_id,''),nullif(p_actor_name,''),updated_by),
    updated_at=now()
  where attendance_employee_id=d.id;
  get diagnostics n = row_count; moved := moved || jsonb_build_object('attendance_violation_decisions',n);

  update public.attendance_employees set
    status='inactive',
    merged_into_id=c.id,
    merged_at=now(),
    merge_reason=trim(p_reason),
    updated_by=coalesce(nullif(p_actor_id,''),nullif(p_actor_name,''),updated_by),
    updated_at=now()
  where id=d.id;

  select * into ca from public.attendance_employees where id=c.id;
  select * into da from public.attendance_employees where id=d.id;

  insert into public.record_merge_history(
    entity_type,canonical_id,duplicate_id,branch_id,actor_id,actor_name,actor_role,reason,match_type,
    canonical_before,duplicate_before,canonical_after,duplicate_after,moved_references
  ) values (
    'attendance_employee',c.id::text,d.id::text,c.branch_id,p_actor_id,p_actor_name,p_actor_role,trim(p_reason),match_kind,
    to_jsonb(c),to_jsonb(d),to_jsonb(ca),to_jsonb(da),moved
  );

  insert into public.audit_events(
    actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason,created_at
  ) values (
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),
    'attendance_employee_merged','attendance_employee',c.id::text,c.branch_id,
    jsonb_build_object('canonical',to_jsonb(c),'duplicate',to_jsonb(d)),
    jsonb_build_object('canonical',to_jsonb(ca),'duplicate',to_jsonb(da),'moved_references',moved,'match_type',match_kind),
    trim(p_reason),now()
  );

  return jsonb_build_object(
    'ok',true,'canonical_id',c.id,'duplicate_id',d.id,'employee_code',c.employee_code,
    'match_type',match_kind,'moved_references',moved
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.merge_booking_passenger_duplicates(p_canonical uuid, p_duplicate uuid, p_actor_id text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text, p_actor_role text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.booking_passengers%rowtype;
  d public.booking_passengers%rowtype;
  ca public.booking_passengers%rowtype;
  da public.booking_passengers%rowtype;
  b public.bookings%rowtype;
  c_id text; d_id text; c_phone text; d_phone text; c_name text; d_name text;
  match_kind text := null;
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
  if c.merged_into_id is not null or d.merged_into_id is not null then raise exception 'MERGE_ALREADY_MERGED'; end if;

  c_id := lower(regexp_replace(coalesce(c.identity_number,''),'\s+','','g'));
  d_id := lower(regexp_replace(coalesce(d.identity_number,''),'\s+','','g'));
  c_phone := regexp_replace(coalesce(c.phone,''),'\D','','g');
  d_phone := regexp_replace(coalesce(d.phone,''),'\D','','g');
  c_name := lower(regexp_replace(coalesce(c.full_name,''),'\s+','','g'));
  d_name := lower(regexp_replace(coalesce(d.full_name,''),'\s+','','g'));
  if c_id<>'' and d_id<>'' and c_id=d_id then match_kind := 'identity';
  elsif c_phone<>'' and d_phone<>'' and c_phone=d_phone and c_name<>'' and d_name<>'' and c_name=d_name then match_kind := 'phone_name';
  else raise exception 'MERGE_STRONG_MATCH_REQUIRED';
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
    merged_into_id=c.id,
    merged_at=now(),
    merge_reason=trim(p_reason),
    ticket_qr_token=null,
    ticket_qr_issued_at=null,
    ticket_qr_version=coalesce(ticket_qr_version,0)+1
  where id=d.id;

  select * into ca from public.booking_passengers where id=c.id;
  select * into da from public.booking_passengers where id=d.id;

  insert into public.record_merge_history(
    entity_type,canonical_id,duplicate_id,branch_id,actor_id,actor_name,actor_role,reason,match_type,
    canonical_before,duplicate_before,canonical_after,duplicate_after,moved_references
  ) values (
    'booking_passenger',c.id::text,d.id::text,b.branch_id,p_actor_id,p_actor_name,p_actor_role,trim(p_reason),match_kind,
    to_jsonb(c),to_jsonb(d),to_jsonb(ca),to_jsonb(da),moved
  );

  insert into public.activity_events(actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,metadata,created_at)
  values(
    coalesce(p_actor_id,''),coalesce(p_actor_name,''),coalesce(p_actor_role,''),b.branch_id,
    'passenger_merged','booking_passengers',c.id::text,
    jsonb_build_object('canonical_id',c.id,'duplicate_id',d.id,'booking_id',c.booking_id,'booking_number',b.booking_number,'reason',trim(p_reason),'match_type',match_kind,'moved_references',moved,'changes',jsonb_build_array(jsonb_build_object('field','duplicate_record','before',d.id::text,'after',c.id::text))),
    now()
  );

  insert into public.audit_events(
    actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason,created_at
  ) values (
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),
    'passenger_merged','booking_passengers',c.id::text,b.branch_id,
    jsonb_build_object('canonical',to_jsonb(c),'duplicate',to_jsonb(d)),
    jsonb_build_object('canonical',to_jsonb(ca),'duplicate',to_jsonb(da),'moved_references',moved,'match_type',match_kind),
    trim(p_reason),now()
  );

  return jsonb_build_object('ok',true,'canonical_id',c.id,'duplicate_id',d.id,'booking_id',c.booking_id,'booking_number',b.booking_number,'match_type',match_kind,'moved_references',moved);
end;
$function$
;

revoke execute on function public.merge_attendance_employee_duplicates(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.merge_attendance_employee_duplicates(uuid,uuid,text,text,text,text) to service_role;
revoke execute on function public.merge_booking_passenger_duplicates(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.merge_booking_passenger_duplicates(uuid,uuid,text,text,text,text) to service_role;
