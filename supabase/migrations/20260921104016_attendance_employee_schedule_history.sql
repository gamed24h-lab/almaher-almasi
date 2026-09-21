create table if not exists public.attendance_employee_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  attendance_employee_id uuid not null,
  branch_id uuid null,
  effective_from date not null,
  effective_to date null,
  shift_periods jsonb not null default '[]'::jsonb,
  weekly_off_days jsonb not null default '[]'::jsonb,
  source_type text not null default 'manual',
  reason text null,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique(attendance_employee_id,effective_from,data_environment)
);

create index if not exists attendance_employee_schedule_versions_employee_idx
  on public.attendance_employee_schedule_versions(attendance_employee_id,data_environment,effective_from,effective_to);
create index if not exists attendance_employee_schedule_versions_branch_idx
  on public.attendance_employee_schedule_versions(branch_id,data_environment,effective_from);

alter table public.attendance_employee_schedule_versions enable row level security;
revoke all on table public.attendance_employee_schedule_versions from anon, authenticated;
grant select, insert, update, delete on table public.attendance_employee_schedule_versions to service_role;

create or replace function public.attendance_set_employee_schedule_version(
  p_employee_id uuid,p_branch_id uuid,p_effective_from date,p_shift_periods jsonb,p_weekly_off_days jsonb,
  p_environment text,p_reason text,p_actor text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_row attendance_employee_schedule_versions%rowtype;
begin
  if p_effective_from is null then raise exception 'effective_from_required'; end if;
  if p_environment not in ('training','production') then raise exception 'invalid_environment'; end if;
  if jsonb_typeof(coalesce(p_shift_periods,'[]'::jsonb))<>'array' then raise exception 'invalid_shift_periods'; end if;
  if jsonb_typeof(coalesce(p_weekly_off_days,'[]'::jsonb))<>'array' then raise exception 'invalid_weekly_off_days'; end if;
  perform 1 from attendance_employees where id=p_employee_id for update;
  if not found then raise exception 'employee_not_found'; end if;

  insert into attendance_employee_schedule_versions(
    attendance_employee_id,branch_id,effective_from,effective_to,shift_periods,weekly_off_days,
    source_type,reason,data_environment,created_by,updated_by,created_at,updated_at
  ) values (
    p_employee_id,p_branch_id,p_effective_from,null,coalesce(p_shift_periods,'[]'::jsonb),
    coalesce(p_weekly_off_days,'[]'::jsonb),'manual',nullif(trim(coalesce(p_reason,'')),''),
    p_environment,p_actor,p_actor,now(),now()
  )
  on conflict(attendance_employee_id,effective_from,data_environment)
  do update set branch_id=excluded.branch_id,shift_periods=excluded.shift_periods,weekly_off_days=excluded.weekly_off_days,
    source_type='manual',reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_row;

  with ordered as (
    select id,lead(effective_from) over(partition by attendance_employee_id,data_environment order by effective_from) as next_from
    from attendance_employee_schedule_versions
    where attendance_employee_id=p_employee_id and data_environment=p_environment
  )
  update attendance_employee_schedule_versions v
  set effective_to=case when o.next_from is null then null else o.next_from-1 end,
      updated_at=case when v.id=v_row.id then v.updated_at else now() end
  from ordered o
  where v.id=o.id
    and v.effective_to is distinct from (case when o.next_from is null then null else o.next_from-1 end);

  select * into v_row from attendance_employee_schedule_versions where id=v_row.id;
  return jsonb_build_object('ok',true,'version_id',v_row.id,'employee_id',v_row.attendance_employee_id,'effective_from',v_row.effective_from,'effective_to',v_row.effective_to);
end;
$$;

revoke all on function public.attendance_set_employee_schedule_version(uuid,uuid,date,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.attendance_set_employee_schedule_version(uuid,uuid,date,jsonb,jsonb,text,text,text) to service_role;

with audit_ranked as (
  select a.entity_id::uuid as employee_id,coalesce(a.branch_id,e.branch_id) as branch_id,
    (a.created_at at time zone 'Asia/Riyadh')::date as effective_from,
    case when jsonb_typeof(a.after_data->'shift_periods')='array' then a.after_data->'shift_periods' else '[]'::jsonb end as shift_periods,
    case when jsonb_typeof(a.after_data->'weekly_off_days')='array' then a.after_data->'weekly_off_days' else coalesce(e.weekly_off_days,'[]'::jsonb) end as weekly_off_days,
    coalesce(nullif(a.after_data->>'data_environment',''),e.data_environment,'training') as data_environment,
    a.actor_id,a.reason,a.created_at,
    row_number() over(partition by a.entity_id,(a.created_at at time zone 'Asia/Riyadh')::date,
      coalesce(nullif(a.after_data->>'data_environment',''),e.data_environment,'training') order by a.created_at desc) as rn
  from audit_events a join attendance_employees e on e.id::text=a.entity_id
  where a.entity_type='attendance_employee'
    and a.action in ('attendance_employee_update','attendance_employee_create')
    and a.entity_id ~* '^[0-9a-f-]{36}$'
    and jsonb_typeof(a.after_data->'shift_periods')='array'
)
insert into attendance_employee_schedule_versions(
  attendance_employee_id,branch_id,effective_from,shift_periods,weekly_off_days,source_type,reason,
  data_environment,created_by,updated_by,created_at,updated_at
)
select employee_id,branch_id,effective_from,shift_periods,weekly_off_days,'audit_backfill',reason,data_environment,actor_id,actor_id,created_at,created_at
from audit_ranked where rn=1
on conflict(attendance_employee_id,effective_from,data_environment)
do update set branch_id=excluded.branch_id,shift_periods=excluded.shift_periods,weekly_off_days=excluded.weekly_off_days,
  source_type='audit_backfill',reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

with first_audit as (
  select distinct on (a.entity_id)
    a.entity_id::uuid as employee_id,coalesce(a.branch_id,e.branch_id) as branch_id,
    greatest((e.created_at at time zone 'Asia/Riyadh')::date,date '2000-01-01') as effective_from,
    a.before_data,coalesce(nullif(a.before_data->>'data_environment',''),e.data_environment,'training') as data_environment,
    a.actor_id,a.created_at
  from audit_events a join attendance_employees e on e.id::text=a.entity_id
  where a.entity_type='attendance_employee' and a.action='attendance_employee_update' and a.entity_id ~* '^[0-9a-f-]{36}$'
  order by a.entity_id,a.created_at asc
)
insert into attendance_employee_schedule_versions(
  attendance_employee_id,branch_id,effective_from,shift_periods,weekly_off_days,source_type,reason,
  data_environment,created_by,updated_by,created_at,updated_at
)
select employee_id,branch_id,effective_from,
  jsonb_build_array(jsonb_build_object(
    'sequence_no',1,'label','الفترة الأولى','start_time',left(before_data->>'shift_start',5),
    'end_time',left(before_data->>'shift_end',5),'grace_minutes',coalesce((before_data->>'grace_minutes')::int,10),
    'device_shift_template_id',null,'source_type','audit_legacy','weekdays','[0,1,2,3,4,5,6]'::jsonb
  )),
  case when jsonb_typeof(before_data->'weekly_off_days')='array' then before_data->'weekly_off_days' else '[]'::jsonb end,
  'audit_before','الجدول السابق لأول تعديل مسجل',data_environment,actor_id,actor_id,created_at,created_at
from first_audit
where nullif(before_data->>'shift_start','') is not null and nullif(before_data->>'shift_end','') is not null
on conflict(attendance_employee_id,effective_from,data_environment) do nothing;

with current_periods as (
  select e.id as employee_id,e.branch_id,
    greatest((e.created_at at time zone 'Asia/Riyadh')::date,date '2000-01-01') as effective_from,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'sequence_no',p.sequence_no,'label',p.label,'start_time',to_char(p.start_time,'HH24:MI'),
        'end_time',to_char(p.end_time,'HH24:MI'),'grace_minutes',p.grace_minutes,
        'device_shift_template_id',p.device_shift_template_id,'source_type',p.source_type,'weekdays',p.weekdays
      ) order by p.sequence_no) filter (where p.id is not null),
      case when e.shift_start is not null and e.shift_end is not null then
        jsonb_build_array(jsonb_build_object(
          'sequence_no',1,'label','الفترة الأولى','start_time',to_char(e.shift_start,'HH24:MI'),
          'end_time',to_char(e.shift_end,'HH24:MI'),'grace_minutes',e.grace_minutes,
          'device_shift_template_id',null,'source_type','legacy','weekdays','[0,1,2,3,4,5,6]'::jsonb
        ))
      else '[]'::jsonb end
    ) as shift_periods,
    coalesce(e.weekly_off_days,'[]'::jsonb) as weekly_off_days,e.data_environment,e.created_by,e.created_at
  from attendance_employees e
  left join attendance_employee_shift_periods p on p.attendance_employee_id=e.id and p.active=true
  group by e.id
)
insert into attendance_employee_schedule_versions(
  attendance_employee_id,branch_id,effective_from,shift_periods,weekly_off_days,source_type,reason,
  data_environment,created_by,updated_by,created_at,updated_at
)
select c.employee_id,c.branch_id,c.effective_from,c.shift_periods,c.weekly_off_days,'current_baseline',
  'تهيئة تاريخ الدوام من البيانات الحالية',c.data_environment,c.created_by,c.created_by,c.created_at,c.created_at
from current_periods c
where not exists(select 1 from attendance_employee_schedule_versions v where v.attendance_employee_id=c.employee_id and v.data_environment=c.data_environment)
on conflict(attendance_employee_id,effective_from,data_environment) do nothing;

with ordered as (
  select id,lead(effective_from) over(partition by attendance_employee_id,data_environment order by effective_from) as next_from
  from attendance_employee_schedule_versions
)
update attendance_employee_schedule_versions v
set effective_to=case when o.next_from is null then null else o.next_from-1 end
from ordered o where v.id=o.id;
