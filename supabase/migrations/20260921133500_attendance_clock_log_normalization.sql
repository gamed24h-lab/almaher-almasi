create or replace function public.attendance_correct_device_clock_logs(
  p_device_id uuid,
  p_drift_seconds integer,
  p_tolerance_seconds integer default 180,
  p_since timestamptz default (now() - interval '180 days')
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_first_original timestamptz;
  v_last_original timestamptz;
  v_now timestamptz := now();
  v_tolerance integer := greatest(30, least(coalesce(p_tolerance_seconds,180),600));
begin
  if p_device_id is null then
    raise exception 'device id is required';
  end if;
  if p_drift_seconds is null or abs(p_drift_seconds) <= 120 or abs(p_drift_seconds) > 172800 then
    raise exception 'invalid confirmed drift';
  end if;

  with candidates as (
    select l.id, l.occurred_at as original_occurred_at
    from public.attendance_raw_logs l
    where l.device_id = p_device_id
      and l.received_at >= coalesce(p_since, now() - interval '180 days')
      and abs(extract(epoch from (l.occurred_at - l.received_at)) - p_drift_seconds) <= v_tolerance
      and coalesce((l.metadata->'clock_correction'->>'applied')::boolean,false) = false
    for update
  ),
  updated as (
    update public.attendance_raw_logs l
       set occurred_at = l.occurred_at - make_interval(secs => p_drift_seconds),
           metadata = coalesce(l.metadata,'{}'::jsonb) ||
             jsonb_build_object(
               'clock_correction',
               jsonb_build_object(
                 'applied',true,
                 'source','confirmed_server_clock_drift',
                 'drift_seconds',p_drift_seconds,
                 'tolerance_seconds',v_tolerance,
                 'original_occurred_at',c.original_occurred_at,
                 'corrected_occurred_at',l.occurred_at - make_interval(secs => p_drift_seconds),
                 'corrected_at',v_now
               )
             )
      from candidates c
     where l.id = c.id
    returning c.original_occurred_at
  )
  select count(*)::integer,min(original_occurred_at),max(original_occurred_at)
    into v_count,v_first_original,v_last_original
  from updated;

  return jsonb_build_object(
    'ok',true,
    'device_id',p_device_id,
    'corrected_count',v_count,
    'drift_seconds',p_drift_seconds,
    'tolerance_seconds',v_tolerance,
    'first_original_at',v_first_original,
    'last_original_at',v_last_original,
    'corrected_at',v_now
  );
end;
$$;

revoke all on function public.attendance_correct_device_clock_logs(uuid,integer,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.attendance_correct_device_clock_logs(uuid,integer,integer,timestamptz) to service_role;
