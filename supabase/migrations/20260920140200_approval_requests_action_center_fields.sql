alter table public.approval_requests
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists approver_role text,
  add column if not exists request_payload jsonb not null default '{}'::jsonb,
  add column if not exists approver_id text,
  add column if not exists decided_at timestamptz;

create index if not exists approval_requests_entity_pending_idx
  on public.approval_requests(request_type,entity_id,status);

comment on column public.approval_requests.entity_id is
'Logical entity identifier for approval workflows that target non-UUID entities such as staff users.';

comment on column public.approval_requests.request_payload is
'Frozen approval request payload used by controlled decision handlers.';
