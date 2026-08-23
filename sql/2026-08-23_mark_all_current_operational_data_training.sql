begin;

-- Keep the system in training mode while current operational data is classified.
update public.system_runtime_state
set runtime_mode = 'training',
    changed_at = now(),
    changed_by = 'prelaunch_training_reconcile',
    details = coalesce(details,'{}'::jsonb) || jsonb_build_object(
      'note','All current operational rows classified as training before first production launch',
      'classified_at',now()
    )
where id = 'main';

-- Any public table carrying data_environment is an environment-scoped operational table.
-- Mark every existing row as training, including legacy NULL rows and any accidental production tags.
do $$
declare
  r record;
begin
  for r in
    select distinct table_schema, table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'data_environment'
      and table_name <> 'system_runtime_state'
    order by table_name
  loop
    execute format(
      'update %I.%I set data_environment = %L where data_environment is distinct from %L',
      r.table_schema,
      r.table_name,
      'training',
      'training'
    );
  end loop;
end $$;

commit;

-- Verification report: production and unclassified counts must both be zero.
select
  c.table_name,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.table_name), false, true, '')))[1]::text::bigint as total_rows,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where data_environment = ''training''', c.table_name), false, true, '')))[1]::text::bigint as training_rows,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where data_environment = ''production''', c.table_name), false, true, '')))[1]::text::bigint as production_rows,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where data_environment is null', c.table_name), false, true, '')))[1]::text::bigint as unclassified_rows
from (
  select distinct table_name
  from information_schema.columns
  where table_schema='public'
    and column_name='data_environment'
) c
order by c.table_name;
