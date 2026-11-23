-- Popote : schéma Supabase. À coller une fois dans SQL Editor > Run.
-- Toutes les lectures/écritures passent par le serveur (clé service_role) :
-- RLS est activé sans aucune policy, la clé publique n'a donc accès à aucune donnée.

create extension if not exists pgcrypto;

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  last_seen timestamptz
);

create table if not exists weeks (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  default_people int not null default 4 check (default_people between 1 and 50),
  configured boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists slots (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  day smallint not null check (day between 0 and 6),
  meal text not null check (meal in ('lunch','dinner')),
  active boolean not null default true,
  people int check (people between 1 and 50),
  unique (week_id, day, meal)
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  source text not null check (source in ('courses','placard')),
  quantity numeric check (quantity >= 0),
  unit text not null default '',
  per_person boolean not null default false,
  checked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists items_week_idx on items(week_id);

create table if not exists dishes (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slot_id uuid references slots(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists dishes_week_idx on dishes(week_id);

create table if not exists dish_ingredients (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references dishes(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  qty_per_person numeric not null default 0 check (qty_per_person >= 0),
  unique (dish_id, item_id)
);

-- Mémoire des ingrédients déjà utilisés (alimente « Ingrédients récents »)
create table if not exists ingredient_memory (
  name_key text primary key,
  name text not null,
  source text not null,
  unit text not null default '',
  quantity numeric,
  per_person boolean not null default false,
  last_week date not null,
  uses int not null default 1
);

alter table devices enable row level security;
alter table weeks enable row level security;
alter table slots enable row level security;
alter table items enable row level security;
alter table dishes enable row level security;
alter table dish_ingredients enable row level security;
alter table ingredient_memory enable row level security;
