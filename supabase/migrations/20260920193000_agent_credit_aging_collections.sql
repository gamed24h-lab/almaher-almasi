alter table public.agents
  add column if not exists credit_control_mode text not null default 'warn',
  add column if not exists credit_warning_percent numeric(5,2) not null default 80,
  add column if not exists credit_terms_days integer not null default 30;

do $$ begin
  alter table public.agents add constraint agents_credit_control_mode_chk check(credit_control_mode in ('off','warn','block'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.agents add constraint agents_credit_warning_percent_chk check(credit_warning_percent>=0 and credit_warning_percent<=100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.agents add constraint agents_credit_terms_days_chk check(credit_terms_days>=0 and credit_terms_days<=365);
exception when duplicate_object then null; end $$;

alter table public.bookings
  add column if not exists agent_credit_warning boolean not null default false,
  add column if not exists agent_credit_snapshot jsonb not null default '{}'::jsonb;

create table if not exists public.agent_collection_promises(
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  data_environment text not null,
  amount numeric(14,2) not null,
  due_date date not null,
  status text not null default 'open',
  note text,
  related_payment_entry_id uuid references public.agent_ledger_entries(id) on delete restrict,
  created_by_id text,
  created_by_name text,
  created_by_role text,
  closed_by_id text,
  closed_by_name text,
  closed_by_role text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_collection_promises_env_chk check(data_environment in ('training','production')),
  constraint agent_collection_promises_amount_chk check(amount>0),
  constraint agent_collection_promises_status_chk check(status in ('open','kept','broken','cancelled'))
);

create table if not exists public.agent_collection_events(
  id uuid primary key default gen_random_uuid(),
  promise_id uuid not null references public.agent_collection_promises(id) on delete restrict,
  agent_id uuid not null references public.agents(id) on delete restrict,
  event_type text not null,
  note text,
  actor_id text,
  actor_name text,
  actor_role text,
  created_at timestamptz not null default now(),
  constraint agent_collection_events_type_chk check(event_type in ('created','followup','kept','broken','cancelled'))
);

create index if not exists agent_collection_promises_agent_env_due_idx on public.agent_collection_promises(agent_id,data_environment,status,due_date);
create index if not exists agent_collection_promises_branch_idx on public.agent_collection_promises(branch_id);
create index if not exists agent_collection_events_promise_date_idx on public.agent_collection_events(promise_id,created_at desc);
create index if not exists agent_collection_events_agent_date_idx on public.agent_collection_events(agent_id,created_at desc);

alter table public.agent_collection_promises enable row level security;
alter table public.agent_collection_events enable row level security;
revoke all on table public.agent_collection_promises from public,anon,authenticated;
revoke all on table public.agent_collection_events from public,anon,authenticated;
revoke insert,update,delete on table public.agent_collection_promises from service_role;
revoke insert,update,delete on table public.agent_collection_events from service_role;
grant select on table public.agent_collection_promises to service_role;
grant select on table public.agent_collection_events to service_role;

create or replace function public.agent_credit_snapshot(p_agent_id uuid,p_environment text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  a public.agents%rowtype;
  v_balance numeric:=0;
  v_effective_limit numeric:=0;
  v_available numeric:=0;
  v_util numeric:=0;
  v_total_credit numeric:=0;
  v_0_7 numeric:=0;
  v_8_15 numeric:=0;
  v_16_30 numeric:=0;
  v_31_plus numeric:=0;
  v_overdue numeric:=0;
  v_oldest_days integer:=0;
  v_open_promises numeric:=0;
  v_open_promise_count integer:=0;
begin
  if p_environment not in ('training','production') then raise exception 'AGENT_CREDIT_ENV_INVALID'; end if;
  select * into a from public.agents where id=p_agent_id;
  if a.id is null then raise exception 'AGENT_CREDIT_AGENT_NOT_FOUND'; end if;

  select coalesce(current_balance,0) into v_balance
  from public.agent_ledger_accounts
  where agent_id=p_agent_id and data_environment=p_environment;
  if not found then
    select coalesce(sum(case when direction='debit' then amount else -amount end),0) into v_balance
    from public.agent_ledger_entries where agent_id=p_agent_id and data_environment=p_environment;
  end if;

  v_effective_limit:=case when a.allow_credit then coalesce(a.credit_limit,0) else 0 end;
  v_available:=v_effective_limit-greatest(v_balance,0);
  v_util:=case when v_effective_limit>0 then round(greatest(v_balance,0)/v_effective_limit*100,2)
               when v_balance>0 then 100 else 0 end;

  select coalesce(sum(amount),0) into v_total_credit
  from public.agent_ledger_entries
  where agent_id=p_agent_id and data_environment=p_environment and direction='credit';

  with debit_rows as (
    select id,amount,created_at,
      coalesce(sum(amount) over(order by created_at,id rows between unbounded preceding and 1 preceding),0) prior_debit
    from public.agent_ledger_entries
    where agent_id=p_agent_id and data_environment=p_environment and direction='debit'
  ), remaining as (
    select created_at,
      greatest(amount-greatest(least(v_total_credit-prior_debit,amount),0),0) remaining_amount,
      greatest(0,((now() at time zone 'Asia/Riyadh')::date-(created_at at time zone 'Asia/Riyadh')::date))::int age_days
    from debit_rows
  )
  select
    coalesce(sum(remaining_amount) filter(where age_days between 0 and 7),0),
    coalesce(sum(remaining_amount) filter(where age_days between 8 and 15),0),
    coalesce(sum(remaining_amount) filter(where age_days between 16 and 30),0),
    coalesce(sum(remaining_amount) filter(where age_days>30),0),
    coalesce(sum(remaining_amount) filter(where age_days>coalesce(a.credit_terms_days,30)),0),
    coalesce(max(age_days) filter(where remaining_amount>0),0)
  into v_0_7,v_8_15,v_16_30,v_31_plus,v_overdue,v_oldest_days
  from remaining;

  select coalesce(sum(amount),0),count(*) into v_open_promises,v_open_promise_count
  from public.agent_collection_promises
  where agent_id=p_agent_id and data_environment=p_environment and status='open';

  return jsonb_build_object(
    'agent_id',p_agent_id,'data_environment',p_environment,
    'balance',round(v_balance,2),
    'policy',jsonb_build_object(
      'allow_credit',a.allow_credit,'credit_limit',a.credit_limit,'effective_limit',round(v_effective_limit,2),
      'mode',a.credit_control_mode,'warning_percent',a.credit_warning_percent,'terms_days',a.credit_terms_days
    ),
    'available_credit',round(v_available,2),
    'utilization_percent',v_util,
    'warning',case when a.credit_control_mode='off' then false
                   when v_effective_limit<=0 then v_balance>0
                   else v_util>=a.credit_warning_percent end,
    'exceeded',greatest(v_balance,0)>v_effective_limit,
    'aging',jsonb_build_object(
      'days_0_7',round(v_0_7,2),'days_8_15',round(v_8_15,2),'days_16_30',round(v_16_30,2),
      'days_31_plus',round(v_31_plus,2),'overdue',round(v_overdue,2),'oldest_unpaid_days',v_oldest_days
    ),
    'collections',jsonb_build_object('open_promises_amount',round(v_open_promises,2),'open_promises_count',v_open_promise_count)
  );
end;
$$;
revoke execute on function public.agent_credit_snapshot(uuid,text) from public,anon,authenticated;
grant execute on function public.agent_credit_snapshot(uuid,text) to service_role;

create or replace function public.update_agent_credit_policy(
  p_agent_id uuid,p_allow_credit boolean,p_credit_limit numeric,p_mode text,p_warning_percent numeric,p_terms_days integer,
  p_actor_id text,p_actor_name text,p_actor_role text,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare before_row public.agents%rowtype; after_row public.agents%rowtype;
begin
  if p_mode not in ('off','warn','block') then raise exception 'AGENT_CREDIT_MODE_INVALID'; end if;
  if coalesce(p_credit_limit,0)<0 then raise exception 'AGENT_CREDIT_LIMIT_INVALID'; end if;
  if coalesce(p_warning_percent,-1)<0 or p_warning_percent>100 then raise exception 'AGENT_CREDIT_WARNING_INVALID'; end if;
  if coalesce(p_terms_days,-1)<0 or p_terms_days>365 then raise exception 'AGENT_CREDIT_TERMS_INVALID'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'AGENT_CREDIT_REASON_REQUIRED'; end if;
  select * into before_row from public.agents where id=p_agent_id for update;
  if before_row.id is null then raise exception 'AGENT_CREDIT_AGENT_NOT_FOUND'; end if;

  update public.agents set
    allow_credit=coalesce(p_allow_credit,false),
    credit_limit=round(coalesce(p_credit_limit,0),2),
    credit_control_mode=p_mode,
    credit_warning_percent=round(p_warning_percent,2),
    credit_terms_days=p_terms_days,
    updated_at=now()
  where id=p_agent_id returning * into after_row;

  insert into public.audit_events(actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason)
  values(nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),'agent_credit_policy_updated','agents',p_agent_id::text,
    after_row.branch_id,to_jsonb(before_row),to_jsonb(after_row),trim(p_reason));

  return jsonb_build_object('ok',true,'agent',to_jsonb(after_row));
end;
$$;
revoke execute on function public.update_agent_credit_policy(uuid,boolean,numeric,text,numeric,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.update_agent_credit_policy(uuid,boolean,numeric,text,numeric,integer,text,text,text,text) to service_role;

create or replace function public.create_agent_collection_promise(
  p_agent_id uuid,p_environment text,p_amount numeric,p_due_date date,p_note text,
  p_actor_id text,p_actor_name text,p_actor_role text
)
returns public.agent_collection_promises
language plpgsql
security definer
set search_path=''
as $$
declare a public.agents%rowtype; p public.agent_collection_promises%rowtype;
begin
  if p_environment not in ('training','production') then raise exception 'AGENT_COLLECTION_ENV_INVALID'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'AGENT_COLLECTION_AMOUNT_INVALID'; end if;
  if p_due_date is null then raise exception 'AGENT_COLLECTION_DUE_DATE_REQUIRED'; end if;
  if length(trim(coalesce(p_note,'')))<3 then raise exception 'AGENT_COLLECTION_NOTE_REQUIRED'; end if;
  select * into a from public.agents where id=p_agent_id;
  if a.id is null then raise exception 'AGENT_CREDIT_AGENT_NOT_FOUND'; end if;

  insert into public.agent_collection_promises(
    agent_id,branch_id,data_environment,amount,due_date,status,note,created_by_id,created_by_name,created_by_role
  ) values (
    p_agent_id,a.branch_id,p_environment,round(p_amount,2),p_due_date,'open',trim(p_note),
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,'')
  ) returning * into p;

  insert into public.agent_collection_events(promise_id,agent_id,event_type,note,actor_id,actor_name,actor_role)
  values(p.id,p_agent_id,'created',trim(p_note),nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''));

  insert into public.audit_events(actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason)
  values(nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),'agent_collection_promise_created','agents',
    p_agent_id::text,a.branch_id,null,to_jsonb(p),trim(p_note));
  return p;
end;
$$;
revoke execute on function public.create_agent_collection_promise(uuid,text,numeric,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_agent_collection_promise(uuid,text,numeric,date,text,text,text,text) to service_role;

create or replace function public.manage_agent_collection_promise(
  p_promise_id uuid,p_action text,p_note text,p_payment_entry_id uuid,
  p_actor_id text,p_actor_name text,p_actor_role text
)
returns public.agent_collection_promises
language plpgsql
security definer
set search_path=''
as $$
declare p public.agent_collection_promises%rowtype; before_row public.agent_collection_promises%rowtype; pay public.agent_ledger_entries%rowtype; v_status text;
begin
  if p_action not in ('followup','kept','broken','cancelled') then raise exception 'AGENT_COLLECTION_ACTION_INVALID'; end if;
  if length(trim(coalesce(p_note,'')))<3 then raise exception 'AGENT_COLLECTION_NOTE_REQUIRED'; end if;
  select * into p from public.agent_collection_promises where id=p_promise_id for update;
  if p.id is null then raise exception 'AGENT_COLLECTION_PROMISE_NOT_FOUND'; end if;
  before_row:=p;
  if p.status<>'open' then raise exception 'AGENT_COLLECTION_PROMISE_CLOSED'; end if;

  if p_payment_entry_id is not null then
    select * into pay from public.agent_ledger_entries where id=p_payment_entry_id;
    if pay.id is null or pay.agent_id<>p.agent_id or pay.data_environment<>p.data_environment or pay.direction<>'credit' or pay.entry_type<>'payment' then
      raise exception 'AGENT_COLLECTION_PAYMENT_MISMATCH';
    end if;
  end if;

  if p_action='followup' then
    update public.agent_collection_promises set note=trim(p_note),updated_at=now() where id=p.id returning * into p;
  else
    v_status:=p_action;
    update public.agent_collection_promises set
      status=v_status,note=trim(p_note),related_payment_entry_id=coalesce(p_payment_entry_id,related_payment_entry_id),
      closed_by_id=nullif(p_actor_id,''),closed_by_name=nullif(p_actor_name,''),closed_by_role=nullif(p_actor_role,''),
      closed_at=now(),updated_at=now()
    where id=p.id returning * into p;
  end if;

  insert into public.agent_collection_events(promise_id,agent_id,event_type,note,actor_id,actor_name,actor_role)
  values(p.id,p.agent_id,p_action,trim(p_note),nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''));

  insert into public.audit_events(actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason)
  values(nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),'agent_collection_promise_'||p_action,'agents',
    p.agent_id::text,p.branch_id,to_jsonb(before_row),to_jsonb(p),trim(p_note));
  return p;
end;
$$;
revoke execute on function public.manage_agent_collection_promise(uuid,text,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.manage_agent_collection_promise(uuid,text,text,uuid,text,text,text) to service_role;

create or replace function private.agent_credit_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  a public.agents%rowtype;
  v_env text;
  v_balance numeric:=0;
  v_old_booking_net numeric:=0;
  v_target numeric:=0;
  v_projected numeric:=0;
  v_limit numeric:=0;
  v_util numeric:=0;
  v_warn boolean:=false;
  v_cancelled boolean:=false;
begin
  if new.agent_id is null then
    new.agent_credit_warning:=false;
    new.agent_credit_snapshot:='{}'::jsonb;
    return new;
  end if;

  select * into a from public.agents where id=new.agent_id;
  if a.id is null then return new; end if;
  v_env:=coalesce(new.data_environment,'training');

  if a.credit_control_mode='off' then
    new.agent_credit_warning:=false;
    new.agent_credit_snapshot:=jsonb_build_object('mode','off','checked_at',now(),'data_environment',v_env);
    return new;
  end if;

  if a.ledger_started_at is null then
    new.agent_credit_warning:=true;
    new.agent_credit_snapshot:=jsonb_build_object('mode',a.credit_control_mode,'ledger_setup_required',true,'checked_at',now(),'data_environment',v_env);
    if a.credit_control_mode='block' then
      raise exception 'تم إيقاف الحجز: يجب تهيئة كشف حساب الوكيل قبل استخدام وضع منع الائتمان.';
    end if;
    return new;
  end if;

  select coalesce(current_balance,0) into v_balance
  from public.agent_ledger_accounts where agent_id=new.agent_id and data_environment=v_env;
  if not found then v_balance:=0; end if;

  if tg_op='UPDATE' and old.agent_id=new.agent_id and coalesce(old.data_environment,'training')=v_env then
    select coalesce(sum(case when direction='debit' then amount else -amount end),0) into v_old_booking_net
    from public.agent_ledger_entries
    where agent_id=new.agent_id and data_environment=v_env and booking_id=old.id
      and entry_type in ('booking_charge','booking_adjustment','booking_reversal');
  end if;

  v_cancelled:=lower(coalesce(new.booking_status,new.status,''))='cancelled' or new.soft_deleted_at is not null;
  v_target:=case when v_cancelled then 0 else coalesce(new.total_price,0) end;
  v_projected:=round(v_balance-v_old_booking_net+v_target,2);
  v_limit:=case when a.allow_credit then coalesce(a.credit_limit,0) else 0 end;
  v_util:=case when v_limit>0 then round(greatest(v_projected,0)/v_limit*100,2)
               when v_projected>0 then 100 else 0 end;
  v_warn:=case when v_limit<=0 then v_projected>0 else v_util>=a.credit_warning_percent end;

  new.agent_credit_warning:=v_warn;
  new.agent_credit_snapshot:=jsonb_build_object(
    'checked_at',now(),'data_environment',v_env,'mode',a.credit_control_mode,'allow_credit',a.allow_credit,
    'credit_limit',a.credit_limit,'effective_limit',round(v_limit,2),'current_balance',round(v_balance,2),
    'previous_booking_exposure',round(v_old_booking_net,2),'target_booking_exposure',round(v_target,2),
    'projected_balance',round(v_projected,2),'projected_available_credit',round(v_limit-greatest(v_projected,0),2),
    'utilization_percent',v_util,'warning_percent',a.credit_warning_percent,'warning',v_warn
  );

  if a.credit_control_mode='block' and greatest(v_projected,0)>v_limit+0.004 then
    raise exception 'تم إيقاف الحجز: الرصيد المتوقع للوكيل % ريال يتجاوز حد الائتمان الفعلي % ريال.',round(v_projected,2),round(v_limit,2);
  end if;
  return new;
end;
$$;
revoke execute on function private.agent_credit_guard() from public,anon,authenticated,service_role;
drop trigger if exists zz_agent_credit_guard_trg on public.bookings;
create trigger zz_agent_credit_guard_trg
before insert or update of agent_id,total_price,status,booking_status,data_environment,soft_deleted_at
on public.bookings for each row execute function private.agent_credit_guard();
