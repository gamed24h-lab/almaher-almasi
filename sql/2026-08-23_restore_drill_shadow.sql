-- AL-MAHER — ISOLATED RESTORE DRILL SHADOW TABLES
-- Safe migration: creates isolated test-only tables. Does not alter operational data.

create extension if not exists pgcrypto;

create table if not exists public.restore_drill_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running','completed','failed')),
  snapshot_backup_run_id text,
  snapshot_path text,
  checksum text,
  initiated_by text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  table_count integer not null default 0,
  row_count integer not null default 0,
  details jsonb not null default '{}'::jsonb
);

create table if not exists public.restore_drill_rows (
  id bigserial primary key,
  drill_id uuid not null references public.restore_drill_runs(id) on delete cascade,
  table_name text not null,
  source_id text,
  row_no integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (drill_id, table_name, row_no)
);

create index if not exists restore_drill_rows_drill_idx on public.restore_drill_rows(drill_id);
create index if not exists restore_drill_rows_table_idx on public.restore_drill_rows(drill_id,table_name);

alter table public.restore_drill_runs enable row level security;
alter table public.restore_drill_rows enable row level security;

comment on table public.restore_drill_runs is 'Isolated restore rehearsal runs only; never production operational data';
comment on table public.restore_drill_rows is 'Shadow JSONB rows restored from pre-release snapshots for isolated restore drills';
