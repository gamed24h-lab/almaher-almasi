
alter table public.attendance_employees
  add column if not exists active_schedule_version_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='attendance_employees_active_schedule_version_fk'
      and conrelid='public.attendance_employees'::regclass
  ) then
    alter table public.attendance_employees
      add constraint attendance_employees_active_schedule_version_fk
      foreign key (active_schedule_version_id)
      references public.attendance_employee_schedule_versions(id)
      on delete set null;
  end if;
end $$;

create index if not exists attendance_employees_active_schedule_version_idx
  on public.attendance_employees(active_schedule_version_id)
  where active_schedule_version_id is not null;

create or replace function public.attendance_apply_schedule_version_current(
  p_employee_id uuid,
  p_version_id uuid,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.attendance_employees%rowtype;
  v_version public.attendance_employee_schedule_versions%rowtype;
  v_first jsonb;
  v_saved_periods jsonb := '[]'::jsonb;
begin
  select * into v_employee
  from public.attendance_employees
  where id=p_employee_id
  for update;
  if not found then raise exception 'employee_not_found'; end if;

  if p_version_id is null then
    delete from public.attendance_employee_shift_periods
    where attendance_employee_id=v_employee.id;

    update public.attendance_employees
    set shift_start=null,
        shift_end=null,
        grace_minutes=10,
        weekly_off_days='[]'::jsonb,
        active_schedule_version_id=null,
        updated_by=nullif(btrim(coalesce(p_actor,'')),''),
        updated_at=now()
    where id=v_employee.id
    returning * into v_employee;

    return jsonb_build_object(
      'ok',true,
      'employee',to_jsonb(v_employee),
      'shift_periods','[]'::jsonb,
      'active_schedule_version_id',null
    );
  end if;

  select * into v_version
  from public.attendance_employee_schedule_versions
  where id=p_version_id
    and attendance_employee_id=v_employee.id
    and data_environment=v_employee.data_environment;
  if not found then raise exception 'schedule_version_not_found'; end if;

  delete from public.attendance_employee_shift_periods
  where attendance_employee_id=v_employee.id;

  insert into public.attendance_employee_shift_periods(
    attendance_employee_id,sequence_no,label,start_time,end_time,grace_minutes,
    device_shift_template_id,source_type,weekdays,active,
    created_by,updated_by,created_at,updated_at
  )
  select
    v_employee.id,
    coalesce(nullif(x.value->>'sequence_no','')::int,x.ord::int),
    coalesce(nullif(btrim(x.value->>'label'),''),'الفترة '||x.ord::text),
    (x.value->>'start_time')::time,
    (x.value->>'end_time')::time,
    greatest(0,least(240,coalesce(nullif(x.value->>'grace_minutes','')::int,10))),
    nullif(btrim(coalesce(x.value->>'device_shift_template_id','')),'')::uuid,
    case
      when nullif(btrim(coalesce(x.value->>'device_shift_template_id','')),'') is not null then 'device_template'
      else coalesce(nullif(btrim(x.value->>'source_type'),''),'custom')
    end,
    case when jsonb_typeof(x.value->'weekdays')='array'
      then x.value->'weekdays'
      else '[0,1,2,3,4,5,6]'::jsonb
    end,
    coalesce(nullif(x.value->>'active','')::boolean,true),
    nullif(btrim(coalesce(p_actor,'')),''),
    nullif(btrim(coalesce(p_actor,'')),''),
    now(),now()
  from jsonb_array_elements(coalesce(v_version.shift_periods,'[]'::jsonb))
       with ordinality x(value,ord);

  select x.value into v_first
  from jsonb_array_elements(coalesce(v_version.shift_periods,'[]'::jsonb))
       with ordinality x(value,ord)
  order by coalesce(nullif(x.value->>'sequence_no','')::int,x.ord::int)
  limit 1;

  update public.attendance_employees
  set shift_start=case when v_first is null then null else (v_first->>'start_time')::time end,
      shift_end=case when v_first is null then null else (v_first->>'end_time')::time end,
      grace_minutes=case when v_first is null then 10 else greatest(0,least(240,coalesce(nullif(v_first->>'grace_minutes','')::int,10))) end,
      weekly_off_days=coalesce(v_version.weekly_off_days,'[]'::jsonb),
      active_schedule_version_id=v_version.id,
      updated_by=nullif(btrim(coalesce(p_actor,'')),''),
      updated_at=now()
  where id=v_employee.id
  returning * into v_employee;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.sequence_no),'[]'::jsonb)
  into v_saved_periods
  from public.attendance_employee_shift_periods p
  where p.attendance_employee_id=v_employee.id and p.active=true;

  return jsonb_build_object(
    'ok',true,
    'employee',to_jsonb(v_employee),
    'shift_periods',v_saved_periods,
    'active_schedule_version_id',v_version.id,
    'effective_from',v_version.effective_from,
    'effective_to',v_version.effective_to
  );
end;
$$;

revoke all on function public.attendance_apply_schedule_version_current(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.attendance_apply_schedule_version_current(uuid,uuid,text)
  to service_role;

create or replace function public.attendance_activate_due_schedules(
  p_today date,
  p_environment text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_applied jsonb;
  v_activated jsonb := '[]'::jsonb;
begin
  if p_today is null then raise exception 'today_required'; end if;
  if p_environment not in ('training','production') then raise exception 'invalid_environment'; end if;

  for r in
    select e.id as employee_id,e.branch_id,v.id as version_id,v.effective_from,v.effective_to
    from public.attendance_employees e
    join lateral (
      select s.*
      from public.attendance_employee_schedule_versions s
      where s.attendance_employee_id=e.id
        and s.data_environment=e.data_environment
        and s.effective_from<=p_today
        and (s.effective_to is null or s.effective_to>=p_today)
      order by s.effective_from desc
      limit 1
    ) v on true
    where e.data_environment=p_environment
      and e.merged_into_id is null
      and e.active_schedule_version_id is distinct from v.id
    order by e.id
  loop
    v_applied := public.attendance_apply_schedule_version_current(r.employee_id,r.version_id,p_actor);
    v_activated := v_activated || jsonb_build_array(jsonb_build_object(
      'employee_id',r.employee_id,
      'branch_id',r.branch_id,
      'version_id',r.version_id,
      'effective_from',r.effective_from,
      'effective_to',r.effective_to
    ));
  end loop;

  return jsonb_build_object(
    'ok',true,
    'today',p_today,
    'environment',p_environment,
    'activated_count',jsonb_array_length(v_activated),
    'activated',v_activated
  );
end;
$$;

revoke all on function public.attendance_activate_due_schedules(date,text,text)
  from public,anon,authenticated;
grant execute on function public.attendance_activate_due_schedules(date,text,text)
  to service_role;

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
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_active_version_id uuid;
  v_apply jsonb := null;
  v_existing boolean := p_employee_id is not null;
  v_scheduled_for_future boolean := false;
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
    v_scheduled_for_future := p_effective_from>v_today;
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
        active_schedule_version_id,created_by,updated_by,created_at,updated_at
      ) values (
        v_name,v_branch_id,
        nullif(btrim(coalesce(v_employee_data->>'phone','')),''),
        nullif(btrim(coalesce(v_employee_data->>'national_id','')),''),
        nullif(btrim(coalesce(v_employee_data->>'department','')),''),
        nullif(btrim(coalesce(v_employee_data->>'job_title','')),''),
        nullif(btrim(coalesce(v_employee_data->>'staff_user_id','')),''),
        null,null,10,'[]'::jsonb,v_status,v_environment,
        nullif(btrim(coalesce(v_employee_data->>'notes','')),''),
        null,
        nullif(btrim(coalesce(p_actor,'')),''),
        nullif(btrim(coalesce(p_actor,'')),''),
        now(),now()
      ) returning * into v_employee;
    else
      insert into public.attendance_employees(
        employee_code,name,branch_id,phone,national_id,department,job_title,staff_user_id,
        shift_start,shift_end,grace_minutes,weekly_off_days,status,data_environment,notes,
        active_schedule_version_id,created_by,updated_by,created_at,updated_at
      ) values (
        v_employee_code,v_name,v_branch_id,
        nullif(btrim(coalesce(v_employee_data->>'phone','')),''),
        nullif(btrim(coalesce(v_employee_data->>'national_id','')),''),
        nullif(btrim(coalesce(v_employee_data->>'department','')),''),
        nullif(btrim(coalesce(v_employee_data->>'job_title','')),''),
        nullif(btrim(coalesce(v_employee_data->>'staff_user_id','')),''),
        null,null,10,'[]'::jsonb,v_status,v_environment,
        nullif(btrim(coalesce(v_employee_data->>'notes','')),''),
        null,
        nullif(btrim(coalesce(p_actor,'')),''),
        nullif(btrim(coalesce(p_actor,'')),''),
        now(),now()
      ) returning * into v_employee;
    end if;
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

    select s.id into v_active_version_id
    from public.attendance_employee_schedule_versions s
    where s.attendance_employee_id=v_employee.id
      and s.data_environment=v_environment
      and s.effective_from<=v_today
      and (s.effective_to is null or s.effective_to>=v_today)
    order by s.effective_from desc
    limit 1;

    if v_active_version_id is not null then
      v_apply := public.attendance_apply_schedule_version_current(v_employee.id,v_active_version_id,p_actor);
    elsif not v_existing then
      v_apply := public.attendance_apply_schedule_version_current(v_employee.id,null,p_actor);
    end if;
  end if;

  select * into v_employee
  from public.attendance_employees
  where id=v_employee.id;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.sequence_no),'[]'::jsonb)
  into v_saved_periods
  from public.attendance_employee_shift_periods p
  where p.attendance_employee_id=v_employee.id and p.active=true;

  return jsonb_build_object(
    'ok',true,
    'employee',to_jsonb(v_employee),
    'shift_periods',v_saved_periods,
    'schedule_version',v_schedule_version,
    'active_schedule_version_id',v_employee.active_schedule_version_id,
    'scheduled_for_future',v_scheduled_for_future,
    'activates_on',case when v_scheduled_for_future then p_effective_from else null end,
    'today',v_today
  );
end;
$$;

revoke all on function public.attendance_save_employee_atomic(uuid,jsonb,jsonb,boolean,boolean,date,text,text)
  from public,anon,authenticated;
grant execute on function public.attendance_save_employee_atomic(uuid,jsonb,jsonb,boolean,boolean,date,text,text)
  to service_role;
