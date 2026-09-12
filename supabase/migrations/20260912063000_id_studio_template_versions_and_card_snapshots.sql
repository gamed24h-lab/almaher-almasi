begin;

update public.id_card_templates
set published_config = config,
    updated_at = now()
where (config ? 'designer')
  and not (published_config ? 'designer');

create table if not exists public.id_card_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.id_card_templates(id) on delete cascade,
  version integer not null check (version >= 1),
  orientation text not null check (orientation in ('portrait','landscape')),
  config jsonb not null default '{}'::jsonb,
  is_original boolean not null default false,
  is_published boolean not null default false,
  change_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique(template_id, version)
);

create index if not exists id_card_template_versions_template_idx
  on public.id_card_template_versions(template_id, version desc);
create index if not exists id_card_template_versions_published_idx
  on public.id_card_template_versions(template_id, is_published)
  where is_published = true;

alter table public.id_card_template_versions enable row level security;

insert into public.id_card_template_versions
  (template_id, version, orientation, config, is_original, is_published, change_reason, created_by)
select
  t.id,
  1,
  t.default_orientation,
  case when t.original_config <> '{}'::jsonb then t.original_config else t.config end,
  true,
  (coalesce(t.published_version,1) = 1),
  'original_baseline',
  t.updated_by
from public.id_card_templates t
on conflict (template_id, version) do nothing;

insert into public.id_card_template_versions
  (template_id, version, orientation, config, is_original, is_published, change_reason, created_by)
select
  t.id,
  greatest(coalesce(t.published_version,1),1),
  t.default_orientation,
  case when t.published_config <> '{}'::jsonb then t.published_config else t.config end,
  false,
  true,
  'published_baseline',
  t.updated_by
from public.id_card_templates t
where greatest(coalesce(t.published_version,1),1) <> 1
on conflict (template_id, version) do update
set orientation = excluded.orientation,
    config = excluded.config,
    is_published = true;

alter table public.id_cards
  add column if not exists template_version_id uuid references public.id_card_template_versions(id) on delete set null,
  add column if not exists template_config_snapshot jsonb not null default '{}'::jsonb;

update public.id_cards c
set template_version_id = v.id,
    template_config_snapshot = v.config,
    template_version = v.version
from public.id_card_templates t
join public.id_card_template_versions v
  on v.template_id = t.id
where c.template_code = t.code
  and v.version = coalesce(nullif(c.template_version,0), t.published_version, 1)
  and (c.template_version_id is null or c.template_config_snapshot = '{}'::jsonb);

update public.id_cards c
set template_version_id = v.id,
    template_config_snapshot = v.config,
    template_version = v.version
from public.id_card_templates t
join public.id_card_template_versions v
  on v.template_id = t.id and v.is_published = true
where c.template_code = t.code
  and (c.template_version_id is null or c.template_config_snapshot = '{}'::jsonb);

create or replace function public.protect_id_card_template_original_config()
returns trigger
language plpgsql
as $$
begin
  if old.original_config <> '{}'::jsonb
     and new.original_config is distinct from old.original_config then
    raise exception 'ID Studio original template baseline is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_id_card_template_original_config on public.id_card_templates;
create trigger trg_protect_id_card_template_original_config
before update of original_config on public.id_card_templates
for each row execute function public.protect_id_card_template_original_config();

commit;
