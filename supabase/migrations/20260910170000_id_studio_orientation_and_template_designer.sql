-- ID Studio: portrait/landscape + editable template designer foundation

alter table public.id_cards
  add column if not exists orientation text not null default 'landscape'
  check (orientation in ('portrait','landscape'));

alter table public.id_card_templates
  add column if not exists default_orientation text not null default 'landscape'
  check (default_orientation in ('portrait','landscape'));

alter table public.id_card_templates
  add column if not exists original_config jsonb not null default '{}'::jsonb;

alter table public.id_card_templates
  add column if not exists published_config jsonb not null default '{}'::jsonb;

alter table public.id_card_templates
  add column if not exists published_version integer not null default 1 check (published_version > 0);

alter table public.id_card_templates
  add column if not exists updated_by text;

-- Existing visual templates remain landscape by default. The two approved reference designs are portrait-first.
update public.id_card_templates
set default_orientation='portrait'
where code in ('makkah_luxury','executive_side');

-- Store a safe editable baseline. Actual image assets can be uploaded/replaced later from the designer.
update public.id_card_templates
set config = config || jsonb_build_object(
  'designer', jsonb_build_object(
    'editable', true,
    'orientationModes', jsonb_build_array('portrait','landscape'),
    'brand', jsonb_build_object(
      'companyNameAr','شركة الماهر الماسي للنقل',
      'companyNameEn','Al-Maher Al-Massy Transport Company',
      'serviceLineAr','لنقل الحجاج والمعتمرين',
      'serviceLineEn','For Hajj & Umrah Transport',
      'sloganAr','نُيسر دربك... لنطمئن قلبك',
      'honorAr','خدمة ضيوف الرحمن شرف لنا',
      'honorEn','SERVING THE GUESTS OF ALLAH IS AN HONOR FOR US'
    ),
    'assets', jsonb_build_object(
      'logoUrl','',
      'backgroundUrl','',
      'makkahUrl','',
      'busUrl','',
      'signatureUrl',''
    ),
    'visibility', jsonb_build_object(
      'logo',true,'companyName',true,'serviceLine',true,'slogan',true,
      'holderPhoto',true,'holderName',true,'jobTitle',true,'department',true,
      'employeeId',true,'licenseNumber',true,'season',true,'qr',true,
      'approval',true,'bus',true,'makkah',true,'footer',true
    ),
    'theme', jsonb_build_object(
      'primary','#073f78','secondary','#0b5b9a','accent','#d9a72f','surface','#ffffff','text','#0b2f5d'
    )
  )
),
original_config = case when original_config='{}'::jsonb then config else original_config end,
published_config = case when published_config='{}'::jsonb then config else published_config end
where code in ('makkah_luxury','executive_side','clean_formal','royal_dark','minimal_corporate');

comment on column public.id_cards.orientation is 'Physical CR80 orientation: portrait=53.98x85.60mm, landscape=85.60x53.98mm.';
comment on column public.id_card_templates.original_config is 'Immutable/reference baseline used to restore the approved original template.';
comment on column public.id_card_templates.published_config is 'Last published designer configuration used for production cards.';
