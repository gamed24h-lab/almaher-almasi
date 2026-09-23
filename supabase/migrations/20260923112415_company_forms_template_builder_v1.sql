
alter table public.company_form_templates
  add column if not exists is_system boolean not null default false;

update public.company_form_templates
set is_system=true
where code in (
 'hr_permission','hr_leave','attendance_correction','shift_change','employee_assignment',
 'employee_undertaking','employee_warning','asset_receipt','salary_certificate','employee_clearance'
);

create or replace function public.company_form_save_template(
  p_id uuid,
  p_code text,
  p_name text,
  p_category text,
  p_description text,
  p_document_prefix text,
  p_form_schema jsonb,
  p_approval_flow jsonb,
  p_requires_employee boolean,
  p_requires_approval boolean,
  p_active boolean,
  p_actor text,
  p_environment text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.company_form_templates%rowtype;
  v_code text;
  v_name text := btrim(coalesce(p_name,''));
  v_prefix text := upper(regexp_replace(coalesce(p_document_prefix,''),'[^A-Za-z0-9]+','','g'));
  v_category text := btrim(coalesce(p_category,'general'));
  v_schema jsonb := coalesce(p_form_schema,'[]'::jsonb);
  v_flow jsonb := coalesce(p_approval_flow,'[]'::jsonb);
  v_version integer;
begin
  if p_environment not in ('training','production') then raise exception 'company_form_template_environment_invalid'; end if;
  if char_length(v_name)<2 or char_length(v_name)>120 then raise exception 'company_form_template_name_invalid'; end if;
  if char_length(v_prefix)<2 or char_length(v_prefix)>14 then raise exception 'company_form_template_prefix_invalid'; end if;
  if jsonb_typeof(v_schema)<>'array' or jsonb_array_length(v_schema)>40 then raise exception 'company_form_template_schema_invalid'; end if;
  if jsonb_typeof(v_flow)<>'array' or jsonb_array_length(v_flow)>10 then raise exception 'company_form_template_flow_invalid'; end if;
  if coalesce(p_requires_approval,true) and jsonb_array_length(v_flow)=0 then raise exception 'company_form_template_approval_flow_required'; end if;

  if p_id is null then
    v_code := lower(btrim(coalesce(p_code,'')));
    if v_code !~ '^custom_[a-z0-9_]{6,60}$' then raise exception 'company_form_template_code_invalid'; end if;

    insert into public.company_form_templates(
      code,version,name,category,description,document_prefix,form_schema,approval_flow,
      requires_employee,requires_approval,active,is_system,data_environment,created_by,updated_by,created_at,updated_at
    ) values (
      v_code,1,v_name,coalesce(nullif(v_category,''),'general'),nullif(btrim(coalesce(p_description,'')),''),
      v_prefix,v_schema,v_flow,coalesce(p_requires_employee,false),coalesce(p_requires_approval,true),
      coalesce(p_active,true),false,p_environment,p_actor,p_actor,now(),now()
    )
    returning * into v_row;
  else
    select * into v_row
    from public.company_form_templates
    where id=p_id and data_environment=p_environment
    for update;
    if not found then raise exception 'company_form_template_not_found'; end if;
    if v_row.is_system then raise exception 'company_form_system_template_readonly'; end if;

    v_version := v_row.version+1;
    update public.company_form_templates
    set version=v_version,
        name=v_name,
        category=coalesce(nullif(v_category,''),'general'),
        description=nullif(btrim(coalesce(p_description,'')),''),
        document_prefix=v_prefix,
        form_schema=v_schema,
        approval_flow=v_flow,
        requires_employee=coalesce(p_requires_employee,false),
        requires_approval=coalesce(p_requires_approval,true),
        active=coalesce(p_active,true),
        updated_by=p_actor,
        updated_at=now()
    where id=v_row.id
    returning * into v_row;
  end if;

  insert into public.company_form_template_versions(template_id,version,snapshot,created_by,created_at)
  values(v_row.id,v_row.version,to_jsonb(v_row),p_actor,now())
  on conflict(template_id,version) do update
  set snapshot=excluded.snapshot,created_by=excluded.created_by,created_at=excluded.created_at;

  return jsonb_build_object('ok',true,'template',to_jsonb(v_row));
end;
$$;

revoke execute on function public.company_form_save_template(uuid,text,text,text,text,text,jsonb,jsonb,boolean,boolean,boolean,text,text) from public,anon,authenticated;
grant execute on function public.company_form_save_template(uuid,text,text,text,text,text,jsonb,jsonb,boolean,boolean,boolean,text,text) to service_role;

create index if not exists company_form_templates_system_active_idx
  on public.company_form_templates(data_environment,is_system,active,name);
