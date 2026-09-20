create table if not exists public.agent_collection_assignments(
  agent_id uuid not null references public.agents(id) on delete restrict,
  data_environment text not null,
  branch_id uuid references public.branches(id) on delete set null,
  collector_user_id text references public.staff_users(id) on delete set null,
  manual_priority text not null default 'normal',
  next_followup_date date,
  note text,
  assigned_by_id text,
  assigned_by_name text,
  assigned_by_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(agent_id,data_environment),
  constraint agent_collection_assignments_env_chk check(data_environment in ('training','production')),
  constraint agent_collection_assignments_priority_chk check(manual_priority in ('normal','high','urgent'))
);

create index if not exists agent_collection_assignments_collector_idx
  on public.agent_collection_assignments(collector_user_id,data_environment,next_followup_date);
create index if not exists agent_collection_assignments_branch_idx
  on public.agent_collection_assignments(branch_id,data_environment);

alter table public.agent_collection_assignments enable row level security;
revoke all on table public.agent_collection_assignments from public,anon,authenticated;
revoke insert,update,delete on table public.agent_collection_assignments from service_role;
grant select on table public.agent_collection_assignments to service_role;

create or replace function public.update_agent_collection_assignment(
  p_agent_id uuid,
  p_environment text,
  p_collector_user_id text,
  p_manual_priority text,
  p_next_followup_date date,
  p_note text,
  p_actor_id text,
  p_actor_name text,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  a public.agents%rowtype;
  s public.staff_users%rowtype;
  before_row public.agent_collection_assignments%rowtype;
  after_row public.agent_collection_assignments%rowtype;
begin
  if p_environment not in ('training','production') then raise exception 'AGENT_COLLECTION_ENV_INVALID'; end if;
  if p_manual_priority not in ('normal','high','urgent') then raise exception 'AGENT_COLLECTION_PRIORITY_INVALID'; end if;

  select * into a from public.agents where id=p_agent_id;
  if a.id is null then raise exception 'AGENT_CREDIT_AGENT_NOT_FOUND'; end if;

  if nullif(trim(coalesce(p_collector_user_id,'')),'') is not null then
    select * into s from public.staff_users where id=p_collector_user_id;
    if s.id is null or lower(coalesce(s.status,'')) not in ('active','نشط') then raise exception 'AGENT_COLLECTION_COLLECTOR_INVALID'; end if;
  end if;

  select * into before_row
  from public.agent_collection_assignments
  where agent_id=p_agent_id and data_environment=p_environment;

  insert into public.agent_collection_assignments(
    agent_id,data_environment,branch_id,collector_user_id,manual_priority,next_followup_date,note,
    assigned_by_id,assigned_by_name,assigned_by_role
  ) values (
    p_agent_id,p_environment,a.branch_id,nullif(trim(coalesce(p_collector_user_id,'')),''),
    p_manual_priority,p_next_followup_date,nullif(trim(coalesce(p_note,'')),''),
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,'')
  )
  on conflict(agent_id,data_environment) do update set
    branch_id=excluded.branch_id,
    collector_user_id=excluded.collector_user_id,
    manual_priority=excluded.manual_priority,
    next_followup_date=excluded.next_followup_date,
    note=excluded.note,
    assigned_by_id=excluded.assigned_by_id,
    assigned_by_name=excluded.assigned_by_name,
    assigned_by_role=excluded.assigned_by_role,
    updated_at=now()
  returning * into after_row;

  insert into public.audit_events(
    actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason
  ) values (
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),
    'agent_collection_assignment_updated','agents',p_agent_id::text,a.branch_id,
    case when before_row.agent_id is null then null else to_jsonb(before_row) end,
    to_jsonb(after_row),
    coalesce(nullif(trim(coalesce(p_note,'')),''),'تحديث مسؤول وأولوية التحصيل')
  );

  return jsonb_build_object('ok',true,'assignment',to_jsonb(after_row));
end;
$$;
revoke execute on function public.update_agent_collection_assignment(uuid,text,text,text,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.update_agent_collection_assignment(uuid,text,text,text,date,text,text,text,text) to service_role;

create or replace function public.agent_collections_center_rows(
  p_environment text,
  p_branch_id uuid default null
)
returns setof jsonb
language sql
security definer
set search_path=''
as $$
  with base as (
    select
      a.id as agent_id,
      a.agent_code,
      a.name,
      a.company_name,
      a.phone,
      a.branch_id,
      b.name as branch_name,
      c.snap,
      ca.collector_user_id,
      su.name as collector_name,
      su.role as collector_role,
      ca.manual_priority,
      ca.next_followup_date,
      ca.note as assignment_note,
      ca.updated_at as assignment_updated_at,
      coalesce(ps.open_count,0)::int as open_promise_count,
      coalesce(ps.open_amount,0)::numeric as open_promise_amount,
      coalesce(ps.overdue_count,0)::int as overdue_promise_count,
      coalesce(ps.overdue_amount,0)::numeric as overdue_promise_amount,
      coalesce(ps.due_today_count,0)::int as due_today_count,
      coalesce(ps.broken_count,0)::int as broken_promise_count,
      coalesce(ps.broken_30d_count,0)::int as broken_30d_count,
      ps.next_due_date
    from public.agents a
    left join public.branches b on b.id=a.branch_id
    cross join lateral (select public.agent_credit_snapshot(a.id,p_environment) as snap) c
    left join public.agent_collection_assignments ca
      on ca.agent_id=a.id and ca.data_environment=p_environment
    left join public.staff_users su on su.id=ca.collector_user_id
    left join lateral (
      select
        count(*) filter(where p.status='open') as open_count,
        coalesce(sum(p.amount) filter(where p.status='open'),0) as open_amount,
        count(*) filter(where p.status='open' and p.due_date<(now() at time zone 'Asia/Riyadh')::date) as overdue_count,
        coalesce(sum(p.amount) filter(where p.status='open' and p.due_date<(now() at time zone 'Asia/Riyadh')::date),0) as overdue_amount,
        count(*) filter(where p.status='open' and p.due_date=(now() at time zone 'Asia/Riyadh')::date) as due_today_count,
        count(*) filter(where p.status='broken') as broken_count,
        count(*) filter(where p.status='broken' and p.closed_at>=now()-interval '30 days') as broken_30d_count,
        min(p.due_date) filter(where p.status='open') as next_due_date
      from public.agent_collection_promises p
      where p.agent_id=a.id and p.data_environment=p_environment
    ) ps on true
    where a.status='active'
      and a.merged_into_id is null
      and (p_branch_id is null or a.branch_id=p_branch_id)
  ), scored as (
    select *,
      (
        case when coalesce((snap->>'exceeded')::boolean,false) then 100 else 0 end +
        case when overdue_promise_count>0 then 50 else 0 end +
        case when broken_30d_count>0 then 35 else 0 end +
        case when coalesce((snap->'aging'->>'days_31_plus')::numeric,0)>0 then 30 else 0 end +
        case when coalesce((snap->'aging'->>'days_16_30')::numeric,0)>0 then 20 else 0 end +
        case when coalesce((snap->>'warning')::boolean,false) then 15 else 0 end +
        case when due_today_count>0 then 15 else 0 end +
        case when collector_user_id is null then 10 else 0 end +
        case coalesce(manual_priority,'normal') when 'urgent' then 25 when 'high' then 10 else 0 end
      )::int as priority_score
    from base
  )
  select jsonb_build_object(
    'agent',jsonb_build_object(
      'id',agent_id,'agent_code',agent_code,'name',name,'company_name',company_name,'phone',phone,
      'branch_id',branch_id,'branch_name',branch_name
    ),
    'credit',snap,
    'assignment',jsonb_build_object(
      'collector_user_id',collector_user_id,'collector_name',collector_name,'collector_role',collector_role,
      'manual_priority',coalesce(manual_priority,'normal'),'next_followup_date',next_followup_date,
      'note',assignment_note,'updated_at',assignment_updated_at
    ),
    'promises',jsonb_build_object(
      'open_count',open_promise_count,'open_amount',round(open_promise_amount,2),
      'overdue_count',overdue_promise_count,'overdue_amount',round(overdue_promise_amount,2),
      'due_today_count',due_today_count,'broken_count',broken_promise_count,
      'broken_30d_count',broken_30d_count,'next_due_date',next_due_date
    ),
    'priority',jsonb_build_object(
      'score',priority_score,
      'level',case when priority_score>=80 then 'urgent' when priority_score>=40 then 'high' else 'normal' end,
      'flags',jsonb_build_object(
        'credit_exceeded',coalesce((snap->>'exceeded')::boolean,false),
        'credit_warning',coalesce((snap->>'warning')::boolean,false),
        'overdue_promise',overdue_promise_count>0,
        'broken_recent',broken_30d_count>0,
        'aging_31_plus',coalesce((snap->'aging'->>'days_31_plus')::numeric,0)>0,
        'aging_16_30',coalesce((snap->'aging'->>'days_16_30')::numeric,0)>0,
        'due_today',due_today_count>0,
        'unassigned',collector_user_id is null
      )
    )
  )
  from scored
  order by priority_score desc, coalesce((snap->>'balance')::numeric,0) desc, agent_code;
$$;
revoke execute on function public.agent_collections_center_rows(text,uuid) from public,anon,authenticated;
grant execute on function public.agent_collections_center_rows(text,uuid) to service_role;
