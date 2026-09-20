alter table public.agents
  add column if not exists merged_into_id uuid references public.agents(id) on delete restrict,
  add column if not exists merged_at timestamptz,
  add column if not exists merge_reason text;

create index if not exists agents_merged_into_idx
  on public.agents(merged_into_id)
  where merged_into_id is not null;

create or replace function public.merge_agent_duplicates(
  p_canonical uuid,
  p_duplicate uuid,
  p_actor_id text,
  p_actor_name text,
  p_actor_role text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.agents%rowtype;
  d public.agents%rowtype;
  c_after public.agents%rowtype;
  d_after public.agents%rowtype;
  v_match_type text;
  v_bookings integer := 0;
  v_allocations integer := 0;
  v_quotas integer := 0;
  v_active_conflicts integer := 0;
  c_name text;
  d_name text;
  c_phone text;
  d_phone text;
  c_email text;
  d_email text;
  c_cr text;
  d_cr text;
  c_tax text;
  d_tax text;
begin
  if p_canonical is null or p_duplicate is null or p_canonical = p_duplicate then
    raise exception 'MERGE_DISTINCT_AGENTS_REQUIRED';
  end if;
  if length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'MERGE_REASON_REQUIRED';
  end if;

  select * into c from public.agents where id = p_canonical for update;
  select * into d from public.agents where id = p_duplicate for update;

  if c.id is null or d.id is null then raise exception 'MERGE_AGENT_NOT_FOUND'; end if;
  if coalesce(c.status,'') <> 'active' or coalesce(d.status,'') <> 'active' then raise exception 'MERGE_INACTIVE_AGENT'; end if;
  if c.merged_into_id is not null or d.merged_into_id is not null then raise exception 'MERGE_AGENT_ALREADY_MERGED'; end if;
  if c.branch_id is distinct from d.branch_id then raise exception 'MERGE_AGENT_BRANCH_MISMATCH'; end if;

  c_name := lower(regexp_replace(trim(coalesce(nullif(c.company_name,''),c.name,'')), '[[:space:]]+', '', 'g'));
  d_name := lower(regexp_replace(trim(coalesce(nullif(d.company_name,''),d.name,'')), '[[:space:]]+', '', 'g'));
  c_phone := regexp_replace(coalesce(nullif(c.phone,''),c.whatsapp,''), '[^0-9]', '', 'g');
  d_phone := regexp_replace(coalesce(nullif(d.phone,''),d.whatsapp,''), '[^0-9]', '', 'g');
  c_email := lower(trim(coalesce(c.email,'')));
  d_email := lower(trim(coalesce(d.email,'')));
  c_cr := lower(regexp_replace(coalesce(c.commercial_registration,''), '[[:space:]-]+', '', 'g'));
  d_cr := lower(regexp_replace(coalesce(d.commercial_registration,''), '[[:space:]-]+', '', 'g'));
  c_tax := regexp_replace(coalesce(c.tax_number,''), '[^0-9A-Za-z]', '', 'g');
  d_tax := regexp_replace(coalesce(d.tax_number,''), '[^0-9A-Za-z]', '', 'g');

  if c_cr <> '' and d_cr <> '' and c_cr <> d_cr then raise exception 'MERGE_AGENT_CR_CONFLICT'; end if;
  if c_tax <> '' and d_tax <> '' and c_tax <> d_tax then raise exception 'MERGE_AGENT_TAX_CONFLICT'; end if;

  if c_cr <> '' and c_cr = d_cr then v_match_type := 'commercial_registration';
  elsif c_tax <> '' and c_tax = d_tax then v_match_type := 'tax_number';
  elsif c_name <> '' and c_name = d_name and c_phone <> '' and c_phone = d_phone then v_match_type := 'name_phone';
  elsif c_name <> '' and c_name = d_name and c_email <> '' and c_email = d_email then v_match_type := 'name_email';
  else raise exception 'MERGE_AGENT_STRONG_MATCH_REQUIRED';
  end if;

  if abs(coalesce(d.current_balance,0)) > 0.000001 then raise exception 'MERGE_AGENT_DUPLICATE_BALANCE_NONZERO'; end if;

  select count(*) into v_active_conflicts
  from public.agent_allocations ca
  join public.agent_allocations da
    on ca.trip_id = da.trip_id
   and coalesce(ca.trip_bus_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(da.trip_bus_id,'00000000-0000-0000-0000-000000000000'::uuid)
   and ca.allocation_type = da.allocation_type
   and ca.status = 'active'
   and da.status = 'active'
  where ca.agent_id = p_canonical and da.agent_id = p_duplicate;

  if v_active_conflicts > 0 then raise exception 'MERGE_AGENT_ACTIVE_ALLOCATION_CONFLICT'; end if;

  update public.agents
  set company_name = coalesce(nullif(c.company_name,''), nullif(d.company_name,'')),
      phone = coalesce(nullif(c.phone,''), nullif(d.phone,'')),
      whatsapp = coalesce(nullif(c.whatsapp,''), nullif(d.whatsapp,'')),
      email = coalesce(nullif(c.email,''), nullif(d.email,'')),
      commercial_registration = coalesce(nullif(c.commercial_registration,''), nullif(d.commercial_registration,'')),
      tax_number = coalesce(nullif(c.tax_number,''), nullif(d.tax_number,'')),
      notes = case when nullif(trim(coalesce(c.notes,'')),'') is not null then c.notes else d.notes end,
      metadata = coalesce(d.metadata,'{}'::jsonb) || coalesce(c.metadata,'{}'::jsonb),
      updated_at = now()
  where id = p_canonical;

  update public.bookings set agent_id = p_canonical where agent_id = p_duplicate;
  get diagnostics v_bookings = row_count;
  update public.agent_allocations set agent_id = p_canonical, updated_at = now() where agent_id = p_duplicate;
  get diagnostics v_allocations = row_count;
  update public.resource_quotas set agent_id = p_canonical, updated_at = now() where agent_id = p_duplicate;
  get diagnostics v_quotas = row_count;

  update public.agents
  set status = 'inactive', merged_into_id = p_canonical, merged_at = now(), merge_reason = trim(p_reason), updated_at = now()
  where id = p_duplicate;

  select * into c_after from public.agents where id = p_canonical;
  select * into d_after from public.agents where id = p_duplicate;

  insert into public.record_merge_history(
    entity_type,canonical_id,duplicate_id,branch_id,actor_id,actor_name,actor_role,reason,match_type,
    canonical_before,duplicate_before,canonical_after,duplicate_after,moved_references
  ) values (
    'agents',p_canonical::text,p_duplicate::text,c.branch_id,
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),trim(p_reason),v_match_type,
    to_jsonb(c),to_jsonb(d),to_jsonb(c_after),to_jsonb(d_after),
    jsonb_build_object('bookings',v_bookings,'agent_allocations',v_allocations,'resource_quotas',v_quotas)
  );

  insert into public.audit_events(
    actor_id,actor_name,actor_role,action,entity_type,entity_id,branch_id,before_data,after_data,reason
  ) values (
    nullif(p_actor_id,''),nullif(p_actor_name,''),nullif(p_actor_role,''),
    'agent_merged','agents',p_canonical::text,c.branch_id,
    jsonb_build_object('canonical',to_jsonb(c),'duplicate',to_jsonb(d)),
    jsonb_build_object('canonical',to_jsonb(c_after),'duplicate',to_jsonb(d_after),
      'moved_references',jsonb_build_object('bookings',v_bookings,'agent_allocations',v_allocations,'resource_quotas',v_quotas)),
    trim(p_reason)
  );

  return jsonb_build_object(
    'ok',true,'agent_id',p_canonical,'agent_code',c_after.agent_code,
    'merged_agent_id',p_duplicate,'merged_agent_code',d_after.agent_code,'match_type',v_match_type,
    'moved_references',jsonb_build_object('bookings',v_bookings,'agent_allocations',v_allocations,'resource_quotas',v_quotas)
  );
end;
$$;

revoke execute on function public.merge_agent_duplicates(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.merge_agent_duplicates(uuid,uuid,text,text,text,text) to service_role;
