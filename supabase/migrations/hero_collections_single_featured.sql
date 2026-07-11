-- Home Hero management no longer stores a manual item count or display order.
-- The app derives the item count from the linked product collection, and the
-- trigger guarantees that featuring one hero unfeatures every other hero.

drop index if exists public.idx_hero_collections_featured;

alter table public.hero_collections
  drop column if exists item_count,
  drop column if exists display_order;

create index if not exists idx_hero_collections_featured
  on public.hero_collections(is_active, is_featured);

create or replace function public.enforce_single_featured_hero_collection()
returns trigger
language plpgsql
as $$
begin
  if new.is_featured then
    update public.hero_collections
    set is_featured = false, updated_at = now()
    where id <> new.id and is_featured;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_single_featured_hero_collection on public.hero_collections;
create trigger enforce_single_featured_hero_collection
before insert or update of is_featured on public.hero_collections
for each row execute function public.enforce_single_featured_hero_collection();
