
create sequence if not exists public.company_form_document_no_seq;

create table if not exists public.company_form_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version integer not null default 1 check (version >= 1),
  name text not null,
  category text not null default 'general',
  description text,
  document_prefix text not null default 'FRM',
  form_schema jsonb not null default '[]'::jsonb,
  approval_flow jsonb not null default '[]'::jsonb,
  requires_employee boolean not null default false,
  requires_approval boolean not null default true,
  active boolean not null default true,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(code,data_environment)
);

create table if not exists public.company_form_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.company_form_templates(id) on delete cascade,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique(template_id,version)
);

create table if not exists public.company_form_submissions (
  id uuid primary key default gen_random_uuid(),
  document_no text unique,
  verification_token uuid not null default gen_random_uuid() unique,
  template_id uuid not null references public.company_form_templates(id) on delete restrict,
  template_code text not null,
  template_name text not null,
  template_version integer not null,
  template_snapshot jsonb not null,
  branch_id uuid references public.branches(id) on delete set null,
  attendance_employee_id uuid references public.attendance_employees(id) on delete set null,
  staff_user_id text,
  entity_type text,
  entity_id text,
  requester_id text not null,
  requester_name text,
  requester_role text,
  status text not null default 'draft' check (status in ('draft','pending','approved','rejected','cancelled')),
  form_data jsonb not null default '{}'::jsonb,
  notes text,
  approval_step integer not null default 0,
  approval_total_steps integer not null default 0,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  rejected_at timestamptz,
  rejected_by text,
  cancelled_at timestamptz,
  cancelled_by text,
  data_environment text not null default 'training' check (data_environment in ('training','production')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_form_templates_active_idx
  on public.company_form_templates(data_environment,active,category,name);
create index if not exists company_form_submissions_branch_status_idx
  on public.company_form_submissions(data_environment,branch_id,status,created_at desc);
create index if not exists company_form_submissions_requester_idx
  on public.company_form_submissions(requester_id,created_at desc);
create index if not exists company_form_submissions_employee_idx
  on public.company_form_submissions(attendance_employee_id,created_at desc)
  where attendance_employee_id is not null;
create index if not exists approval_requests_company_form_idx
  on public.approval_requests(request_type,status,reference_id,requested_at desc)
  where request_type='company_form';

create or replace function public.company_form_assign_document_no()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text;
begin
  if new.document_no is not null and btrim(new.document_no) <> '' then
    return new;
  end if;
  select document_prefix into v_prefix
  from public.company_form_templates
  where id=new.template_id;
  v_prefix := upper(regexp_replace(coalesce(nullif(btrim(v_prefix),''),'FRM'),'[^A-Za-z0-9]+','','g'));
  new.document_no := v_prefix || '-' ||
                     to_char((now() at time zone 'Asia/Riyadh')::date,'YYYY') || '-' ||
                     lpad(nextval('public.company_form_document_no_seq')::text,6,'0');
  return new;
end;
$$;

drop trigger if exists company_form_assign_document_no_trg on public.company_form_submissions;
create trigger company_form_assign_document_no_trg
before insert on public.company_form_submissions
for each row execute function public.company_form_assign_document_no();

alter table public.company_form_templates enable row level security;
alter table public.company_form_template_versions enable row level security;
alter table public.company_form_submissions enable row level security;

revoke all on table public.company_form_templates from anon,authenticated;
revoke all on table public.company_form_template_versions from anon,authenticated;
revoke all on table public.company_form_submissions from anon,authenticated;
revoke all on sequence public.company_form_document_no_seq from anon,authenticated;
revoke execute on function public.company_form_assign_document_no() from public,anon,authenticated;

grant select,insert,update,delete on table public.company_form_templates to service_role;
grant select,insert,update,delete on table public.company_form_template_versions to service_role;
grant select,insert,update,delete on table public.company_form_submissions to service_role;
grant usage,select on sequence public.company_form_document_no_seq to service_role;
grant execute on function public.company_form_assign_document_no() to service_role;

with seed(code,name,category,description,prefix,form_schema,approval_flow,requires_employee) as (
 values
 ('hr_permission','طلب استئذان','hr','طلب استئذان زمني لموظف','PERM',
  '[{"key":"work_date","label":"التاريخ","type":"date","required":true},{"key":"start_time","label":"من الساعة","type":"time","required":true},{"key":"end_time","label":"إلى الساعة","type":"time","required":true},{"key":"reason","label":"سبب الاستئذان","type":"textarea","required":true},{"key":"attachment_note","label":"ملاحظة عن المرفق","type":"text","required":false}]'::jsonb,
  '[{"step":1,"label":"اعتماد مدير الفرع","role":"مدير فرع"},{"step":2,"label":"اعتماد الموارد البشرية","role":"الموارد البشرية"}]'::jsonb,true),
 ('hr_leave','طلب إجازة','hr','طلب إجازة للموظف','LEAVE',
  '[{"key":"leave_type","label":"نوع الإجازة","type":"select","required":true,"options":["سنوية","مرضية","اضطرارية","بدون راتب","أخرى"]},{"key":"start_date","label":"من تاريخ","type":"date","required":true},{"key":"end_date","label":"إلى تاريخ","type":"date","required":true},{"key":"reason","label":"السبب / الملاحظات","type":"textarea","required":false}]'::jsonb,
  '[{"step":1,"label":"اعتماد مدير الفرع","role":"مدير فرع"},{"step":2,"label":"اعتماد الموارد البشرية","role":"الموارد البشرية"}]'::jsonb,true),
 ('attendance_correction','تصحيح بصمة','hr','طلب تصحيح حركة حضور أو انصراف','ATTCORR',
  '[{"key":"work_date","label":"تاريخ الحركة","type":"date","required":true},{"key":"correction_type","label":"نوع التصحيح","type":"select","required":true,"options":["دخول","خروج","إضافة حركة مفقودة","تصحيح وقت"]},{"key":"correct_time","label":"الوقت الصحيح","type":"time","required":true},{"key":"reason","label":"سبب التصحيح","type":"textarea","required":true}]'::jsonb,
  '[{"step":1,"label":"مراجعة الموارد البشرية","role":"الموارد البشرية"}]'::jsonb,true),
 ('shift_change','تغيير جدول دوام','hr','طلب تغيير جدول دوام موظف','SHIFT',
  '[{"key":"effective_from","label":"ساري من تاريخ","type":"date","required":true},{"key":"shift_start","label":"بداية الدوام","type":"time","required":true},{"key":"shift_end","label":"نهاية الدوام","type":"time","required":true},{"key":"reason","label":"سبب التغيير","type":"textarea","required":true}]'::jsonb,
  '[{"step":1,"label":"اعتماد الموارد البشرية","role":"الموارد البشرية"}]'::jsonb,true),
 ('employee_assignment','تكليف موظف','hr','تكليف موظف بمهمة أو موقع مؤقت','TASK',
  '[{"key":"from_date","label":"من تاريخ","type":"date","required":true},{"key":"to_date","label":"إلى تاريخ","type":"date","required":true},{"key":"location","label":"مكان / جهة التكليف","type":"text","required":true},{"key":"details","label":"تفاصيل التكليف","type":"textarea","required":true}]'::jsonb,
  '[{"step":1,"label":"اعتماد مدير الفرع","role":"مدير فرع"}]'::jsonb,true),
 ('employee_undertaking','تعهد موظف','hr','نموذج تعهد وإقرار موظف','UNDERT',
  '[{"key":"subject","label":"موضوع التعهد","type":"text","required":true},{"key":"undertaking_text","label":"نص التعهد","type":"textarea","required":true}]'::jsonb,
  '[{"step":1,"label":"اعتماد الموارد البشرية","role":"الموارد البشرية"}]'::jsonb,true),
 ('employee_warning','إنذار / لفت نظر','hr','إنذار أو لفت نظر لموظف','WARN',
  '[{"key":"violation_date","label":"تاريخ المخالفة","type":"date","required":true},{"key":"violation_type","label":"نوع المخالفة","type":"text","required":true},{"key":"details","label":"التفاصيل","type":"textarea","required":true},{"key":"required_action","label":"الإجراء المطلوب","type":"textarea","required":false}]'::jsonb,
  '[{"step":1,"label":"اعتماد الموارد البشرية","role":"الموارد البشرية"}]'::jsonb,true),
 ('asset_receipt','استلام عهدة','hr','محضر استلام عهدة موظف','ASSET',
  '[{"key":"asset_type","label":"نوع العهدة","type":"select","required":true,"options":["جوال","لابتوب","مفتاح","مركبة","جهاز","أخرى"]},{"key":"asset_description","label":"وصف العهدة","type":"text","required":true},{"key":"serial_no","label":"الرقم التسلسلي / رقم الأصل","type":"text","required":false},{"key":"condition","label":"الحالة عند الاستلام","type":"text","required":true},{"key":"notes","label":"ملاحظات","type":"textarea","required":false}]'::jsonb,
  '[{"step":1,"label":"اعتماد الموارد البشرية","role":"الموارد البشرية"}]'::jsonb,true),
 ('salary_certificate','تعريف بالراتب','hr','طلب إصدار تعريف بالراتب','SAL',
  '[{"key":"recipient","label":"الجهة الموجه إليها","type":"text","required":true},{"key":"language","label":"لغة الخطاب","type":"select","required":true,"options":["العربية","الإنجليزية","عربي + إنجليزي"]},{"key":"include_salary","label":"إظهار تفاصيل الراتب","type":"select","required":true,"options":["نعم","لا"]},{"key":"notes","label":"ملاحظات","type":"textarea","required":false}]'::jsonb,
  '[{"step":1,"label":"اعتماد الموارد البشرية","role":"الموارد البشرية"}]'::jsonb,true),
 ('employee_clearance','إخلاء طرف','hr','إخلاء طرف موظف وإنهاء عهد ومسؤوليات','CLR',
  '[{"key":"last_work_date","label":"آخر يوم عمل","type":"date","required":true},{"key":"reason","label":"سبب إنهاء العلاقة / الإخلاء","type":"text","required":true},{"key":"assets_status","label":"حالة العهد","type":"textarea","required":true},{"key":"notes","label":"ملاحظات","type":"textarea","required":false}]'::jsonb,
  '[{"step":1,"label":"اعتماد مدير الفرع","role":"مدير فرع"},{"step":2,"label":"اعتماد الموارد البشرية","role":"الموارد البشرية"}]'::jsonb,true)
),
envs(env) as (values ('training'),('production'))
insert into public.company_form_templates(
  code,name,category,description,document_prefix,form_schema,approval_flow,
  requires_employee,requires_approval,active,data_environment,created_by,updated_by
)
select s.code,s.name,s.category,s.description,s.prefix,s.form_schema,s.approval_flow,
       s.requires_employee,true,true,e.env,'system:forms-seed','system:forms-seed'
from seed s cross join envs e
on conflict(code,data_environment) do update set
  name=excluded.name,
  category=excluded.category,
  description=excluded.description,
  document_prefix=excluded.document_prefix,
  form_schema=excluded.form_schema,
  approval_flow=excluded.approval_flow,
  requires_employee=excluded.requires_employee,
  requires_approval=excluded.requires_approval,
  active=true,
  updated_by='system:forms-seed',
  updated_at=now();
