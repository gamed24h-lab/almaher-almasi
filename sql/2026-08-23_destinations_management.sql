begin;

create table if not exists public.travel_destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  destination_type text not null default 'city' check (destination_type in ('city','meeting_point','terminal','hotel_area','other')),
  address text,
  map_url text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(name, city)
);

create table if not exists public.destination_routes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  from_destination_id uuid not null references public.travel_destinations(id) on delete restrict,
  to_destination_id uuid not null references public.travel_destinations(id) on delete restrict,
  route_stops jsonb not null default '[]'::jsonb,
  branch_ids jsonb not null default '[]'::jsonb,
  return_reverse_stops boolean not null default true,
  default_bus_capacity integer not null default 49,
  price_one_way numeric(12,2) not null default 0,
  price_no_accommodation numeric(12,2) not null default 0,
  price_shared numeric(12,2) not null default 0,
  price_private_room numeric(12,2) not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_destination_id <> to_destination_id)
);

create index if not exists travel_destinations_city_idx on public.travel_destinations(city);
create index if not exists destination_routes_from_idx on public.destination_routes(from_destination_id);
create index if not exists destination_routes_to_idx on public.destination_routes(to_destination_id);

alter table public.travel_destinations enable row level security;
alter table public.destination_routes enable row level security;

commit;
