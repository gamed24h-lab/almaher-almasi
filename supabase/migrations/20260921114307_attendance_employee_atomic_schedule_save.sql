
create or replace function public.attendance_save_employee_atomic(
  p_employee_id uuid,
  p_employee jsonb,
  p_shift_periods jsonb,
  p_replace_shift_periods boolean,
  p_schedule_changed boolean,
  p_effective_from date,
  p_reason text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.attendance_employees%rowtype;
  v_employee_data jsonb := coalesce(p_employee,'{}'::jsonb);
  v_periods jsonb := coalesce(p_shift_periods,'[]'::jsonb);
  v_weekly_off jsonb;
  v_name text;
  v_branch_id uuid;
  v_environment text;
  v_status text;
  v_employee_code text;
  v_saved_periods jsonb := '[]'::jsonb;
  v_schedule_version jsonb := null;
  v_month date;
begin
  if jsonb_typeof(v_employee_data) <> 'object' then raise exception 'invalid_employee_payload'; end if;
  if jsonb_typeof(v_periods) <> 'array' then raise exception 'invalid_shift_periods'; end if;
  if jsonb_array_length(v_periods) > 12 then raise exception 'too_many_shift_periods'; end if;

  v_name := btrim(coalesce(v_employee_data->>'name',''));
  if v_name = '' then raise exception 'employee_name_required'; end if;

  begin
    v_branch_id := nullif(btrim(coalesce(v_employee_data->>'branch_id','')),'')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_branch_id';
  end;
  if v_branch_id is null then raise exception 'branch_required'; end if;

  v_environment := coalesce(nullif(btrim(v_employee_data->>'data_environment'),''),'training');
  if v_environment not in ('training','production') then raise exception 'invalid_environment'; end if;

  v_status := coalesce(nullif(btrim(v_employee_data->>'status'),''),'active');
  if v_status not in ('active','inactive') then raise exception 'invalid_employee_status'; end if;

  v_weekly_off := coalesce(v_employee_data->'weekly_off_days','[]'::jsonb);
  if jsonb_typeof(v_weekly_off) <> 'array' then raise exception 'invalid_weekly_off_days'; end if;

  if coalesce(p_replace_shift_periods,false) then
    if exists (
      select 1
      from jsonb_array_elements(v_periods) x(value)
      where coalesce(x.value->>'start_time','') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
         or coalesce(x.value->>'end_time','') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
    ) then
      raise exception 'invalid_shift_period_time';
    end if;
  end if;

  if coalesce(p_schedule_changed,false) then
    if p_effective_from is null then raise exception 'effective_from_required'; end if;
    v_month := date_trunc('month',p_effective_from::timestamp)::date;
    perform pg_advisory_xact_lock(
      hashtextextended('attendance_month:'||v_branch_id::text||':'||v_month::text||':'||v_environment,0)
    );
    if exists (
      select 1
      from public.attendance_month_closures c
      where c.branch_id=v_branch_id
        and c.period_month=v_month
        and c.data_environment=v_environment
        and c.status='closed'
    ) then
      raise exception 'attendance_month_closed';
    end if;
  end if;

  v_employee_code := nullif(btrim(coalesce(v_employee_data->>'employee_code','')),'');

  if p_employee_id is not null then
    select * into v_employee
    from public.attendance_employees
    where id=p_employee_id
    for update;
    if not found then raise exception 'employee_not_found'; end if;

    update public.attendance_employees
    set employee_code=coalesce(v_employee_code,employee_code),
        name=v_name,
        branch_id=v_branch_id,
        phone=nullif(btrim(coalesce(v_employee_data->>'phone','')),''),
        national_id=nullif(btrim(coalesce(v_employee_data->>'national_id','')),''),
        department=nullif(btrim(coalesce(v_employee_data->>'department','')),''),
        job_title=nullif(btrim(coalesce(v_employee_data->>'job_title','')),''),
        staff_user_id=nullif(btrim(coalesce(v_employee_data->>'staff_user_id','')),''),
        shift_start=nullif(btrim(coalesce(v_employee_data->>'shift_start','')),'')::time,
        shift_end=nullif(btrim(coalesce(v_employee_data->>'shift_end','')),'')::time,
        grace_minutes=greatest(0,least(240,coalesce(nullif(v_employee_data->>'grace_minutes','')::int,10))),
        weekly_off_days=v_weekly_off,
        status=v_status,
        data_environment=v_environment,
        notes=nullif(btrim(coalesce(v_employee_data->>'notes','')),''),
        updated_by=nullif(btrim(coalesce(p_actor,'')),''),
        updated_at=now()
    where id=p_employee_id
    returning * into v_employee;
  else
    if v_employee_code is null then
      insert into public.attendance_employees(
        name,branch_id,phone,national_id,department,job_title,staff_user_id,
        shift_start,shift_end,grace_minutes,weekly_off_days,status,data_environment,notes,
        created_by,updated_by,created_at,updated_at
      ) values (
        v_name,v_branch_id,
        nullif(btrim(coalesce(v_employee_data->>'phone','')),''),
        nullif(btrim(coalesce(v_employee_data->>'national_id','')),''),
        nullif(btrim(coalesce(v_employee_data->>'department','')),''),
        nullif(btrim(coalesce(v_employee_data->>'job_title','')),''),
        nullif(btrim(coalesce(v_employee_data->>'staff_user_id','')),''),
        nullif(btrim(coalesce(v_employee_data->>'shift_start','')),'')::time,
        nullif(btrim(coalesce(v_employee_data->>'shift_end','')),'')::time,
        greatest(0,least(240,coalesce(nullif(v_employee_data->>'grace_minutes','')::int,10))),
        v_weekly_off,v_status,v_environment,
        nullif(btrim(coalesce(v_employee_data->>'notes','')),''),
        nullif(btrim(coalesce(p_actor,'')),''),
        nullif(btrim(coalesce(p_actor,'')),''),
        now(),now()
      ) returning * into v_employee;
    else
      insert into public.attendance_employees(
        employee_code,name,branch_id,phone,national_id,department,job_title,staff_user_id,
        shift_start,shift_end,grace_minutes,weekly_off_days,status,data_environment,notes,
        created_by,updated_by,created_at,updated_at
      ) values (
        v_employee_code,v_name,v_branch_id,
        nullif(btrim(coalesce(v_employee_data->>'phone','')),''),
        nullif(btrim(coalesce(v_employee_data->>'national_id','')),''),
        nullif(btrim(coalesce(v_employee_data->>'department','')),''),
        nullif(btrim(coalesce(v_employee_data->>'job_title','')),''),
        nullif(btrim(coalesce(v_employee_data->>'staff_user_id','')),''),
        nullif(btrim(coalesce(v_employee_data->>'shift_start','')),'')::time,
        nullif(btrim(coalesce(v_employee_data->>'shift_end','')),'')::time,
        greatest(0,least(240,coalesce(nullif(v_employee_data->>'grace_minutes','')::int,10))),
        v_weekly_off,v_status,v_environment,
        nullif(btrim(coalesce(v_employee_data->>'notes','')),''),
        nullif(btrim(coalesce(p_actor,'')),''),
        nullif(btrim(coalesce(p_actor,'')),''),
        now(),now()
      ) returning * into v_employee;
    end if;
  end if;

  if coalesce(p_replace_shift_periods,false) then
    delete from public.attendance_employee_shift_periods
    where attendance_employee_id=v_employee.id;

    insert into public.attendance_employee_shift_periods(
      attendance_employee_id,sequence_no,label,start_time,end_time,grace_minutes,
      device_shift_template_id,source_type,weekdays,active,
      created_by,updated_by,created_at,updated_at
    )
    select
      v_employee.id,
      x.ord::int,
      coalesce(nullif(btrim(x.value->>'label'),''),'الفترة '||x.ord::text),
      (x.value->>'start_time')::time,
      (x.value->>'end_time')::time,
      greatest(0,least(240,coalesce(nullif(x.value->>'grace_minutes','')::int,10))),
      nullif(btrim(coalesce(x.value->>'device_shift_template_id','')),'')::uuid,
      case when nullif(btrim(coalesce(x.value->>'device_shift_template_id','')),'') is null then 'custom' else 'device_template' end,
      case when jsonb_typeof(x.value->'weekdays')='array'
        then x.value->'weekdays'
        else '[0,1,2,3,4,5,6]'::jsonb
      end,
      true,
      nullif(btrim(coalesce(p_actor,'')),''),
      nullif(btrim(coalesce(p_actor,'')),''),
      now(),now()
    from jsonb_array_elements(v_periods) with ordinality x(value,ord);
  end if;

  if coalesce(p_schedule_changed,false) then
    v_schedule_version := public.attendance_set_employee_schedule_version(
      v_employee.id,
      v_employee.branch_id,
      p_effective_from,
      v_periods,
      v_weekly_off,
      v_environment,
      p_reason,
      p_actor
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.sequence_no),'[]'::jsonb)
  into v_saved_periods
  from public.attendance_employee_shift_periods p
  where p.attendance_employee_id=v_employee.id and p.active=true;

  return jsonb_build_object(
    'ok',true,
    'employee',to_jsonb(v_employee),
    'shift_periods',v_saved_periods,
    'schedule_version',v_schedule_version
  );
end;
$$;

revoke all on function public.attendance_save_employee_atomic(uuid,jsonb,jsonb,boolean,boolean,date,text,text)
  from public,anon,authenticated;
grant execute on function public.attendance_save_employee_atomic(uuid,jsonb,jsonb,boolean,boolean,date,text,text)
  to service_role;

create or replace function public.attendance_set_month_closure_atomic(
  p_branch_id uuid,
  p_period_month date,
  p_environment text,
  p_action text,
  p_snapshot jsonb,
  p_totals jsonb,
  p_actor text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_month_closures%rowtype;
  v_version int;
begin
  if p_branch_id is null then raise exception 'branch_required'; end if;
  if p_period_month is null or p_period_month<>date_trunc('month',p_period_month::timestamp)::date then
    raise exception 'invalid_period_month';
  end if;
  if p_environment not in ('training','production') then raise exception 'invalid_environment'; end if;
  if p_action not in ('close','reopen') then raise exception 'invalid_closure_action'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('attendance_month:'||p_branch_id::text||':'||p_period_month::text||':'||p_environment,0)
  );

  select * into v_row
  from public.attendance_month_closures
  where branch_id=p_branch_id and period_month=p_period_month and data_environment=p_environment
  for update;

  if p_action='close' then
    if found and v_row.status='closed' then
      return jsonb_build_object('ok',true,'already_closed',true,'closure',to_jsonb(v_row));
    end if;
    v_version := greatest(1,coalesce(v_row.closure_version,0)+1);
    if found then
      update public.attendance_month_closures
      set status='closed',
          closure_version=v_version,
          snapshot=coalesce(p_snapshot,'{}'::jsonb),
          totals=coalesce(p_totals,'{}'::jsonb),
          closed_by=nullif(btrim(coalesce(p_actor,'')),''),
          closed_at=now(),
          reopened_by=null,
          reopened_at=null,
          reopen_reason=null,
          updated_at=now()
      where id=v_row.id
      returning * into v_row;
    else
      insert into public.attendance_month_closures(
        branch_id,period_month,data_environment,status,closure_version,snapshot,totals,
        closed_by,closed_at,created_at,updated_at
      ) values (
        p_branch_id,p_period_month,p_environment,'closed',1,
        coalesce(p_snapshot,'{}'::jsonb),coalesce(p_totals,'{}'::jsonb),
        nullif(btrim(coalesce(p_actor,'')),''),now(),now(),now()
      ) returning * into v_row;
    end if;
    return jsonb_build_object('ok',true,'already_closed',false,'closure',to_jsonb(v_row));
  end if;

  if not found or v_row.status<>'closed' then raise exception 'attendance_month_not_closed'; end if;
  update public.attendance_month_closures
  set status='open',
      reopened_by=nullif(btrim(coalesce(p_actor,'')),''),
      reopened_at=now(),
      reopen_reason=nullif(btrim(coalesce(p_reason,'')),''),
      updated_at=now()
  where id=v_row.id
  returning * into v_row;

  return jsonb_build_object('ok',true,'closure',to_jsonb(v_row));
end;
$$;

revoke all on function public.attendance_set_month_closure_atomic(uuid,date,text,text,jsonb,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.attendance_set_month_closure_atomic(uuid,date,text,text,jsonb,jsonb,text,text)
  to service_role;
