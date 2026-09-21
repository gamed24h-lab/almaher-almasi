
with active_versions as (
  select e.id as employee_id,
         v.id as version_id,
         v.weekly_off_days,
         v.shift_periods
  from public.attendance_employees e
  join lateral (
    select s.*
    from public.attendance_employee_schedule_versions s
    where s.attendance_employee_id=e.id
      and s.data_environment=e.data_environment
      and s.effective_from <= (now() at time zone 'Asia/Riyadh')::date
      and (s.effective_to is null or s.effective_to >= (now() at time zone 'Asia/Riyadh')::date)
    order by s.effective_from desc
    limit 1
  ) v on true
  where e.merged_into_id is null
),
current_periods as (
  select p.attendance_employee_id,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'sequence_no',p.sequence_no,
               'label',p.label,
               'start_time',to_char(p.start_time,'HH24:MI'),
               'end_time',to_char(p.end_time,'HH24:MI'),
               'grace_minutes',p.grace_minutes,
               'device_shift_template_id',p.device_shift_template_id,
               'weekdays',p.weekdays
             )
             order by p.sequence_no
           ),
           '[]'::jsonb
         ) as periods
  from public.attendance_employee_shift_periods p
  where p.active=true
  group by p.attendance_employee_id
),
version_periods as (
  select a.employee_id,
         a.version_id,
         a.weekly_off_days,
         coalesce(
           (
             select jsonb_agg(
               jsonb_build_object(
                 'sequence_no',coalesce(nullif(x.value->>'sequence_no','')::int,x.ord::int),
                 'label',x.value->>'label',
                 'start_time',substring(x.value->>'start_time' from 1 for 5),
                 'end_time',substring(x.value->>'end_time' from 1 for 5),
                 'grace_minutes',coalesce(nullif(x.value->>'grace_minutes','')::int,10),
                 'device_shift_template_id',nullif(x.value->>'device_shift_template_id','')::uuid,
                 'weekdays',coalesce(x.value->'weekdays','[0,1,2,3,4,5,6]'::jsonb)
               )
               order by coalesce(nullif(x.value->>'sequence_no','')::int,x.ord::int)
             )
             from jsonb_array_elements(coalesce(a.shift_periods,'[]'::jsonb))
                  with ordinality x(value,ord)
           ),
           '[]'::jsonb
         ) as periods
  from active_versions a
),
matched as (
  select e.id as employee_id,v.version_id
  from public.attendance_employees e
  join version_periods v on v.employee_id=e.id
  left join current_periods c on c.attendance_employee_id=e.id
  where e.active_schedule_version_id is null
    and coalesce(c.periods,'[]'::jsonb)=v.periods
    and e.weekly_off_days=v.weekly_off_days
)
update public.attendance_employees e
set active_schedule_version_id=m.version_id
from matched m
where e.id=m.employee_id;
