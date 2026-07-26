\set ON_ERROR_STOP on

-- Strict live-database validator for the Husnalogy Customizer V2 schema.
-- Run read-only against an isolated restore, local Supabase, or confirmed
-- staging project. It raises on missing structure, RLS/policy gaps, invalid
-- foreign keys, orphan references, duplicate mockup roots, or missing private
-- Storage objects referenced by ready rows.

begin transaction read only;

do $$
declare
  item text;
  missing_count integer;
  required_tables text[] := array[
    'product_customizer_templates',
    'product_customizations',
    'customizer_template_versions',
    'customizer_asset_categories',
    'customizer_assets',
    'customer_asset_library',
    'customizer_mockup_templates',
    'customizer_mockup_views',
    'customizer_mockup_artwork_areas',
    'customizer_mockup_overlays',
    'customizer_guides',
    'customizer_render_jobs',
    'customizer_render_outputs',
    'customizer_preflight_results',
    'order_design_snapshots',
    'customizer_feature_flags',
    'customizer_audit_logs',
    'customizer_asset_folders'
  ];
  required_columns text[] := array[
    'product_customizer_templates.settings',
    'product_customizations.render_data',
    'product_customizations.template_version',
    'customizer_template_versions.schema_version',
    'customizer_template_versions.document',
    'customer_asset_library.editor_path',
    'customizer_mockup_templates.status',
    'customizer_mockup_templates.version',
    'customizer_mockup_artwork_areas.perspective_points',
    'customizer_mockup_overlays.updated_at',
    'customizer_render_jobs.lock_token',
    'customizer_render_jobs.lock_expires_at',
    'customizer_render_outputs.input_hash',
    'customizer_render_outputs.status',
    'order_design_snapshots.integrity_hash',
    'customizer_feature_flags.scope_key',
    'customizer_audit_logs.details',
    'customizer_assets.original_filename',
    'customizer_assets.thumbnail_path',
    'customizer_assets.editor_path',
    'customizer_assets.folder_id',
    'customizer_assets.admin_available',
    'customizer_assets.status',
    'customizer_assets.usage_count'
  ];
  required_indexes text[] := array[
    'idx_customizer_templates_product_id',
    'idx_product_customizations_template_version',
    'idx_ctv_template_id',
    'idx_customer_asset_library_user',
    'uq_customizer_mockup_product_version',
    'uq_customizer_mockup_product_draft',
    'uq_customizer_mockup_product_published',
    'idx_render_jobs_lease',
    'idx_render_outputs_input_hash',
    'uq_customizer_feature_flag_scope',
    'idx_customizer_audit_logs_customization_created',
    'idx_customizer_assets_checksum',
    'idx_customizer_assets_folder',
    'idx_customizer_assets_type_status'
  ];
  required_policies text[] := array[
    'public.product_customizer_templates.customizer_templates_public_read_active',
    'public.product_customizer_templates.customizer_templates_admin_manage',
    'public.product_customizations.product_customizations_owner_manage',
    'public.customizer_template_versions.customizer_template_versions_read',
    'public.customizer_assets.customizer_assets_read',
    'public.customizer_assets.customizer_assets_admin_manage',
    'public.customer_asset_library.customer_asset_library_owner',
    'public.customizer_render_jobs.customizer_render_jobs_owner_read',
    'public.customizer_render_outputs.customizer_render_outputs_owner_read',
    'public.customizer_preflight_results.customizer_preflight_results_owner_read',
    'public.order_design_snapshots.order_design_snapshots_admin',
    'public.customizer_mockup_templates.customizer_mockup_templates_read',
    'public.customizer_mockup_templates.customizer_mockup_templates_admin_manage',
    'public.customizer_feature_flags.customizer_feature_flags_admin_read',
    'public.customizer_feature_flags.customizer_feature_flags_admin_manage',
    'public.customizer_audit_logs.customizer_audit_logs_owner_read',
    'public.customizer_audit_logs.customizer_audit_logs_actor_insert',
    'public.customizer_asset_folders.customizer_asset_folders_admin_read',
    'public.customizer_asset_folders.customizer_asset_folders_admin_manage',
    'storage.objects.customizer_admin_assets_read',
    'storage.objects.customizer_admin_assets_insert',
    'storage.objects.customizer_admin_assets_update',
    'storage.objects.customizer_admin_assets_delete'
  ];
begin
  foreach item in array required_tables loop
    if to_regclass('public.' || item) is null then
      raise exception 'Missing required customizer table: public.%', item;
    end if;
  end loop;

  foreach item in array required_columns loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = split_part(item, '.', 1)
        and column_name = split_part(item, '.', 2)
    ) then
      raise exception 'Missing required customizer column: public.%', item;
    end if;
  end loop;

  foreach item in array required_indexes loop
    if to_regclass('public.' || item) is null then
      raise exception 'Missing required customizer index: public.%', item;
    end if;
  end loop;

  select count(*) into missing_count
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = any(required_tables)
    and relation.relkind = 'r'
    and not relation.relrowsecurity;
  if missing_count > 0 then
    raise exception '% required customizer tables do not have RLS enabled', missing_count;
  end if;

  foreach item in array required_policies loop
    if not exists (
      select 1 from pg_policies
      where schemaname = split_part(item, '.', 1)
        and tablename = split_part(item, '.', 2)
        and policyname = split_part(item, '.', 3)
    ) then
      raise exception 'Missing required customizer policy: %', item;
    end if;
  end loop;

  select count(*) into missing_count
  from pg_constraint constraint_row
  join pg_class relation on relation.oid = constraint_row.conrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = any(required_tables)
    and constraint_row.contype = 'f'
    and not constraint_row.convalidated;
  if missing_count > 0 then
    raise exception '% customizer foreign keys are not validated', missing_count;
  end if;

  select count(*) into missing_count
  from public.customizer_template_versions version_row
  left join public.product_customizer_templates template on template.id = version_row.template_id
  where template.id is null;
  if missing_count > 0 then raise exception '% orphan template versions found', missing_count; end if;

  select count(*) into missing_count
  from public.customer_asset_library asset
  left join public.profiles profile on profile.id = asset.user_id
  where profile.id is null;
  if missing_count > 0 then raise exception '% orphan customer asset rows found', missing_count; end if;

  select count(*) into missing_count
  from public.customizer_render_outputs output
  left join public.customizer_render_jobs job on job.id = output.job_id
  where job.id is null;
  if missing_count > 0 then raise exception '% orphan render outputs found', missing_count; end if;

  select count(*) into missing_count
  from public.order_design_snapshots snapshot
  left join public.orders order_row on order_row.id = snapshot.order_id
  where order_row.id is null;
  if missing_count > 0 then raise exception '% order snapshots reference missing orders', missing_count; end if;

  select count(*) into missing_count
  from (
    select product_id, status
    from public.customizer_mockup_templates
    where active and status in ('draft', 'published')
    group by product_id, status
    having count(*) > 1
  ) duplicates;
  if missing_count > 0 then raise exception '% duplicate active mockup roots found', missing_count; end if;

  select count(*) into missing_count
  from public.customizer_render_outputs output
  left join storage.objects object_row
    on object_row.bucket_id = output.bucket and object_row.name = output.path
  where output.status = 'ready' and object_row.id is null;
  if missing_count > 0 then raise exception '% ready render outputs reference missing Storage objects', missing_count; end if;

  select count(*) into missing_count
  from public.customer_asset_library asset
  left join storage.objects object_row
    on object_row.bucket_id = asset.bucket and object_row.name = asset.path
  where asset.status = 'ready' and object_row.id is null;
  if missing_count > 0 then raise exception '% ready customer assets reference missing Storage objects', missing_count; end if;

  if not exists (select 1 from storage.buckets where id = 'customizer-elements' and public = false) then
    raise exception 'customizer-elements Storage bucket is missing or public';
  end if;

  select count(*) into missing_count
  from public.customizer_assets asset
  cross join lateral (values
    (asset.path),
    (coalesce(asset.editor_path, asset.path)),
    (coalesce(asset.thumbnail_path, asset.editor_path, asset.path))
  ) referenced(path)
  left join storage.objects object_row
    on object_row.bucket_id = asset.bucket and object_row.name = referenced.path
  where asset.status in ('ready', 'archived') and object_row.id is null;
  if missing_count > 0 then raise exception '% administrator asset variants reference missing Storage objects', missing_count; end if;
end $$;

select 'customizer_database_validation_passed' as result,
  current_database() as database_name,
  now() as checked_at;

rollback;
