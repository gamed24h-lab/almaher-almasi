-- Attendance punch correction workflow.
-- Raw biometric/mobile events remain immutable; approved corrections are applied as overlays.

create table if not exists public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  attendance_employee_id uuid not null references public.attendance_employees(id) on delete cascade,
  staff_user_id text references public.staff_users(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  work_date date not null,
  request_type text not null check (request_type in ('missing_check_in','missing_check_out','wrong_time','remove_event')),
  requested_event_type text check (requested_event_type is null or requested_event_type in ('check_in','check_out')),
  proposed_at timestamptz,
  source_kind text check (source_kind is null or source_kind in ('biometric','mobile','manual')),
  source_event_id text,
  requested_reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  resolution_note text,
  updated_at timestamptz not null default now()
);

create index if not exists attendance_correction_requests_employee_date_idx
  on public.attendance_correction_requests(attendance_employee_id,work_date desc,requested_at desc);

create index if not exists attendance_correction_requests_branch_status_idx
  on public.attendance_correction_requests(branch_id,status,requested_at desc);

create unique index if not exists attendance_correction_requests_pending_dedupe_idx
  on public.attendance_correction_requests(
    attendance_employee_id,work_date,request_type,
    coalesce(source_kind,''),coalesce(source_event_id,'')
  )
  where status='pending';

create table if not exists public.attendance_manual_events (
  id uuid primary key default gen_random_uuid(),
  attendance_employee_id uuid not null references public.attendance_employees(id) on delete cascade,
  staff_user_id text references public.staff_users(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  work_date date not null,
  event_type text not null check (event_type in ('check_in','check_out')),
  occurred_at timestamptz not null,
  source text not null default 'approved_correction',
  correction_request_id uuid references public.attendance_correction_requests(id) on delete set null,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists attendance_manual_events_correction_request_uidx
  on public.attendance_manual_events(correction_request_id)
  where correction_request_id is not null;

create index if not exists attendance_manual_events_employee_time_idx
  on public.attendance_manual_events(attendance_employee_id,occurred_at);

create table if not exists public.attendance_event_overrides (
  id uuid primary key default gen_random_uuid(),
  attendance_employee_id uuid not null references public.attendance_employees(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  work_date date not null,
  source_kind text not null check (source_kind in ('biometric','mobile','manual')),
  source_event_id text not null,
  override_action text not null check (override_action in ('void','replace')),
  replacement_manual_event_id uuid references public.attendance_manual_events(id) on delete set null,
  correction_request_id uuid references public.attendance_correction_requests(id) on delete set null,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  active boolean not null default true,
  created_by text,
  reason text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text
);

create unique index if not exists attendance_event_overrides_active_source_uidx
  on public.attendance_event_overrides(source_kind,source_event_id,data_environment)
  where active=true;

create unique index if not exists attendance_event_overrides_correction_request_uidx
  on public.attendance_event_overrides(correction_request_id)
  where correction_request_id is not null;

create index if not exists attendance_event_overrides_employee_date_idx
  on public.attendance_event_overrides(attendance_employee_id,work_date desc);

alter table public.attendance_correction_requests enable row level security;
alter table public.attendance_manual_events enable row level security;
alter table public.attendance_event_overrides enable row level security;

comment on table public.attendance_correction_requests is
  'Employee attendance punch correction requests reviewed by HR/authorized managers.';
comment on table public.attendance_manual_events is
  'Immutable approved manual attendance events; original device/mobile events are never edited.';
comment on table public.attendance_event_overrides is
  'Overlay instructions that void or replace original attendance events without mutating source logs.';

create or replace function public.attendance_resolve_correction_request(
  p_request_id uuid,
  p_decision text,
  p_reviewer text,
  p_resolution_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_req public.attendance_correction_requests%rowtype;
  v_manual public.attendance_manual_events%rowtype;
  v_override public.attendance_event_overrides%rowtype;
  v_now timestamptz := now();
  v_event_type text;
  v_exists boolean := false;
begin
  select * into v_req
  from public.attendance_correction_requests
  where id=p_request_id
  for update;

  if v_req.id is null then
    raise exception 'attendance_correction_request_not_found';
  end if;

  if v_req.status <> 'pending' then
    select * into v_manual from public.attendance_manual_events
      where correction_request_id=v_req.id limit 1;
    select * into v_override from public.attendance_event_overrides
      where correction_request_id=v_req.id limit 1;
    return jsonb_build_object(
      'ok',true,'already_resolved',true,'request',to_jsonb(v_req),
      'manual_event',case when v_manual.id is null then null else to_jsonb(v_manual) end,
      'override',case when v_override.id is null then null else to_jsonb(v_override) end
    );
  end if;

  if p_decision='reject' then
    update public.attendance_correction_requests
    set status='rejected',reviewed_at=v_now,reviewed_by=p_reviewer,
        resolution_note=nullif(btrim(coalesce(p_resolution_note,'')),''),
        updated_at=v_now
    where id=v_req.id
    returning * into v_req;
    return jsonb_build_object('ok',true,'request',to_jsonb(v_req));
  end if;

  if p_decision<>'approve' then
    raise exception 'attendance_correction_decision_invalid';
  end if;

  if v_req.request_type='missing_check_in' then
    v_event_type := 'check_in';
  elsif v_req.request_type='missing_check_out' then
    v_event_type := 'check_out';
  else
    v_event_type := v_req.requested_event_type;
  end if;

  if v_req.request_type in ('missing_check_in','missing_check_out','wrong_time') then
    if v_req.proposed_at is null or v_event_type not in ('check_in','check_out') then
      raise exception 'attendance_correction_proposed_time_required';
    end if;
  end if;

  if v_req.request_type in ('wrong_time','remove_event') then
    if v_req.source_kind is null or nullif(btrim(coalesce(v_req.source_event_id,'')),'') is null then
      raise exception 'attendance_correction_source_required';
    end if;

    if v_req.source_kind='biometric' then
      if v_req.source_event_id !~ '^[0-9]+$' then
        raise exception 'attendance_correction_source_invalid';
      end if;
      select exists(
        select 1 from public.attendance_raw_logs r
        where r.id=v_req.source_event_id::bigint
          and r.attendance_employee_id=v_req.attendance_employee_id
          and r.data_environment=v_req.data_environment
      ) into v_exists;
    elsif v_req.source_kind='mobile' then
      begin
        select exists(
          select 1 from public.attendance_mobile_events r
          where r.id=v_req.source_event_id::uuid
            and r.attendance_employee_id=v_req.attendance_employee_id
            and r.data_environment=v_req.data_environment
        ) into v_exists;
      exception when invalid_text_representation then
        v_exists := false;
      end;
    elsif v_req.source_kind='manual' then
      begin
        select exists(
          select 1 from public.attendance_manual_events r
          where r.id=v_req.source_event_id::uuid
            and r.attendance_employee_id=v_req.attendance_employee_id
            and r.data_environment=v_req.data_environment
        ) into v_exists;
      exception when invalid_text_representation then
        v_exists := false;
      end;
    end if;

    if not coalesce(v_exists,false) then
      raise exception 'attendance_correction_source_not_owned';
    end if;
  end if;

  if v_req.request_type in ('missing_check_in','missing_check_out','wrong_time') then
    insert into public.attendance_manual_events(
      attendance_employee_id,staff_user_id,branch_id,work_date,event_type,occurred_at,
      source,correction_request_id,data_environment,created_by,metadata
    ) values (
      v_req.attendance_employee_id,v_req.staff_user_id,v_req.branch_id,v_req.work_date,
      v_event_type,v_req.proposed_at,'approved_correction',v_req.id,
      v_req.data_environment,p_reviewer,
      jsonb_build_object(
        'request_type',v_req.request_type,
        'source_kind',v_req.source_kind,
        'source_event_id',v_req.source_event_id,
        'requested_reason',v_req.requested_reason
      )
    )
    on conflict (correction_request_id) where correction_request_id is not null
    do update set occurred_at=excluded.occurred_at
    returning * into v_manual;
  end if;

  if v_req.request_type='wrong_time' then
    insert into public.attendance_event_overrides(
      attendance_employee_id,branch_id,work_date,source_kind,source_event_id,
      override_action,replacement_manual_event_id,correction_request_id,
      data_environment,active,created_by,reason
    ) values (
      v_req.attendance_employee_id,v_req.branch_id,v_req.work_date,
      v_req.source_kind,v_req.source_event_id,'replace',v_manual.id,v_req.id,
      v_req.data_environment,true,p_reviewer,
      coalesce(nullif(btrim(coalesce(p_resolution_note,'')),''),v_req.requested_reason)
    )
    on conflict (correction_request_id) where correction_request_id is not null
    do update set
      replacement_manual_event_id=excluded.replacement_manual_event_id,
      active=true,created_by=excluded.created_by,reason=excluded.reason,
      revoked_at=null,revoked_by=null,revoke_reason=null
    returning * into v_override;
  elsif v_req.request_type='remove_event' then
    insert into public.attendance_event_overrides(
      attendance_employee_id,branch_id,work_date,source_kind,source_event_id,
      override_action,replacement_manual_event_id,correction_request_id,
      data_environment,active,created_by,reason
    ) values (
      v_req.attendance_employee_id,v_req.branch_id,v_req.work_date,
      v_req.source_kind,v_req.source_event_id,'void',null,v_req.id,
      v_req.data_environment,true,p_reviewer,
      coalesce(nullif(btrim(coalesce(p_resolution_note,'')),''),v_req.requested_reason)
    )
    on conflict (correction_request_id) where correction_request_id is not null
    do update set
      active=true,created_by=excluded.created_by,reason=excluded.reason,
      revoked_at=null,revoked_by=null,revoke_reason=null
    returning * into v_override;
  end if;

  update public.attendance_correction_requests
  set status='approved',reviewed_at=v_now,reviewed_by=p_reviewer,
      resolution_note=nullif(btrim(coalesce(p_resolution_note,'')),''),
      updated_at=v_now
  where id=v_req.id
  returning * into v_req;

  return jsonb_build_object(
    'ok',true,'request',to_jsonb(v_req),
    'manual_event',case when v_manual.id is null then null else to_jsonb(v_manual) end,
    'override',case when v_override.id is null then null else to_jsonb(v_override) end
  );
end;
$$;

revoke all on function public.attendance_resolve_correction_request(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.attendance_resolve_correction_request(uuid,text,text,text)
  to service_role;
