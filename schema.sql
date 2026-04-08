-- Bunny Counter — Supabase schema
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query)

create table walks (
  id               uuid default gen_random_uuid() primary key,
  user_id          uuid references auth.users(id) on delete cascade not null,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  duration_seconds integer,
  count            integer default 0,
  created_at       timestamptz default now()
);

create table sightings (
  id         uuid default gen_random_uuid() primary key,
  walk_id    uuid references walks(id) on delete cascade not null,
  user_id    uuid references auth.users(id) on delete cascade not null,
  seen_at    timestamptz not null,
  lat        float8,
  lng        float8,
  created_at timestamptz default now()
);

alter table walks    enable row level security;
alter table sightings enable row level security;

create policy "Users manage their own walks"
  on walks for all using (auth.uid() = user_id);

create policy "Users manage their own sightings"
  on sightings for all using (auth.uid() = user_id);
