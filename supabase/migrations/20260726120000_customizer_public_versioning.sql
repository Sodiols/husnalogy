-- Separate the immutable internal snapshot sequence (`version`) from the
-- administrator/customer-facing release identifier (`major_version`,
-- `minor_revision`). Existing snapshot IDs and foreign-key references remain
-- untouched.

alter table public.customizer_template_versions
  add column if not exists major_version integer,
  add column if not exists minor_revision integer;

-- Preserve every legacy snapshot. Older snapshots become the immutable
-- Version 1 history; the current snapshot becomes Version 2 as requested.
with ranked as (
  select
    id,
    row_number() over (partition by template_id order by version, created_at, id) - 1 as legacy_revision,
    count(*) over (partition by template_id) as snapshot_count
  from public.customizer_template_versions
  where major_version is null or minor_revision is null
)
update public.customizer_template_versions versions
set
  major_version = case when ranked.legacy_revision = ranked.snapshot_count - 1 then 2 else 1 end,
  minor_revision = case when ranked.legacy_revision = ranked.snapshot_count - 1 then 0 else ranked.legacy_revision end
from ranked
where versions.id = ranked.id;

alter table public.customizer_template_versions
  alter column major_version set default 2,
  alter column major_version set not null,
  alter column minor_revision set default 0,
  alter column minor_revision set not null;

alter table public.customizer_template_versions
  drop constraint if exists customizer_template_versions_major_version_check,
  add constraint customizer_template_versions_major_version_check check (major_version >= 1),
  drop constraint if exists customizer_template_versions_minor_revision_check,
  add constraint customizer_template_versions_minor_revision_check check (minor_revision >= 0);

create unique index if not exists uq_customizer_template_public_version
  on public.customizer_template_versions(template_id, major_version, minor_revision);

create or replace function public.publish_customizer_template_version(
  p_template_id uuid,
  p_product_id text,
  p_update_type text,
  p_schema_version integer,
  p_engine_version text,
  p_document jsonb,
  p_font_dependencies jsonb,
  p_published_by uuid default null,
  p_notes text default ''
)
returns public.customizer_template_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  latest public.customizer_template_versions;
  published public.customizer_template_versions;
  next_internal_version integer;
  next_major integer;
  next_revision integer;
begin
  if p_update_type not in ('minor', 'major') then
    raise exception 'Invalid customizer update type';
  end if;

  -- Serialize publications for this template, including its first publish.
  perform pg_advisory_xact_lock(hashtextextended(p_template_id::text, 0));

  select *
  into latest
  from public.customizer_template_versions
  where template_id = p_template_id
  order by version desc
  limit 1;

  select greatest(
    coalesce(max(version), 0),
    coalesce((select version from public.product_customizer_templates where id = p_template_id), 0)
  ) + 1
  into next_internal_version
  from public.customizer_template_versions
  where template_id = p_template_id;

  if latest.id is null then
    next_major := case when p_update_type = 'major' then 3 else 2 end;
    next_revision := case when p_update_type = 'minor' then 1 else 0 end;
  elsif p_update_type = 'major' then
    next_major := latest.major_version + 1;
    next_revision := 0;
  else
    next_major := latest.major_version;
    next_revision := latest.minor_revision + 1;
  end if;

  insert into public.customizer_template_versions (
    template_id, product_id, version, major_version, minor_revision,
    schema_version, engine_version, document, font_dependencies,
    published_by, notes
  ) values (
    p_template_id, p_product_id, next_internal_version, next_major, next_revision,
    p_schema_version, p_engine_version,
    jsonb_set(p_document, '{templateVersion}', to_jsonb(next_internal_version), true),
    p_font_dependencies, p_published_by, left(coalesce(p_notes, ''), 2000)
  )
  returning * into published;

  -- This is an internal snapshot reference only. Draft saves never change it.
  update public.product_customizer_templates
  set version = next_internal_version
  where id = p_template_id;

  return published;
end;
$$;

revoke all on function public.publish_customizer_template_version(uuid, text, text, integer, text, jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.publish_customizer_template_version(uuid, text, text, integer, text, jsonb, jsonb, uuid, text) to service_role;

create or replace function public.prevent_customizer_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Published customizer versions are immutable';
end;
$$;

drop trigger if exists prevent_customizer_version_mutation on public.customizer_template_versions;
create trigger prevent_customizer_version_mutation
before update or delete on public.customizer_template_versions
for each row execute function public.prevent_customizer_version_mutation();
