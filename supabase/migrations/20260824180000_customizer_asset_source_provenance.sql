-- External asset provenance for the Elements library (Iconify import).
--
-- Iconify is a discovery/import source only: the SVG is sanitized and stored
-- permanently in the customizer-elements bucket, and these columns record
-- WHERE it came from and under WHICH license — captured at import time so a
-- later upstream change can never rewrite the provenance of an asset already
-- used in a placed order.
--
-- All columns are nullable: locally uploaded Husnalogy assets have no external
-- source and must remain completely valid without them.

alter table public.customizer_assets
  add column if not exists source_provider text,
  add column if not exists source_key text,
  add column if not exists source_collection text,
  add column if not exists source_license text,
  add column if not exists source_license_url text,
  add column if not exists source_license_spdx text,
  add column if not exists source_author text;

-- One permanent Husnalogy asset per external icon. Partial, so the countless
-- local assets with no provenance are unaffected by the constraint. This is
-- what makes a concurrent double-import resolve to a single winner rather than
-- creating duplicate storage objects.
create unique index if not exists customizer_assets_source_identity_key
  on public.customizer_assets (source_provider, source_key)
  where source_provider is not null and source_key is not null;

-- Admin library filtering by provider ("show me everything imported from
-- Iconify") and by collection.
create index if not exists customizer_assets_source_provider_idx
  on public.customizer_assets (source_provider)
  where source_provider is not null;

create index if not exists customizer_assets_source_collection_idx
  on public.customizer_assets (source_collection)
  where source_collection is not null;

comment on column public.customizer_assets.source_provider is
  'External origin of an imported asset, e.g. "iconify". Null for local uploads.';
comment on column public.customizer_assets.source_key is
  'Canonical upstream identity, e.g. "mdi:heart-outline". Null for local uploads.';
comment on column public.customizer_assets.source_license_spdx is
  'SPDX identifier recorded AT IMPORT TIME; never refreshed from upstream.';
