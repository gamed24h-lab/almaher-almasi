create schema if not exists private;

alter table public.agents add column if not exists ledger_started_at timestamptz;
update public.agents set ledger_started_at=now()
where ledger_started_at is null and coalesce(current_balance,0)=0;
alter table public.agents alter column ledger_started_at set default now();

create table if not exists public.agent_ledger_accounts(
  agent_id uuid not null references public.agents(id) on delete restrict,
  data_environment text not null default 'training',
  branch_id uuid references public.branches(id) on delete set null,
  opening_balance numeric(14,2) not null default 0,
  current_balance numeric(14,2) not null default 0,
  started_at timestamptz not null default now(),
  initialized_by_id text,
  initialized_by_name text,
  initialized_by_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(agent_id,data_environment),
  constraint agent_ledger_accounts_env_chk check(data_environment in ('training','production'))
);

create table if not exists public.agent_ledger_entries(
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  data_environment text not null,
  booking_id uuid references public.bookings(id) on delete set null,
  entry_type text not null,
  direction text not null,
  amount numeric(14,2) not null,
  balance_after numeric(14,2) not null,
  currency text not null default 'SAR',
  reference_no text not null,
  payment_method text,
  reason text,
  source_type text,
  source_id text,
  reversal_of_entry_id uuid references public.agent_ledger_entries(id) on delete restrict,
  idempotency_key text,
  actor_id text,
  actor_name text,
  actor_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agent_ledger_entries_env_chk check(data_environment in ('training','production')),
  constraint agent_ledger_entries_direction_chk check(direction in ('debit','credit')),
  constraint agent_ledger_entries_amount_chk check(amount>0),
  constraint agent_ledger_entries_type_chk check(entry_type in (
    'opening_balance','booking_charge','booking_adjustment','booking_reversal',
    'payment','commission','discount','refund','adjustment_debit','adjustment_credit','reversal'
  ))
);

create unique index if not exists agent_ledger_entries_reference_uq on public.agent_ledger_entries(reference_no);
create unique index if not exists agent_ledger_entries_idempotency_uq on public.agent_ledger_entries(idempotency_key) where idempotency_key is not null;
create unique index if not exists agent_ledger_entries_one_reversal_uq on public.agent_ledger_entries(reversal_of_entry_id) where reversal_of_entry_id is not null;
create index if not exists agent_ledger_entries_agent_env_date_idx on public.agent_ledger_entries(agent_id,data_environment,created_at desc);
create index if not exists agent_ledger_entries_booking_idx on public.agent_ledger_entries(booking_id) where booking_id is not null;
create index if not exists agent_ledger_entries_source_idx on public.agent_ledger_entries(source_type,source_id) where source_id is not null;
create index if not exists agent_ledger_accounts_branch_idx on public.agent_ledger_accounts(branch_id);
create index if not exists agent_ledger_entries_branch_idx on public.agent_ledger_entries(branch_id);

alter table public.agent_ledger_accounts enable row level security;
alter table public.agent_ledger_entries enable row level security;
revoke all on table public.agent_ledger_accounts from public,anon,authenticated;
revoke all on table public.agent_ledger_entries from public,anon,authenticated;
revoke insert,update,delete on table public.agent_ledger_accounts from service_role;
revoke insert,update,delete on table public.agent_ledger_entries from service_role;
grant select on table public.agent_ledger_accounts to service_role;
grant select on table public.agent_ledger_entries to service_role;

create or replace function private.agent_ledger_post_core(
  p_agent_id uuid,p_environment text,p_entry_type text,p_direction text,p_amount numeric,
  p_booking_id uuid default null,p_reference_no text default null,p_payment_method text default null,
  p_reason text default null,p_source_type text default null,p_source_id text default null,
  p_reversal_of_entry_id uuid default null,p_idempotency_key text default null,p_actor_id text default null,
  p_actor_name text default null,p_actor_role text default null,p_metadata jsonb default '{}'::jsonb
)
returns public.agent_ledger_entries
language plpgsql
security definer
set search_path=''
as $$
declare
  v_agent public.agents%rowtype;
  v_account public.agent_ledger_accounts%rowtype;
  v_entry public.agent_ledger_entries%rowtype;
  v_existing public.agent_ledger_entries%rowtype;
  v_new_balance numeric(14,2);
  v_reference text;
begin
  if p_environment not in ('training','production') then raise exception 'AGENT_LEDGER_ENV_INVALID'; end if;
  if p_direction not in ('debit','credit') then raise exception 'AGENT_LEDGER_DIRECTION_INVALID'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'AGENT_LEDGER_AMOUNT_INVALID'; end if;

  select * into v_agent from public.agents where id=p_agent_id for update;
  if v_agent.id is null then raise exception 'AGENT_LEDGER_AGENT_NOT_FOUND'; end if;
  if v_agent.ledger_started_at is null then raise exception 'AGENT_LEDGER_NOT_INITIALIZED'; end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.agent_ledger_entries where idempotency_key=p_idempotency_key limit 1;
    if v_existing.id is not null then return v_existing; end if;
  end if;

  insert into public.agent_ledger_accounts(
    agent_id,data_environment,branch_id,opening_balance,current_balance,started_at,
    initialized_by_id,initialized_by_name,initialized_by_role
  ) values (
    p_agent_id,p_environment,v_agent.branch_id,0,0,v_agent.ledger_started_at,
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,'')
  ) on conflict(agent_id,data_environment) do nothing;

  select * into v_account from public.agent_ledger_accounts
  where agent_id=p_agent_id and data_environment=p_environment for update;

  v_new_balance:=coalesce(v_account.current_balance,0)+case when p_direction='debit' then p_amount else -p_amount end;
  v_reference:=nullif(trim(coalesce(p_reference_no,'')),'');
  if v_reference is null then
    v_reference:=
      case p_entry_type
        when 'payment' then 'AGP-' when 'refund' then 'AGR-' when 'commission' then 'AGC-'
        when 'discount' then 'AGD-' when 'opening_balance' then 'AGO-' when 'booking_charge' then 'AGB-'
        when 'booking_reversal' then 'AGX-' when 'reversal' then 'AGV-' else 'AGA-'
      end || to_char(clock_timestamp(),'YYYYMMDD') || '-' ||
      upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  end if;

  insert into public.agent_ledger_entries(
    agent_id,branch_id,data_environment,booking_id,entry_type,direction,amount,balance_after,
    currency,reference_no,payment_method,reason,source_type,source_id,reversal_of_entry_id,
    idempotency_key,actor_id,actor_name,actor_role,metadata
  ) values (
    p_agent_id,v_agent.branch_id,p_environment,p_booking_id,p_entry_type,p_direction,round(p_amount,2),round(v_new_balance,2),
    'SAR',v_reference,nullif(trim(coalesce(p_payment_method,'')),''),
    nullif(trim(coalesce(p_reason,'')),''),nullif(trim(coalesce(p_source_type,'')),''),
    nullif(trim(coalesce(p_source_id,'')),''),p_reversal_of_entry_id,
    nullif(trim(coalesce(p_idempotency_key,'')),''),nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),
    coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_entry;

  update public.agent_ledger_accounts
  set current_balance=round(v_new_balance,2),updated_at=now()
  where agent_id=p_agent_id and data_environment=p_environment;

  insert into public.audit_events(
    actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason
  ) values (
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),
    'agent_ledger_entry_posted','agents',p_agent_id::text,v_agent.branch_id,null,to_jsonb(v_entry),
    nullif(trim(coalesce(p_reason,'')),'')
  );
  return v_entry;
end;
$$;
revoke execute on function private.agent_ledger_post_core(uuid,text,text,text,numeric,uuid,text,text,text,text,text,uuid,text,text,text,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.initialize_agent_ledger(
  p_agent_id uuid,p_environment text,p_opening_balance numeric,
  p_actor_id text,p_actor_name text,p_actor_role text,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_agent public.agents%rowtype;
  v_count bigint;
  v_account_exists boolean;
  v_entry public.agent_ledger_entries%rowtype;
  v_direction text;
  v_amount numeric;
begin
  if p_environment not in ('training','production') then raise exception 'AGENT_LEDGER_ENV_INVALID'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'AGENT_LEDGER_REASON_REQUIRED'; end if;

  select * into v_agent from public.agents where id=p_agent_id for update;
  if v_agent.id is null then raise exception 'AGENT_LEDGER_AGENT_NOT_FOUND'; end if;

  select count(*) into v_count from public.agent_ledger_entries
  where agent_id=p_agent_id and data_environment=p_environment;
  select exists(select 1 from public.agent_ledger_accounts where agent_id=p_agent_id and data_environment=p_environment)
  into v_account_exists;
  if v_count>0 or v_account_exists then raise exception 'AGENT_LEDGER_ALREADY_INITIALIZED'; end if;

  update public.agents set ledger_started_at=coalesce(ledger_started_at,now()),updated_at=now()
  where id=p_agent_id returning * into v_agent;

  insert into public.agent_ledger_accounts(
    agent_id,data_environment,branch_id,opening_balance,current_balance,started_at,
    initialized_by_id,initialized_by_name,initialized_by_role
  ) values (
    p_agent_id,p_environment,v_agent.branch_id,round(coalesce(p_opening_balance,0),2),0,v_agent.ledger_started_at,
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,'')
  );

  if coalesce(p_opening_balance,0)<>0 then
    v_direction:=case when p_opening_balance>0 then 'debit' else 'credit' end;
    v_amount:=abs(p_opening_balance);
    v_entry:=private.agent_ledger_post_core(
      p_agent_id,p_environment,'opening_balance',v_direction,v_amount,null,null,null,p_reason,
      'ledger_initialization',p_agent_id::text,null,'ledger-init:'||p_agent_id::text||':'||p_environment,
      p_actor_id,p_actor_name,p_actor_role,jsonb_build_object('legacy_current_balance',v_agent.current_balance)
    );
  end if;

  insert into public.audit_events(
    actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason
  ) values (
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),
    'agent_ledger_initialized','agents',p_agent_id::text,v_agent.branch_id,null,
    jsonb_build_object('data_environment',p_environment,'opening_balance',round(coalesce(p_opening_balance,0),2)),
    trim(p_reason)
  );

  return jsonb_build_object(
    'ok',true,'agent_id',p_agent_id,'data_environment',p_environment,
    'opening_balance',round(coalesce(p_opening_balance,0),2),
    'current_balance',round(coalesce(p_opening_balance,0),2),
    'entry',case when v_entry.id is null then null else to_jsonb(v_entry) end
  );
end;
$$;
revoke execute on function public.initialize_agent_ledger(uuid,text,numeric,text,text,text,text) from public,anon,authenticated;
grant execute on function public.initialize_agent_ledger(uuid,text,numeric,text,text,text,text) to service_role;

create or replace function public.post_agent_ledger_entry(
  p_agent_id uuid,p_environment text,p_entry_type text,p_amount numeric,p_booking_id uuid,
  p_payment_method text,p_reason text,p_actor_id text,p_actor_name text,p_actor_role text,
  p_idempotency_key text default null,p_metadata jsonb default '{}'::jsonb
)
returns public.agent_ledger_entries
language plpgsql
security definer
set search_path=''
as $$
declare
  v_direction text;
  v_booking public.bookings%rowtype;
  v_agent public.agents%rowtype;
begin
  if p_entry_type not in ('payment','commission','discount','refund','adjustment_debit','adjustment_credit') then
    raise exception 'AGENT_LEDGER_ENTRY_TYPE_INVALID';
  end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'AGENT_LEDGER_REASON_REQUIRED'; end if;

  select * into v_agent from public.agents where id=p_agent_id;
  if v_agent.id is null then raise exception 'AGENT_LEDGER_AGENT_NOT_FOUND'; end if;
  if coalesce(v_agent.status,'')<>'active' or v_agent.merged_into_id is not null then raise exception 'AGENT_LEDGER_AGENT_INACTIVE'; end if;

  if p_booking_id is not null then
    select * into v_booking from public.bookings where id=p_booking_id;
    if v_booking.id is null then raise exception 'AGENT_LEDGER_BOOKING_NOT_FOUND'; end if;
    if v_booking.agent_id is distinct from p_agent_id then raise exception 'AGENT_LEDGER_BOOKING_AGENT_MISMATCH'; end if;
    if coalesce(v_booking.data_environment,'training')<>p_environment then raise exception 'AGENT_LEDGER_BOOKING_ENV_MISMATCH'; end if;
  end if;

  v_direction:=case when p_entry_type in ('payment','commission','discount','refund','adjustment_credit') then 'credit' else 'debit' end;
  return private.agent_ledger_post_core(
    p_agent_id,p_environment,p_entry_type,v_direction,p_amount,p_booking_id,null,p_payment_method,p_reason,
    case when p_booking_id is null then 'agent_ledger' else 'booking' end,
    coalesce(p_booking_id::text,p_agent_id::text),null,p_idempotency_key,
    p_actor_id,p_actor_name,p_actor_role,coalesce(p_metadata,'{}'::jsonb)
  );
end;
$$;
revoke execute on function public.post_agent_ledger_entry(uuid,text,text,numeric,uuid,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.post_agent_ledger_entry(uuid,text,text,numeric,uuid,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.reverse_agent_ledger_entry(
  p_entry_id uuid,p_actor_id text,p_actor_name text,p_actor_role text,p_reason text
)
returns public.agent_ledger_entries
language plpgsql
security definer
set search_path=''
as $$
declare
  v_original public.agent_ledger_entries%rowtype;
  v_existing public.agent_ledger_entries%rowtype;
  v_direction text;
begin
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'AGENT_LEDGER_REASON_REQUIRED'; end if;
  select * into v_original from public.agent_ledger_entries where id=p_entry_id for update;
  if v_original.id is null then raise exception 'AGENT_LEDGER_ENTRY_NOT_FOUND'; end if;
  if v_original.entry_type in ('opening_balance','booking_charge','booking_adjustment','booking_reversal','reversal') then
    raise exception 'AGENT_LEDGER_SYSTEM_ENTRY_NOT_REVERSIBLE';
  end if;
  select * into v_existing from public.agent_ledger_entries where reversal_of_entry_id=p_entry_id limit 1;
  if v_existing.id is not null then raise exception 'AGENT_LEDGER_ALREADY_REVERSED'; end if;
  v_direction:=case when v_original.direction='debit' then 'credit' else 'debit' end;
  return private.agent_ledger_post_core(
    v_original.agent_id,v_original.data_environment,'reversal',v_direction,v_original.amount,
    v_original.booking_id,null,v_original.payment_method,p_reason,'ledger_reversal',v_original.id::text,
    v_original.id,'ledger-reversal:'||v_original.id::text,
    p_actor_id,p_actor_name,p_actor_role,
    jsonb_build_object('original_reference',v_original.reference_no,'original_type',v_original.entry_type)
  );
end;
$$;
revoke execute on function public.reverse_agent_ledger_entry(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reverse_agent_ledger_entry(uuid,text,text,text,text) to service_role;

create or replace function private.agent_booking_ledger_sync()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_old_agent public.agents%rowtype;
  v_new_agent public.agents%rowtype;
  v_old_env text;
  v_new_env text;
  v_old_net numeric;
  v_new_net numeric;
  v_target numeric;
  v_delta numeric;
  v_cancelled boolean;
  v_actor text;
begin
  v_new_env:=coalesce(new.data_environment,'training');
  v_actor:=coalesce(new.last_modified_by,new.created_by,'system');

  if tg_op='INSERT' then
    if new.agent_id is null then return new; end if;
    select * into v_new_agent from public.agents where id=new.agent_id;
    if v_new_agent.id is null or v_new_agent.ledger_started_at is null or new.created_at<v_new_agent.ledger_started_at then return new; end if;
    v_cancelled:=lower(coalesce(new.booking_status,new.status,''))='cancelled' or new.soft_deleted_at is not null;
    if not v_cancelled and coalesce(new.total_price,0)>0 then
      perform private.agent_ledger_post_core(
        new.agent_id,v_new_env,'booking_charge','debit',new.total_price,new.id,null,null,
        'تحميل قيمة الحجز على حساب الوكيل','booking',new.id::text,null,null,
        null,v_actor,'system',jsonb_build_object('booking_number',new.booking_number,'automatic',true)
      );
    end if;
    return new;
  end if;

  v_old_env:=coalesce(old.data_environment,'training');

  if old.agent_id is not null then
    select * into v_old_agent from public.agents where id=old.agent_id;
    if v_old_agent.id is not null and v_old_agent.ledger_started_at is not null and old.created_at>=v_old_agent.ledger_started_at then
      select coalesce(sum(case when direction='debit' then amount else -amount end),0) into v_old_net
      from public.agent_ledger_entries
      where agent_id=old.agent_id and data_environment=v_old_env and booking_id=old.id
        and entry_type in ('booking_charge','booking_adjustment','booking_reversal');

      if old.agent_id is distinct from new.agent_id or v_old_env is distinct from v_new_env then
        v_target:=0;
      else
        v_cancelled:=lower(coalesce(new.booking_status,new.status,''))='cancelled' or new.soft_deleted_at is not null;
        v_target:=case when v_cancelled then 0 else coalesce(new.total_price,0) end;
      end if;

      v_delta:=round(v_target-v_old_net,2);
      if v_delta>0 then
        perform private.agent_ledger_post_core(
          old.agent_id,v_old_env,'booking_adjustment','debit',v_delta,old.id,null,null,
          'تعديل تلقائي لقيمة الحجز على حساب الوكيل','booking',old.id::text,null,null,
          null,v_actor,'system',jsonb_build_object('booking_number',new.booking_number,'automatic',true)
        );
      elsif v_delta<0 then
        perform private.agent_ledger_post_core(
          old.agent_id,v_old_env,case when v_target=0 then 'booking_reversal' else 'booking_adjustment' end,
          'credit',abs(v_delta),old.id,null,null,
          case when v_target=0 then 'عكس قيمة الحجز من حساب الوكيل' else 'تخفيض تلقائي لقيمة الحجز على حساب الوكيل' end,
          'booking',old.id::text,null,null,null,v_actor,'system',
          jsonb_build_object('booking_number',new.booking_number,'automatic',true)
        );
      end if;
    end if;
  end if;

  if new.agent_id is not null and (old.agent_id is distinct from new.agent_id or v_old_env is distinct from v_new_env) then
    select * into v_new_agent from public.agents where id=new.agent_id;
    if v_new_agent.id is not null and v_new_agent.ledger_started_at is not null and new.created_at>=v_new_agent.ledger_started_at then
      v_cancelled:=lower(coalesce(new.booking_status,new.status,''))='cancelled' or new.soft_deleted_at is not null;
      if not v_cancelled and coalesce(new.total_price,0)>0 then
        select coalesce(sum(case when direction='debit' then amount else -amount end),0) into v_new_net
        from public.agent_ledger_entries
        where agent_id=new.agent_id and data_environment=v_new_env and booking_id=new.id
          and entry_type in ('booking_charge','booking_adjustment','booking_reversal');
        v_delta:=round(coalesce(new.total_price,0)-v_new_net,2);
        if v_delta>0 then
          perform private.agent_ledger_post_core(
            new.agent_id,v_new_env,'booking_charge','debit',v_delta,new.id,null,null,
            'تحميل الحجز على حساب الوكيل الجديد','booking',new.id::text,null,null,
            null,v_actor,'system',jsonb_build_object('booking_number',new.booking_number,'automatic',true)
          );
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.agent_booking_ledger_sync() from public,anon,authenticated,service_role;
drop trigger if exists agent_booking_ledger_sync_trg on public.bookings;
create trigger agent_booking_ledger_sync_trg
after insert or update of agent_id,total_price,status,booking_status,data_environment,soft_deleted_at
on public.bookings for each row execute function private.agent_booking_ledger_sync();

create or replace function private.agent_ledger_entries_immutable()
returns trigger language plpgsql set search_path=''
as $$ begin raise exception 'AGENT_LEDGER_ENTRIES_IMMUTABLE'; end; $$;
revoke execute on function private.agent_ledger_entries_immutable() from public,anon,authenticated,service_role;
drop trigger if exists agent_ledger_entries_immutable_trg on public.agent_ledger_entries;
create trigger agent_ledger_entries_immutable_trg
before update or delete on public.agent_ledger_entries
for each row execute function private.agent_ledger_entries_immutable();

create or replace function public.merge_agent_duplicates(
  p_canonical uuid,p_duplicate uuid,p_actor_id text,p_actor_name text,p_actor_role text,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.agents%rowtype; d public.agents%rowtype; c_after public.agents%rowtype; d_after public.agents%rowtype;
  v_match_type text; v_bookings integer:=0; v_allocations integer:=0; v_quotas integer:=0; v_active_conflicts integer:=0;
  c_name text;d_name text;c_phone text;d_phone text;c_email text;d_email text;c_cr text;d_cr text;c_tax text;d_tax text;
begin
  if p_canonical is null or p_duplicate is null or p_canonical=p_duplicate then raise exception 'MERGE_DISTINCT_AGENTS_REQUIRED'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'MERGE_REASON_REQUIRED'; end if;
  select * into c from public.agents where id=p_canonical for update;
  select * into d from public.agents where id=p_duplicate for update;
  if c.id is null or d.id is null then raise exception 'MERGE_AGENT_NOT_FOUND'; end if;
  if coalesce(c.status,'')<>'active' or coalesce(d.status,'')<>'active' then raise exception 'MERGE_INACTIVE_AGENT'; end if;
  if c.merged_into_id is not null or d.merged_into_id is not null then raise exception 'MERGE_AGENT_ALREADY_MERGED'; end if;
  if c.branch_id is distinct from d.branch_id then raise exception 'MERGE_AGENT_BRANCH_MISMATCH'; end if;

  c_name:=lower(regexp_replace(trim(coalesce(nullif(c.company_name,''),c.name,'')),'[[:space:]]+','','g'));
  d_name:=lower(regexp_replace(trim(coalesce(nullif(d.company_name,''),d.name,'')),'[[:space:]]+','','g'));
  c_phone:=regexp_replace(coalesce(nullif(c.phone,''),c.whatsapp,''),'[^0-9]','','g');
  d_phone:=regexp_replace(coalesce(nullif(d.phone,''),d.whatsapp,''),'[^0-9]','','g');
  c_email:=lower(trim(coalesce(c.email,''))); d_email:=lower(trim(coalesce(d.email,'')));
  c_cr:=lower(regexp_replace(coalesce(c.commercial_registration,''),'[[:space:]-]+','','g'));
  d_cr:=lower(regexp_replace(coalesce(d.commercial_registration,''),'[[:space:]-]+','','g'));
  c_tax:=regexp_replace(coalesce(c.tax_number,''),'[^0-9A-Za-z]','','g');
  d_tax:=regexp_replace(coalesce(d.tax_number,''),'[^0-9A-Za-z]','','g');

  if c_cr<>'' and d_cr<>'' and c_cr<>d_cr then raise exception 'MERGE_AGENT_CR_CONFLICT'; end if;
  if c_tax<>'' and d_tax<>'' and c_tax<>d_tax then raise exception 'MERGE_AGENT_TAX_CONFLICT'; end if;
  if c_cr<>'' and c_cr=d_cr then v_match_type:='commercial_registration';
  elsif c_tax<>'' and c_tax=d_tax then v_match_type:='tax_number';
  elsif c_name<>'' and c_name=d_name and c_phone<>'' and c_phone=d_phone then v_match_type:='name_phone';
  elsif c_name<>'' and c_name=d_name and c_email<>'' and c_email=d_email then v_match_type:='name_email';
  else raise exception 'MERGE_AGENT_STRONG_MATCH_REQUIRED'; end if;

  if abs(coalesce(d.current_balance,0))>0.000001 then raise exception 'MERGE_AGENT_DUPLICATE_BALANCE_NONZERO'; end if;
  if exists(select 1 from public.agent_ledger_accounts where agent_id=p_duplicate and abs(current_balance)>0.000001) then
    raise exception 'MERGE_AGENT_DUPLICATE_LEDGER_BALANCE_NONZERO';
  end if;

  select count(*) into v_active_conflicts
  from public.agent_allocations ca join public.agent_allocations da
    on ca.trip_id=da.trip_id
   and coalesce(ca.trip_bus_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(da.trip_bus_id,'00000000-0000-0000-0000-000000000000'::uuid)
   and ca.allocation_type=da.allocation_type and ca.status='active' and da.status='active'
  where ca.agent_id=p_canonical and da.agent_id=p_duplicate;
  if v_active_conflicts>0 then raise exception 'MERGE_AGENT_ACTIVE_ALLOCATION_CONFLICT'; end if;

  update public.agents set
    company_name=coalesce(nullif(c.company_name,''),nullif(d.company_name,'')),
    phone=coalesce(nullif(c.phone,''),nullif(d.phone,'')),
    whatsapp=coalesce(nullif(c.whatsapp,''),nullif(d.whatsapp,'')),
    email=coalesce(nullif(c.email,''),nullif(d.email,'')),
    commercial_registration=coalesce(nullif(c.commercial_registration,''),nullif(d.commercial_registration,'')),
    tax_number=coalesce(nullif(c.tax_number,''),nullif(d.tax_number,'')),
    notes=case when nullif(trim(coalesce(c.notes,'')),'') is not null then c.notes else d.notes end,
    metadata=coalesce(d.metadata,'{}'::jsonb)||coalesce(c.metadata,'{}'::jsonb),updated_at=now()
  where id=p_canonical;

  update public.bookings set agent_id=p_canonical where agent_id=p_duplicate; get diagnostics v_bookings=row_count;
  update public.agent_allocations set agent_id=p_canonical,updated_at=now() where agent_id=p_duplicate; get diagnostics v_allocations=row_count;
  update public.resource_quotas set agent_id=p_canonical,updated_at=now() where agent_id=p_duplicate; get diagnostics v_quotas=row_count;

  update public.agents set status='inactive',merged_into_id=p_canonical,merged_at=now(),merge_reason=trim(p_reason),updated_at=now()
  where id=p_duplicate;
  select * into c_after from public.agents where id=p_canonical;
  select * into d_after from public.agents where id=p_duplicate;

  insert into public.record_merge_history(
    entity_type,canonical_id,duplicate_id,branch_id,actor_id,actor_name,actor_role,reason,match_type,
    canonical_before,duplicate_before,canonical_after,duplicate_after,moved_references
  ) values (
    'agents',p_canonical::text,p_duplicate::text,c.branch_id,
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),trim(p_reason),v_match_type,
    to_jsonb(c),to_jsonb(d),to_jsonb(c_after),to_jsonb(d_after),
    jsonb_build_object('bookings',v_bookings,'agent_allocations',v_allocations,'resource_quotas',v_quotas,'ledger_entries_moved',0)
  );

  insert into public.audit_events(
    actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason
  ) values (
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),
    'agent_merged','agents',p_canonical::text,c.branch_id,
    jsonb_build_object('canonical',to_jsonb(c),'duplicate',to_jsonb(d)),
    jsonb_build_object('canonical',to_jsonb(c_after),'duplicate',to_jsonb(d_after),
      'moved_references',jsonb_build_object('bookings',v_bookings,'agent_allocations',v_allocations,'resource_quotas',v_quotas,'ledger_entries_moved',0)),
    trim(p_reason)
  );

  return jsonb_build_object(
    'ok',true,'agent_id',p_canonical,'agent_code',c_after.agent_code,
    'merged_agent_id',p_duplicate,'merged_agent_code',d_after.agent_code,'match_type',v_match_type,
    'moved_references',jsonb_build_object('bookings',v_bookings,'agent_allocations',v_allocations,'resource_quotas',v_quotas,'ledger_entries_moved',0)
  );
end;
$$;
revoke execute on function public.merge_agent_duplicates(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.merge_agent_duplicates(uuid,uuid,text,text,text,text) to service_role;
