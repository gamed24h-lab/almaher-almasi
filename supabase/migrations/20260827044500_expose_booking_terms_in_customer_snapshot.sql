-- Stamp the exact terms in force when a booking is created and mirror the
-- immutable terms metadata into the safe booking snapshot used by customer
-- portal responses. Existing bookings are intentionally not backfilled.
create or replace function public.create_booking_with_passengers(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  b jsonb := coalesce(p_payload->'booking','{}'::jsonb);
  p jsonb := coalesce(p_payload->'passengers','[]'::jsonb);
  v_terms_setting jsonb := '{}'::jsonb;
  v_terms_version text;
  v_terms_snapshot jsonb := '[]'::jsonb;
  v_accepted_at text;
  v_snapshot jsonb := '{}'::jsonb;
begin
  if coalesce((b->>'terms_accepted')::boolean,false) is not true then
    raise exception 'terms must be accepted';
  end if;
  if jsonb_array_length(p)<1 then
    raise exception 'passengers are required';
  end if;

  select coalesce(value,'{}'::jsonb)
    into v_terms_setting
  from public.system_settings
  where key='ticket.terms.v1'
  limit 1;

  v_terms_setting := coalesce(v_terms_setting,'{}'::jsonb);
  v_terms_version := coalesce(nullif(b->>'terms_version',''),nullif(v_terms_setting->>'version',''),'2026.08.27-1');
  v_terms_snapshot := case
    when jsonb_typeof(b->'terms_snapshot')='array' and jsonb_array_length(b->'terms_snapshot')>0 then b->'terms_snapshot'
    when jsonb_typeof(v_terms_setting->'full_terms')='array' then v_terms_setting->'full_terms'
    when jsonb_typeof(v_terms_setting->'terms')='array' then v_terms_setting->'terms'
    else '[]'::jsonb
  end;
  v_accepted_at := coalesce(nullif(b->>'terms_accepted_at',''),now()::text);
  v_snapshot := case when jsonb_typeof(b->'snapshot')='object' then b->'snapshot' else '{}'::jsonb end;

  b := b || jsonb_build_object(
    'terms_version',v_terms_version,
    'terms_accepted_at',v_accepted_at,
    'terms_snapshot',v_terms_snapshot,
    'snapshot',v_snapshot || jsonb_build_object(
      'termsVersion',v_terms_version,
      'termsAccepted',true,
      'termsAcceptedAt',v_accepted_at,
      'termsSnapshot',v_terms_snapshot
    )
  );

  return public.almaher_save_booking_atomic(
    b,p,
    jsonb_build_object(
      'id','public',
      'name',coalesce(b->>'created_by','العميل'),
      'role',coalesce(b->>'source','customer')
    ),false
  );
end;
$function$;
