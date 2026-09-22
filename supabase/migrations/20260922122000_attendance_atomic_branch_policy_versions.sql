-- Atomic effective-dated branch attendance policy save.
-- Keeps future policies from becoming active before their effective date.

create or replace function public.attendance_save_branch_policy_version(
  p_branch_id uuid,
  p_environment text,
  p_effective_from date,
  p_policy_snapshot jsonb,
  p_reason text default null,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_now timestamptz := now();
  v_existing public.attendance_branch_policies%rowtype;
  v_active_version public.attendance_branch_policy_versions%rowtype;
  v_target_version public.attendance_branch_policy_versions%rowtype;
  v_policy public.attendance_branch_policies%rowtype;
  v_baseline jsonb;
  v_active jsonb;
  v_baseline_end date;
begin
  if p_branch_id is null then
    raise exception 'attendance_branch_required';
  end if;
  if p_environment not in ('training','production') then
    raise exception 'attendance_environment_invalid';
  end if;
  if p_effective_from is null then
    raise exception 'attendance_policy_effective_from_required';
  end if;
  if p_policy_snapshot is null or jsonb_typeof(p_policy_snapshot) <> 'object' then
    raise exception 'attendance_policy_snapshot_invalid';
  end if;
  if not exists(select 1 from public.branches b where b.id=p_branch_id) then
    raise exception 'attendance_branch_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_branch_id::text || ':' || p_environment));

  select * into v_existing
  from public.attendance_branch_policies
  where branch_id=p_branch_id and data_environment=p_environment
  limit 1;

  -- Ensure there is always a historical baseline before the first explicit
  -- policy. This is especially important when the first policy is scheduled
  -- for the future: today must remain biometric/default until that date.
  if not exists (
    select 1 from public.attendance_branch_policy_versions
    where branch_id=p_branch_id and data_environment=p_environment
  ) and p_effective_from > date '2000-01-01' then
    v_baseline := case
      when v_existing.id is not null then to_jsonb(v_existing)
      else jsonb_build_object(
        'branch_id',p_branch_id,
        'data_environment',p_environment,
        'attendance_mode','biometric',
        'mobile_geofence_enabled',true,
        'mobile_geofence_radius_m',100,
        'mobile_max_accuracy_m',120,
        'mobile_location_lat',null,
        'mobile_location_lng',null,
        'mobile_require_trusted_device',true,
        'mobile_require_selfie',false,
        'mobile_require_dynamic_qr',false,
        'policy_effective_from','2000-01-01',
        'early_leave_grace_minutes',10,
        'shortage_grace_minutes',15,
        'partial_absence_threshold_minutes',60,
        'late_penalty_minutes',0,
        'early_leave_penalty_minutes',0,
        'missing_punch_penalty_minutes',0,
        'partial_absence_penalty_minutes',0,
        'absence_penalty_minutes',0,
        'notes',null
      )
    end;
    v_baseline_end := p_effective_from - 1;
    insert into public.attendance_branch_policy_versions(
      branch_id,data_environment,effective_from,effective_to,policy_snapshot,
      reason,created_by,updated_by,created_at,updated_at
    ) values (
      p_branch_id,p_environment,date '2000-01-01',v_baseline_end,v_baseline,
      'خط أساس قبل أول سياسة مؤرخة',p_actor,p_actor,v_now,v_now
    )
    on conflict (branch_id,data_environment,effective_from) do nothing;
  end if;

  insert into public.attendance_branch_policy_versions(
    branch_id,data_environment,effective_from,effective_to,policy_snapshot,
    reason,created_by,updated_by,created_at,updated_at
  ) values (
    p_branch_id,p_environment,p_effective_from,null,p_policy_snapshot,
    nullif(btrim(coalesce(p_reason,'')),''),
    p_actor,p_actor,v_now,v_now
  )
  on conflict (branch_id,data_environment,effective_from)
  do update set
    policy_snapshot=excluded.policy_snapshot,
    reason=excluded.reason,
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at
  returning * into v_target_version;

  -- Rebuild contiguous ranges from effective dates in one transaction.
  with ranges as (
    select id,
           lead(effective_from) over(order by effective_from) - 1 as next_end
    from public.attendance_branch_policy_versions
    where branch_id=p_branch_id and data_environment=p_environment
  )
  update public.attendance_branch_policy_versions v
  set effective_to=r.next_end,
      updated_at=case when v.effective_to is distinct from r.next_end then v_now else v.updated_at end,
      updated_by=case when v.effective_to is distinct from r.next_end then p_actor else v.updated_by end
  from ranges r
  where v.id=r.id
    and v.effective_to is distinct from r.next_end;

  select * into v_target_version
  from public.attendance_branch_policy_versions
  where branch_id=p_branch_id
    and data_environment=p_environment
    and effective_from=p_effective_from
  limit 1;

  select * into v_active_version
  from public.attendance_branch_policy_versions
  where branch_id=p_branch_id
    and data_environment=p_environment
    and effective_from<=v_today
    and (effective_to is null or effective_to>=v_today)
  order by effective_from desc
  limit 1;

  if v_active_version.id is null then
    v_active := jsonb_build_object(
      'attendance_mode','biometric',
      'mobile_geofence_enabled',true,
      'mobile_geofence_radius_m',100,
      'mobile_max_accuracy_m',120,
      'mobile_location_lat',null,
      'mobile_location_lng',null,
      'mobile_require_trusted_device',true,
      'mobile_require_selfie',false,
      'mobile_require_dynamic_qr',false,
      'early_leave_grace_minutes',10,
      'shortage_grace_minutes',15,
      'partial_absence_threshold_minutes',60,
      'late_penalty_minutes',0,
      'early_leave_penalty_minutes',0,
      'missing_punch_penalty_minutes',0,
      'partial_absence_penalty_minutes',0,
      'absence_penalty_minutes',0,
      'notes',null
    );
  else
    v_active := v_active_version.policy_snapshot;
  end if;

  insert into public.attendance_branch_policies(
    branch_id,data_environment,
    attendance_mode,mobile_geofence_enabled,mobile_geofence_radius_m,mobile_max_accuracy_m,
    mobile_location_lat,mobile_location_lng,mobile_require_trusted_device,
    mobile_require_selfie,mobile_require_dynamic_qr,policy_effective_from,
    early_leave_grace_minutes,shortage_grace_minutes,partial_absence_threshold_minutes,
    late_penalty_minutes,early_leave_penalty_minutes,missing_punch_penalty_minutes,
    partial_absence_penalty_minutes,absence_penalty_minutes,notes,
    created_by,updated_by,created_at,updated_at
  ) values (
    p_branch_id,p_environment,
    coalesce(nullif(v_active->>'attendance_mode',''),'biometric'),
    coalesce((v_active->>'mobile_geofence_enabled')::boolean,true),
    coalesce((v_active->>'mobile_geofence_radius_m')::integer,100),
    coalesce((v_active->>'mobile_max_accuracy_m')::integer,120),
    nullif(v_active->>'mobile_location_lat','')::double precision,
    nullif(v_active->>'mobile_location_lng','')::double precision,
    coalesce((v_active->>'mobile_require_trusted_device')::boolean,true),
    coalesce((v_active->>'mobile_require_selfie')::boolean,false),
    coalesce((v_active->>'mobile_require_dynamic_qr')::boolean,false),
    coalesce(v_active_version.effective_from,date '2000-01-01'),
    coalesce((v_active->>'early_leave_grace_minutes')::integer,10),
    coalesce((v_active->>'shortage_grace_minutes')::integer,15),
    coalesce((v_active->>'partial_absence_threshold_minutes')::integer,60),
    coalesce((v_active->>'late_penalty_minutes')::integer,0),
    coalesce((v_active->>'early_leave_penalty_minutes')::integer,0),
    coalesce((v_active->>'missing_punch_penalty_minutes')::integer,0),
    coalesce((v_active->>'partial_absence_penalty_minutes')::integer,0),
    coalesce((v_active->>'absence_penalty_minutes')::integer,0),
    nullif(v_active->>'notes',''),
    coalesce(v_existing.created_by,p_actor),p_actor,
    coalesce(v_existing.created_at,v_now),v_now
  )
  on conflict (branch_id,data_environment)
  do update set
    attendance_mode=excluded.attendance_mode,
    mobile_geofence_enabled=excluded.mobile_geofence_enabled,
    mobile_geofence_radius_m=excluded.mobile_geofence_radius_m,
    mobile_max_accuracy_m=excluded.mobile_max_accuracy_m,
    mobile_location_lat=excluded.mobile_location_lat,
    mobile_location_lng=excluded.mobile_location_lng,
    mobile_require_trusted_device=excluded.mobile_require_trusted_device,
    mobile_require_selfie=excluded.mobile_require_selfie,
    mobile_require_dynamic_qr=excluded.mobile_require_dynamic_qr,
    policy_effective_from=excluded.policy_effective_from,
    early_leave_grace_minutes=excluded.early_leave_grace_minutes,
    shortage_grace_minutes=excluded.shortage_grace_minutes,
    partial_absence_threshold_minutes=excluded.partial_absence_threshold_minutes,
    late_penalty_minutes=excluded.late_penalty_minutes,
    early_leave_penalty_minutes=excluded.early_leave_penalty_minutes,
    missing_punch_penalty_minutes=excluded.missing_punch_penalty_minutes,
    partial_absence_penalty_minutes=excluded.partial_absence_penalty_minutes,
    absence_penalty_minutes=excluded.absence_penalty_minutes,
    notes=excluded.notes,
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at
  returning * into v_policy;

  return jsonb_build_object(
    'ok',true,
    'policy',to_jsonb(v_policy),
    'policy_version',to_jsonb(v_target_version),
    'scheduled_for_future',p_effective_from>v_today,
    'activates_on',case when p_effective_from>v_today then p_effective_from else null end,
    'today',v_today
  );
end;
$$;

revoke all on function public.attendance_save_branch_policy_version(uuid,text,date,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.attendance_save_branch_policy_version(uuid,text,date,jsonb,text,text)
  to service_role;
