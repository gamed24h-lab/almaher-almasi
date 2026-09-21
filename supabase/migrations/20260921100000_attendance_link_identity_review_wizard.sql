create table if not exists public.attendance_link_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  device_pin text not null,
  branch_id uuid null,
  previous_employee_id uuid null,
  new_employee_id uuid null,
  resolution text not null check (resolution in ('confirm_current','relink','snooze')),
  reason text not null,
  device_name_snapshot text null,
  device_user_name_snapshot text null,
  current_employee_name_snapshot text null,
  new_employee_name_snapshot text null,
  review_until timestamptz null,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  reviewed_by text null,
  reviewed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists attendance_link_identity_reviews_pin_idx
  on public.attendance_link_identity_reviews(device_id,device_pin,reviewed_at desc);

create index if not exists attendance_link_identity_reviews_branch_idx
  on public.attendance_link_identity_reviews(branch_id,data_environment,reviewed_at desc);

alter table public.attendance_link_identity_reviews enable row level security;
revoke all on table public.attendance_link_identity_reviews from anon, authenticated;
grant select, insert, update, delete on table public.attendance_link_identity_reviews to service_role;

create or replace function public.attendance_resolve_link_identity_review(
  p_device_id uuid,
  p_device_pin text,
  p_resolution text,
  p_reason text,
  p_device_name_snapshot text,
  p_device_user_name_snapshot text,
  p_current_employee_id uuid,
  p_current_employee_name_snapshot text,
  p_new_employee_id uuid default null,
  p_new_employee_name_snapshot text default null,
  p_new_staff_user_id text default null,
  p_new_branch_id uuid default null,
  p_actor text default null,
  p_environment text default 'training',
  p_review_until timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_link attendance_employee_links%rowtype;
  v_now timestamptz := now();
  v_inventory_count integer := 0;
  v_state_count integer := 0;
begin
  if p_resolution not in ('confirm_current','relink','snooze') then raise exception 'invalid_resolution'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'reason_required'; end if;

  select * into v_link from attendance_employee_links
  where device_id=p_device_id and device_pin=p_device_pin and active=true
  for update;
  if not found then raise exception 'link_not_found'; end if;
  if v_link.attendance_employee_id is distinct from p_current_employee_id then raise exception 'link_changed'; end if;

  if p_resolution='relink' then
    if p_new_employee_id is null or p_new_employee_id=p_current_employee_id then raise exception 'new_employee_required'; end if;
    if exists (
      select 1 from attendance_biometric_inventory
      where device_id=p_device_id and device_pin=p_device_pin and data_environment=p_environment and status='active'
        and attendance_employee_id is not null and attendance_employee_id not in (p_current_employee_id,p_new_employee_id)
    ) then raise exception 'biometric_inventory_conflict'; end if;

    select count(*) into v_inventory_count from attendance_biometric_inventory
    where device_id=p_device_id and device_pin=p_device_pin and data_environment=p_environment and status='active';

    insert into attendance_biometric_profiles (
      attendance_employee_id,branch_id,source_device_id,device_pin,biometric_type,biometric_key,finger_code,slot_no,status,version,
      last_enrolled_at,last_sync_at,last_result_code,data_environment,metadata,created_by,updated_by,created_at,updated_at
    )
    select p_new_employee_id,coalesce(p_new_branch_id,v_link.branch_id),i.device_id,i.device_pin,
      i.biometric_type,i.biometric_key,i.finger_code,i.slot_no,'active',1,
      null,coalesce(i.last_seen_at,v_now),coalesce(i.last_result_code,0),i.data_environment,
      jsonb_build_object('source','identity_review_relink','inventory_id',i.id,'previous_employee_id',p_current_employee_id,'reviewed_at',v_now,'raw_template_stored',false),
      p_actor,p_actor,v_now,v_now
    from attendance_biometric_inventory i
    where i.device_id=p_device_id and i.device_pin=p_device_pin and i.data_environment=p_environment and i.status='active'
    on conflict (attendance_employee_id,biometric_key,data_environment) do update set
      branch_id=excluded.branch_id,source_device_id=excluded.source_device_id,device_pin=excluded.device_pin,
      biometric_type=excluded.biometric_type,finger_code=excluded.finger_code,slot_no=excluded.slot_no,status='active',
      last_sync_at=excluded.last_sync_at,last_result_code=excluded.last_result_code,
      metadata=coalesce(attendance_biometric_profiles.metadata,'{}'::jsonb)||excluded.metadata,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at;

    insert into attendance_biometric_device_states (
      device_id,attendance_employee_id,branch_id,device_pin,biometric_type,biometric_key,finger_code,slot_no,status,
      last_seen_at,last_result_code,data_environment,metadata,created_at,updated_at
    )
    select i.device_id,p_new_employee_id,coalesce(p_new_branch_id,v_link.branch_id),i.device_pin,
      i.biometric_type,i.biometric_key,i.finger_code,i.slot_no,'active',
      coalesce(i.last_seen_at,v_now),coalesce(i.last_result_code,0),i.data_environment,
      jsonb_build_object('source','identity_review_relink','inventory_id',i.id,'previous_employee_id',p_current_employee_id,'raw_template_stored',false),
      v_now,v_now
    from attendance_biometric_inventory i
    where i.device_id=p_device_id and i.device_pin=p_device_pin and i.data_environment=p_environment and i.status='active'
    on conflict (device_id,attendance_employee_id,biometric_key,data_environment) do update set
      branch_id=excluded.branch_id,device_pin=excluded.device_pin,biometric_type=excluded.biometric_type,
      finger_code=excluded.finger_code,slot_no=excluded.slot_no,status='active',last_seen_at=excluded.last_seen_at,
      last_result_code=excluded.last_result_code,
      metadata=coalesce(attendance_biometric_device_states.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=excluded.updated_at;

    get diagnostics v_state_count = row_count;

    update attendance_biometric_inventory
    set attendance_employee_id=p_new_employee_id,branch_id=coalesce(p_new_branch_id,v_link.branch_id),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('identity_review_relinked_at',v_now,'previous_employee_id',p_current_employee_id,'new_employee_id',p_new_employee_id),
        updated_at=v_now
    where device_id=p_device_id and device_pin=p_device_pin and data_environment=p_environment and status='active';

    update attendance_biometric_device_states
    set status='disabled',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('disabled_reason','identity_review_relink','reassigned_to_employee_id',p_new_employee_id,'reassigned_at',v_now),
        updated_at=v_now
    where device_id=p_device_id and device_pin=p_device_pin and attendance_employee_id=p_current_employee_id
      and data_environment=p_environment and status='active';

    update attendance_biometric_profiles p
    set status=case when exists(
          select 1 from attendance_biometric_device_states s
          where s.attendance_employee_id=p.attendance_employee_id and s.biometric_key=p.biometric_key
            and s.data_environment=p.data_environment and s.status='active'
        ) then 'active' else 'disabled' end,
        metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('identity_review_relinked_from_device',p_device_id,'identity_review_relinked_at',v_now,'reassigned_to_employee_id',p_new_employee_id),
        updated_by=p_actor,updated_at=v_now
    where p.attendance_employee_id=p_current_employee_id and p.data_environment=p_environment
      and p.biometric_key in (
        select biometric_key from attendance_biometric_inventory
        where device_id=p_device_id and device_pin=p_device_pin and data_environment=p_environment and status='active'
      );

    update attendance_employee_links
    set attendance_employee_id=p_new_employee_id,staff_user_id=p_new_staff_user_id,
        branch_id=coalesce(p_new_branch_id,v_link.branch_id),display_name=p_new_employee_name_snapshot,
        updated_by=p_actor,updated_at=v_now
    where id=v_link.id;

    update attendance_raw_logs
    set attendance_employee_id=p_new_employee_id,staff_user_id=p_new_staff_user_id,
        branch_id=coalesce(p_new_branch_id,v_link.branch_id),employee_name=p_new_employee_name_snapshot
    where device_id=p_device_id and device_pin=p_device_pin;
  end if;

  insert into attendance_link_identity_reviews (
    device_id,device_pin,branch_id,previous_employee_id,new_employee_id,resolution,reason,
    device_name_snapshot,device_user_name_snapshot,current_employee_name_snapshot,new_employee_name_snapshot,
    review_until,data_environment,reviewed_by,reviewed_at,metadata
  ) values (
    p_device_id,p_device_pin,coalesce(p_new_branch_id,v_link.branch_id),p_current_employee_id,
    case when p_resolution='relink' then p_new_employee_id else null end,p_resolution,trim(p_reason),
    p_device_name_snapshot,p_device_user_name_snapshot,p_current_employee_name_snapshot,
    case when p_resolution='relink' then p_new_employee_name_snapshot else null end,
    case when p_resolution='snooze' then p_review_until else null end,p_environment,p_actor,v_now,
    jsonb_build_object('inventory_count',v_inventory_count,'device_state_rows_written',v_state_count)
  );

  return jsonb_build_object(
    'ok',true,'resolution',p_resolution,'previous_employee_id',p_current_employee_id,
    'new_employee_id',case when p_resolution='relink' then p_new_employee_id else null end,
    'inventory_count',v_inventory_count,'device_state_rows_written',v_state_count,'reviewed_at',v_now
  );
end;
$$;

revoke all on function public.attendance_resolve_link_identity_review(uuid,text,text,text,text,text,uuid,text,uuid,text,text,uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.attendance_resolve_link_identity_review(uuid,text,text,text,text,text,uuid,text,uuid,text,text,uuid,text,text,timestamptz) to service_role;
