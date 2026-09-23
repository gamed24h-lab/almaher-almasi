
alter table public.company_form_submissions
  add column if not exists integration_status text not null default 'not_applicable',
  add column if not exists integration_type text,
  add column if not exists integration_reference_id uuid,
  add column if not exists integration_note text,
  add column if not exists integration_applied_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.company_form_submissions'::regclass
      and conname='company_form_submissions_integration_status_chk'
  ) then
    alter table public.company_form_submissions
      add constraint company_form_submissions_integration_status_chk
      check (integration_status in ('not_applicable','pending','applied','needs_review','failed'));
  end if;
end $$;

create index if not exists company_form_submissions_branch_idx
  on public.company_form_submissions(branch_id);
create index if not exists company_form_submissions_template_idx
  on public.company_form_submissions(template_id);

create table if not exists public.company_form_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.company_form_submissions(id) on delete cascade,
  bucket text not null default 'almaher-form-attachments',
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 8388608),
  sha256 text,
  uploaded_by text,
  uploaded_name text,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  created_at timestamptz not null default now()
);

create index if not exists company_form_attachments_submission_idx
  on public.company_form_attachments(submission_id,created_at);

create table if not exists public.company_form_signatures (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.company_form_submissions(id) on delete cascade,
  approval_request_id uuid unique references public.approval_requests(id) on delete set null,
  step_no integer not null default 1 check (step_no >= 1),
  action text not null check (action in ('approve','reject')),
  signer_id text not null,
  signer_name text,
  signer_role text,
  signature_method text not null default 'account_approval',
  decision_note text,
  metadata jsonb not null default '{}'::jsonb,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  signed_at timestamptz not null default now()
);

create index if not exists company_form_signatures_submission_idx
  on public.company_form_signatures(submission_id,step_no,signed_at);

create table if not exists public.company_form_effects (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.company_form_submissions(id) on delete cascade,
  effect_type text not null,
  status text not null check (status in ('applied','needs_review','failed','not_applicable')),
  attendance_employee_id uuid references public.attendance_employees(id) on delete set null,
  reference_table text,
  reference_id uuid,
  details jsonb not null default '{}'::jsonb,
  applied_by text,
  applied_at timestamptz,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_form_effects_employee_idx
  on public.company_form_effects(attendance_employee_id,created_at desc)
  where attendance_employee_id is not null;

insert into storage.buckets(id,name,public,file_size_limit)
values ('almaher-form-attachments','almaher-form-attachments',false,8388608)
on conflict (id) do update
set public=false,file_size_limit=excluded.file_size_limit;

alter table public.company_form_attachments enable row level security;
alter table public.company_form_signatures enable row level security;
alter table public.company_form_effects enable row level security;

revoke all on table public.company_form_attachments from anon,authenticated;
revoke all on table public.company_form_signatures from anon,authenticated;
revoke all on table public.company_form_effects from anon,authenticated;

grant select,insert,update,delete on table public.company_form_attachments to service_role;
grant select,insert,update,delete on table public.company_form_signatures to service_role;
grant select,insert,update,delete on table public.company_form_effects to service_role;

create or replace function public.company_form_decide_approval(
  p_submission_id uuid,
  p_approval_request_id uuid,
  p_decision text,
  p_actor_id text,
  p_actor_name text,
  p_actor_role text,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sub public.company_form_submissions%rowtype;
  v_req public.approval_requests%rowtype;
  v_flow jsonb;
  v_total integer;
  v_step integer;
  v_next jsonb;
  v_now timestamptz := now();
  v_rule_id uuid;
  v_corr_id uuid;
  v_manual_id uuid;
  v_effect_type text := 'none';
  v_effect_status text := 'not_applicable';
  v_effect_note text := null;
  v_ref_table text := null;
  v_ref_id uuid := null;
  v_work_date date;
  v_start_date date;
  v_end_date date;
  v_start_time time;
  v_end_time time;
  v_correct_time time;
  v_event_type text;
  v_corr_type text;
  v_proposed_at timestamptz;
  v_reason text;
begin
  if p_decision not in ('approve','reject') then
    raise exception 'invalid_decision';
  end if;

  select * into v_sub
  from public.company_form_submissions
  where id=p_submission_id
  for update;

  if not found then raise exception 'company_form_not_found'; end if;

  select * into v_req
  from public.approval_requests
  where id=p_approval_request_id
    and request_type='company_form'
    and reference_id=p_submission_id
  for update;

  if not found then raise exception 'company_form_approval_not_found'; end if;
  if v_req.status <> 'pending' then raise exception 'company_form_approval_already_decided'; end if;
  if v_sub.status <> 'pending' then raise exception 'company_form_not_pending'; end if;

  v_flow := coalesce(v_sub.template_snapshot->'approval_flow','[]'::jsonb);
  v_total := greatest(0,jsonb_array_length(v_flow));
  v_step := greatest(1,coalesce((v_req.metadata->>'step_no')::integer,v_sub.approval_step,1));

  if p_decision='reject' then
    update public.approval_requests
    set status='rejected',rejected_by=p_actor_id,rejected_at=v_now,decided_at=v_now,
        decision_notes=nullif(btrim(coalesce(p_note,'')),''),updated_at=v_now
    where id=v_req.id;

    insert into public.company_form_signatures(
      submission_id,approval_request_id,step_no,action,signer_id,signer_name,signer_role,
      signature_method,decision_note,metadata,data_environment,signed_at
    ) values (
      v_sub.id,v_req.id,v_step,'reject',p_actor_id,p_actor_name,p_actor_role,
      'account_approval',nullif(btrim(coalesce(p_note,'')),''),coalesce(p_metadata,'{}'::jsonb),
      v_sub.data_environment,v_now
    )
    on conflict (approval_request_id) do nothing;

    update public.company_form_submissions
    set status='rejected',rejected_at=v_now,rejected_by=p_actor_id,updated_at=v_now
    where id=v_sub.id
    returning * into v_sub;

    return jsonb_build_object('ok',true,'status','rejected','submission',to_jsonb(v_sub));
  end if;

  update public.approval_requests
  set status='approved',approved_by=p_actor_id,approved_at=v_now,decided_at=v_now,
      decision_notes=nullif(btrim(coalesce(p_note,'')),''),updated_at=v_now
  where id=v_req.id;

  insert into public.company_form_signatures(
    submission_id,approval_request_id,step_no,action,signer_id,signer_name,signer_role,
    signature_method,decision_note,metadata,data_environment,signed_at
  ) values (
    v_sub.id,v_req.id,v_step,'approve',p_actor_id,p_actor_name,p_actor_role,
    'account_approval',nullif(btrim(coalesce(p_note,'')),''),coalesce(p_metadata,'{}'::jsonb),
    v_sub.data_environment,v_now
  )
  on conflict (approval_request_id) do nothing;

  if v_step < v_total then
    v_next := v_flow->v_step;

    insert into public.approval_requests(
      request_type,reference_table,reference_id,branch_id,requested_by,requested_at,status,
      reason,metadata,data_environment,entity_type,entity_id,approver_role,approver_id,request_payload
    ) values (
      'company_form','company_form_submissions',v_sub.id,v_sub.branch_id,v_sub.requester_id,v_now,'pending',
      v_sub.notes,
      jsonb_build_object('company_form',true,'step_no',v_step+1,'total_steps',v_total,'step_label',v_next->>'label'),
      v_sub.data_environment,'company_form_submission',v_sub.id::text,
      nullif(v_next->>'role',''),nullif(v_next->>'approver_id',''),
      jsonb_build_object('document_no',v_sub.document_no,'template_name',v_sub.template_name,'step_no',v_step+1,'total_steps',v_total,'step_label',v_next->>'label')
    );

    update public.company_form_submissions
    set approval_step=v_step+1,updated_at=v_now
    where id=v_sub.id
    returning * into v_sub;

    return jsonb_build_object('ok',true,'status','pending','next_step',v_step+1,'submission',to_jsonb(v_sub));
  end if;

  if v_sub.template_code='hr_permission' then
    if v_sub.attendance_employee_id is null then raise exception 'company_form_employee_required'; end if;
    v_work_date := nullif(v_sub.form_data->>'work_date','')::date;
    v_start_time := nullif(v_sub.form_data->>'start_time','')::time;
    v_end_time := nullif(v_sub.form_data->>'end_time','')::time;
    v_reason := nullif(v_sub.form_data->>'reason','');

    if v_work_date is null or v_start_time is null or v_end_time is null then raise exception 'company_form_permission_fields_missing'; end if;
    if v_end_time <= v_start_time then raise exception 'company_form_permission_time_invalid'; end if;
    if exists (
      select 1 from public.attendance_month_closures c
      where c.branch_id=v_sub.branch_id and c.data_environment=v_sub.data_environment
        and c.status='closed' and c.period_month=date_trunc('month',v_work_date)::date
    ) then raise exception 'attendance_month_closed'; end if;

    insert into public.attendance_employee_calendar_rules(
      attendance_employee_id,branch_id,rule_type,label,start_date,end_date,start_time,end_time,
      status,data_environment,notes,created_by,updated_by,created_at,updated_at,policy_payload
    ) values (
      v_sub.attendance_employee_id,v_sub.branch_id,'permission','استئذان معتمد — '||v_sub.document_no,
      v_work_date,v_work_date,v_start_time,v_end_time,'active',v_sub.data_environment,
      coalesce(v_reason,'')||case when v_sub.notes is not null then E'\n'||v_sub.notes else '' end,
      p_actor_id,p_actor_id,v_now,v_now,
      jsonb_build_object('source','company_form','company_form_submission_id',v_sub.id,'document_no',v_sub.document_no)
    ) returning id into v_rule_id;

    v_effect_type := 'attendance_permission';v_effect_status := 'applied';
    v_ref_table := 'attendance_employee_calendar_rules';v_ref_id := v_rule_id;
    v_effect_note := 'تم إنشاء استئذان الحضور تلقائيًا من النموذج المعتمد';

  elsif v_sub.template_code='hr_leave' then
    if v_sub.attendance_employee_id is null then raise exception 'company_form_employee_required'; end if;
    v_start_date := nullif(v_sub.form_data->>'start_date','')::date;
    v_end_date := nullif(v_sub.form_data->>'end_date','')::date;
    v_reason := nullif(v_sub.form_data->>'reason','');

    if v_start_date is null or v_end_date is null or v_end_date < v_start_date then raise exception 'company_form_leave_dates_invalid'; end if;
    if exists (
      select 1 from public.attendance_month_closures c
      where c.branch_id=v_sub.branch_id and c.data_environment=v_sub.data_environment
        and c.status='closed'
        and c.period_month between date_trunc('month',v_start_date)::date and date_trunc('month',v_end_date)::date
    ) then raise exception 'attendance_month_closed'; end if;

    insert into public.attendance_employee_calendar_rules(
      attendance_employee_id,branch_id,rule_type,label,start_date,end_date,start_time,end_time,
      status,data_environment,notes,created_by,updated_by,created_at,updated_at,policy_payload
    ) values (
      v_sub.attendance_employee_id,v_sub.branch_id,'leave','إجازة معتمدة — '||v_sub.document_no,
      v_start_date,v_end_date,null,null,'active',v_sub.data_environment,
      coalesce(v_reason,'')||case when v_sub.notes is not null then E'\n'||v_sub.notes else '' end,
      p_actor_id,p_actor_id,v_now,v_now,
      jsonb_build_object('source','company_form','company_form_submission_id',v_sub.id,'document_no',v_sub.document_no,'leave_type',v_sub.form_data->>'leave_type')
    ) returning id into v_rule_id;

    v_effect_type := 'attendance_leave';v_effect_status := 'applied';
    v_ref_table := 'attendance_employee_calendar_rules';v_ref_id := v_rule_id;
    v_effect_note := 'تم إنشاء الإجازة في الحضور تلقائيًا من النموذج المعتمد';

  elsif v_sub.template_code='attendance_correction' then
    if v_sub.attendance_employee_id is null then raise exception 'company_form_employee_required'; end if;
    v_work_date := nullif(v_sub.form_data->>'work_date','')::date;
    v_correct_time := nullif(v_sub.form_data->>'correct_time','')::time;
    v_corr_type := coalesce(v_sub.form_data->>'correction_type','');
    v_reason := nullif(v_sub.form_data->>'reason','');

    if v_work_date is null or v_correct_time is null then raise exception 'company_form_correction_fields_missing'; end if;
    if exists (
      select 1 from public.attendance_month_closures c
      where c.branch_id=v_sub.branch_id and c.data_environment=v_sub.data_environment
        and c.status='closed' and c.period_month=date_trunc('month',v_work_date)::date
    ) then raise exception 'attendance_month_closed'; end if;

    if v_corr_type in ('دخول','بصمة دخول مفقودة') then v_event_type := 'check_in';
    elsif v_corr_type in ('خروج','بصمة خروج مفقودة') then v_event_type := 'check_out';
    else v_event_type := null;
    end if;

    if v_event_type is not null then
      v_proposed_at := (v_work_date + v_correct_time) at time zone 'Asia/Riyadh';

      insert into public.attendance_correction_requests(
        attendance_employee_id,staff_user_id,branch_id,work_date,request_type,requested_event_type,
        proposed_at,source_kind,source_event_id,requested_reason,evidence,status,data_environment,
        requested_at,reviewed_at,reviewed_by,resolution_note,updated_at
      ) values (
        v_sub.attendance_employee_id,v_sub.staff_user_id,v_sub.branch_id,v_work_date,
        case when v_event_type='check_in' then 'missing_check_in' else 'missing_check_out' end,
        v_event_type,v_proposed_at,null,null,coalesce(v_reason,'تصحيح بصمة عبر نموذج معتمد'),
        jsonb_build_object('source','company_form','company_form_submission_id',v_sub.id,'document_no',v_sub.document_no),
        'approved',v_sub.data_environment,v_sub.submitted_at,v_now,p_actor_id,
        'اعتماد تلقائي من مركز النماذج والموافقات',v_now
      ) returning id into v_corr_id;

      insert into public.attendance_manual_events(
        attendance_employee_id,staff_user_id,branch_id,work_date,event_type,occurred_at,source,
        correction_request_id,data_environment,created_by,metadata,created_at
      ) values (
        v_sub.attendance_employee_id,v_sub.staff_user_id,v_sub.branch_id,v_work_date,v_event_type,
        v_proposed_at,'approved_correction',v_corr_id,v_sub.data_environment,p_actor_id,
        jsonb_build_object('source','company_form','company_form_submission_id',v_sub.id,'document_no',v_sub.document_no),v_now
      ) returning id into v_manual_id;

      v_effect_type := case when v_event_type='check_in' then 'attendance_missing_check_in' else 'attendance_missing_check_out' end;
      v_effect_status := 'applied';v_ref_table := 'attendance_manual_events';v_ref_id := v_manual_id;
      v_effect_note := 'تمت إضافة حركة الحضور المصححة تلقائيًا';
    else
      v_effect_type := 'attendance_wrong_time';v_effect_status := 'needs_review';
      v_effect_note := 'النموذج معتمد، لكن تصحيح وقت بصمة موجودة يحتاج اختيار الحركة الأصلية قبل الاستبدال';
    end if;
  end if;

  if v_effect_type <> 'none' then
    insert into public.company_form_effects(
      submission_id,effect_type,status,attendance_employee_id,reference_table,reference_id,
      details,applied_by,applied_at,data_environment,created_at,updated_at
    ) values (
      v_sub.id,v_effect_type,v_effect_status,v_sub.attendance_employee_id,v_ref_table,v_ref_id,
      jsonb_build_object('document_no',v_sub.document_no,'template_code',v_sub.template_code,'note',v_effect_note),
      p_actor_id,case when v_effect_status='applied' then v_now else null end,v_sub.data_environment,v_now,v_now
    )
    on conflict (submission_id) do update set
      effect_type=excluded.effect_type,status=excluded.status,attendance_employee_id=excluded.attendance_employee_id,
      reference_table=excluded.reference_table,reference_id=excluded.reference_id,details=excluded.details,
      applied_by=excluded.applied_by,applied_at=excluded.applied_at,updated_at=v_now;

    update public.company_form_submissions
    set integration_status=v_effect_status,integration_type=v_effect_type,integration_reference_id=v_ref_id,
        integration_note=v_effect_note,integration_applied_at=case when v_effect_status='applied' then v_now else null end
    where id=v_sub.id;
  end if;

  update public.company_form_submissions
  set status='approved',approval_step=v_total,approved_at=v_now,approved_by=p_actor_id,updated_at=v_now
  where id=v_sub.id
  returning * into v_sub;

  return jsonb_build_object(
    'ok',true,'status','approved','integration_status',v_sub.integration_status,
    'integration_type',v_sub.integration_type,'integration_note',v_sub.integration_note,'submission',to_jsonb(v_sub)
  );
end;
$$;

revoke execute on function public.company_form_decide_approval(uuid,uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.company_form_decide_approval(uuid,uuid,text,text,text,text,text,jsonb) to service_role;
