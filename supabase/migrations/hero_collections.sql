-- ============================================================================
-- Migration: homepage hero collection ("The Wedding Suite" section)
-- Safe to run on an existing Husnalogy database. Additive only — it does not
-- modify or drop any existing table. Run this in the Supabase SQL editor, or
-- re-run supabase/schema.sql which now contains the same block.
-- ============================================================================

create extension if not exists pgcrypto;

-- Reuse the shared trigger function if it already exists; define it otherwise
-- so this migration is self-contained.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.hero_collections (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  slug text not null default '',
  season_label text not null default '',
  collection_label text not null default '',
  heading_line_one text not null default '',
  heading_line_two text not null default '',
  description text not null default '',
  primary_button_text text not null default '',
  primary_button_url text not null default '',
  secondary_link_text text not null default '',
  secondary_link_url text not null default '',
  main_image text not null default '',
  thumbnail_one text not null default '',
  thumbnail_two text not null default '',
  thumbnail_three text not null default '',
  source_collection_id text not null default '',
  item_count integer not null default 0 check (item_count >= 0),
  is_active boolean not null default false,
  is_featured boolean not null default false,
  display_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- For installs created before this column existed.
alter table public.hero_collections add column if not exists source_collection_id text not null default '';

alter table public.hero_collections enable row level security;

drop policy if exists "hero_collections_public_read_active" on public.hero_collections;
create policy "hero_collections_public_read_active" on public.hero_collections
for select using (is_active or public.is_admin());

drop policy if exists "hero_collections_admin_manage" on public.hero_collections;
create policy "hero_collections_admin_manage" on public.hero_collections
for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists set_hero_collections_updated_at on public.hero_collections;
create trigger set_hero_collections_updated_at
before update on public.hero_collections
for each row execute function public.set_updated_at();

create index if not exists idx_hero_collections_featured
  on public.hero_collections(is_active, is_featured, display_order);

grant all on public.hero_collections to service_role;
grant select on public.hero_collections to anon;
grant select, insert, update, delete on public.hero_collections to authenticated;

-- Optional starter row matching the approved design defaults. Add images and
-- flip is_active / is_featured to true from Admin → Home Hero to publish.
insert into public.hero_collections (
  title, slug, season_label, collection_label,
  heading_line_one, heading_line_two, description,
  primary_button_text, primary_button_url,
  secondary_link_text, secondary_link_url,
  item_count, is_active, is_featured, display_order
)
select
  'The Wedding Suite', 'wedding-suite', 'Wedding Season 2026', 'NEW COLLECTION',
  'The Wedding', 'Suite',
  'Invitations, RSVP cards, menus and keepsakes, designed as one considered set and personalized with your names. Order the pieces you love, or take the whole suite.',
  'Personalize a sample', '/weddings',
  'Browse all collections', '/weddings',
  12, false, false, 0
where not exists (select 1 from public.hero_collections);
