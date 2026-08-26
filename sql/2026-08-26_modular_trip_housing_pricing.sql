-- Modular trip + housing pricing
-- Additive only: legacy pricing columns stay in place for backward compatibility.
alter table public.trips add column if not exists price_return_only numeric;
alter table public.trips add column if not exists price_round_trip numeric;
alter table public.trips add column if not exists price_shared_daily numeric;

alter table public.destination_routes add column if not exists price_return_only numeric;
alter table public.destination_routes add column if not exists price_round_trip numeric;
alter table public.destination_routes add column if not exists price_shared_daily numeric;

update public.trips
set price_return_only = coalesce(price_return_only, price_one_way),
    price_round_trip = coalesce(price_round_trip, price_no_accommodation)
where price_return_only is null or price_round_trip is null;

update public.destination_routes
set price_return_only = coalesce(price_return_only, price_one_way),
    price_round_trip = coalesce(price_round_trip, price_no_accommodation)
where price_return_only is null or price_round_trip is null;

comment on column public.trips.price_return_only is 'Transport price per traveler for return-only booking';
comment on column public.trips.price_round_trip is 'Transport price per traveler for round-trip booking excluding housing';
comment on column public.trips.price_shared_daily is 'Shared housing price per traveler per day';
comment on column public.destination_routes.price_return_only is 'Default transport price per traveler for return-only booking';
comment on column public.destination_routes.price_round_trip is 'Default transport price per traveler for round-trip booking excluding housing';
comment on column public.destination_routes.price_shared_daily is 'Default shared housing price per traveler per day';
