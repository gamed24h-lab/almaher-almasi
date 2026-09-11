-- Preserve the approved editable baseline before admins start publishing custom template versions.
update public.id_card_templates
set original_config = config
where (original_config is null or original_config='{}'::jsonb or not (original_config ? 'designer'))
  and (config ? 'designer');
