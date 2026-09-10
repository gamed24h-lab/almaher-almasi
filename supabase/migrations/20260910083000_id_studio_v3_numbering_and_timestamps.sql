create sequence if not exists public.id_card_number_seq start with 1 increment by 1;

alter table public.id_cards
  alter column card_number set default ('MA-' || lpad(nextval('public.id_card_number_seq')::text, 3, '0'));

create or replace function public.set_id_studio_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_id_cards_updated_at on public.id_cards;
create trigger trg_id_cards_updated_at before update on public.id_cards for each row execute function public.set_id_studio_updated_at();

drop trigger if exists trg_id_card_templates_updated_at on public.id_card_templates;
create trigger trg_id_card_templates_updated_at before update on public.id_card_templates for each row execute function public.set_id_studio_updated_at();

drop trigger if exists trg_id_card_printer_profiles_updated_at on public.id_card_printer_profiles;
create trigger trg_id_card_printer_profiles_updated_at before update on public.id_card_printer_profiles for each row execute function public.set_id_studio_updated_at();
