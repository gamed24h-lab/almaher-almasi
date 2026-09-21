create table if not exists public.attendance_self_service_biometric_requests (
  id uuid primary key default gen_random_uuid(),
  staff_user_id text not null,
  attendance_employee_id uuid null,
  branch_id uuid null,
  device_id uuid null,
  device_pin text null,
  request_type text not null check (request_type in ('account_binding','claim_unlinked_pin','wrong_link','not_mine','other')),
  status text not null default 'pending' check (status in ('pending','auto_resolved','approved','rejected','cancelled')),
  requested_reason text null,
  evidence jsonb not null default '{}'::jsonb,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by text null,
  resolution_note text null
);
create index if not exists attendance_self_service_bio_requests_staff_idx on public.attendance_self_service_biometric_requests(staff_user_id,status,requested_at desc);
create index if not exists attendance_self_service_bio_requests_branch_idx on public.attendance_self_service_biometric_requests(branch_id,status,requested_at desc);
create index if not exists attendance_self_service_bio_requests_pin_idx on public.attendance_self_service_biometric_requests(device_id,device_pin,status,requested_at desc);
alter table public.attendance_self_service_biometric_requests enable row level security;
revoke all on table public.attendance_self_service_biometric_requests from anon, authenticated;
grant select, insert, update, delete on table public.attendance_self_service_biometric_requests to service_role;

create or replace function public.attendance_self_service_claim_pin(
  p_staff_user_id text,p_employee_id uuid,p_device_id uuid,p_device_pin text,p_actor text,p_environment text default 'training'
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_employee attendance_employees%rowtype;v_device attendance_devices%rowtype;v_existing attendance_employee_links%rowtype;
  v_now timestamptz:=now();v_inventory_count integer:=0;
begin
  select * into v_employee from attendance_employees where id=p_employee_id and status='active' and data_environment=p_environment for update;
  if not found then raise exception 'employee_not_found'; end if;
  if coalesce(v_employee.staff_user_id,'')<>coalesce(p_staff_user_id,'') then raise exception 'employee_account_mismatch'; end if;
  select * into v_device from attendance_devices where id=p_device_id and status='active' and data_environment=p_environment for update;
  if not found then raise exception 'device_not_found'; end if;
  if v_employee.branch_id is distinct from v_device.branch_id then raise exception 'branch_mismatch'; end if;
  if not exists(select 1 from attendance_device_users where device_id=p_device_id and device_pin=p_device_pin) then raise exception 'device_pin_not_found'; end if;
  select * into v_existing from attendance_employee_links where device_id=p_device_id and device_pin=p_device_pin and active=true for update;
  if found and v_existing.attendance_employee_id is not null and v_existing.attendance_employee_id<>p_employee_id then raise exception 'pin_owned_by_other_employee'; end if;
  if exists(select 1 from attendance_employee_links where device_id=p_device_id and attendance_employee_id=p_employee_id and active=true and device_pin<>p_device_pin) then raise exception 'employee_has_other_pin_on_device'; end if;
  if exists(select 1 from attendance_biometric_inventory where device_id=p_device_id and device_pin=p_device_pin and data_environment=p_environment and status='active' and attendance_employee_id is not null and attendance_employee_id<>p_employee_id) then raise exception 'biometric_owned_by_other_employee'; end if;

  insert into attendance_employee_links(device_id,device_pin,attendance_employee_id,staff_user_id,branch_id,display_name,active,created_by,updated_by,created_at,updated_at)
  values(p_device_id,p_device_pin,p_employee_id,p_staff_user_id,v_employee.branch_id,v_employee.name,true,p_actor,p_actor,v_now,v_now)
  on conflict(device_id,device_pin) do update set attendance_employee_id=excluded.attendance_employee_id,staff_user_id=excluded.staff_user_id,branch_id=excluded.branch_id,display_name=excluded.display_name,active=true,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  select count(*) into v_inventory_count from attendance_biometric_inventory where device_id=p_device_id and device_pin=p_device_pin and data_environment=p_environment and status='active';

  insert into attendance_biometric_profiles(attendance_employee_id,branch_id,source_device_id,device_pin,biometric_type,biometric_key,finger_code,slot_no,status,version,last_enrolled_at,last_sync_at,last_result_code,data_environment,metadata,created_by,updated_by,created_at,updated_at)
  select p_employee_id,v_employee.branch_id,i.device_id,i.device_pin,i.biometric_type,i.biometric_key,i.finger_code,i.slot_no,'active',1,null,coalesce(i.last_seen_at,v_now),coalesce(i.last_result_code,0),i.data_environment,jsonb_build_object('source','employee_self_service_claim','inventory_id',i.id,'raw_template_stored',false),p_actor,p_actor,v_now,v_now
  from attendance_biometric_inventory i where i.device_id=p_device_id and i.device_pin=p_device_pin and i.data_environment=p_environment and i.status='active'
  on conflict(attendance_employee_id,biometric_key,data_environment) do update set branch_id=excluded.branch_id,source_device_id=excluded.source_device_id,device_pin=excluded.device_pin,biometric_type=excluded.biometric_type,finger_code=excluded.finger_code,slot_no=excluded.slot_no,status='active',last_sync_at=excluded.last_sync_at,last_result_code=excluded.last_result_code,metadata=coalesce(attendance_biometric_profiles.metadata,'{}'::jsonb)||excluded.metadata,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  insert into attendance_biometric_device_states(device_id,attendance_employee_id,branch_id,device_pin,biometric_type,biometric_key,finger_code,slot_no,status,last_seen_at,last_result_code,data_environment,metadata,created_at,updated_at)
  select i.device_id,p_employee_id,v_employee.branch_id,i.device_pin,i.biometric_type,i.biometric_key,i.finger_code,i.slot_no,'active',coalesce(i.last_seen_at,v_now),coalesce(i.last_result_code,0),i.data_environment,jsonb_build_object('source','employee_self_service_claim','inventory_id',i.id,'raw_template_stored',false),v_now,v_now
  from attendance_biometric_inventory i where i.device_id=p_device_id and i.device_pin=p_device_pin and i.data_environment=p_environment and i.status='active'
  on conflict(device_id,attendance_employee_id,biometric_key,data_environment) do update set branch_id=excluded.branch_id,device_pin=excluded.device_pin,biometric_type=excluded.biometric_type,finger_code=excluded.finger_code,slot_no=excluded.slot_no,status='active',last_seen_at=excluded.last_seen_at,last_result_code=excluded.last_result_code,metadata=coalesce(attendance_biometric_device_states.metadata,'{}'::jsonb)||excluded.metadata,updated_at=excluded.updated_at;

  update attendance_biometric_inventory set attendance_employee_id=p_employee_id,branch_id=v_employee.branch_id,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('self_service_claimed_at',v_now,'staff_user_id',p_staff_user_id),updated_at=v_now
  where device_id=p_device_id and device_pin=p_device_pin and data_environment=p_environment and status='active';

  update attendance_raw_logs set attendance_employee_id=p_employee_id,staff_user_id=p_staff_user_id,employee_name=v_employee.name,branch_id=v_employee.branch_id where device_id=p_device_id and device_pin=p_device_pin;

  insert into attendance_self_service_biometric_requests(staff_user_id,attendance_employee_id,branch_id,device_id,device_pin,request_type,status,requested_reason,evidence,data_environment,requested_at,resolved_at,resolved_by,resolution_note)
  values(p_staff_user_id,p_employee_id,v_employee.branch_id,p_device_id,p_device_pin,'claim_unlinked_pin','auto_resolved','تصحيح تلقائي من الموظف',jsonb_build_object('inventory_count',v_inventory_count,'safe_claim',true),p_environment,v_now,v_now,p_actor,'تم الربط تلقائيًا بعد تحقق شروط الأمان');

  return jsonb_build_object('ok',true,'device_id',p_device_id,'device_pin',p_device_pin,'inventory_count',v_inventory_count);
end;
$$;
revoke all on function public.attendance_self_service_claim_pin(text,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.attendance_self_service_claim_pin(text,uuid,uuid,text,text,text) to service_role;
