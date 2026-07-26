-- Husnalogy Customizer V2 schema consolidation and operational metadata.
-- Additive only. This migration does not delete or rewrite templates,
-- customizations, customer assets, carts, orders, snapshots, or render files.

-- Authoritative naming decisions:
--   product_customizer_templates = mutable product template/draft
--   customizer_template_versions = immutable published template versions
--   customizer_mockup_templates.status/version = draft and published mockup versions
-- Separate customizer_templates, customizer_template_drafts, and
-- customizer_mockup_versions tables are intentionally not created because they
-- would duplicate those responsibilities and split existing data.

alter table public.customizer_mockup_overlays
  add column if not exists updated_at timestamp with time zone not null default now();

-- Reassert the complete application feature-flag contract. Earlier revisions
-- of the hardening migration allowed only the original server-side flags and
-- could fail when customer-editor rollout flags were already present.
alter table public.customizer_feature_flags
  drop constraint if exists customizer_feature_flags_flag_check;
alter table public.customizer_feature_flags
  add constraint customizer_feature_flags_flag_check check (flag in (
    'customizer_v2',
    'customizer_v2_grids',
    'customizer_v2_groups',
    'customizer_v2_mockups',
    'customizer_v2_perspective_mockups',
    'customizer_v2_server_rendering',
    'customizer_v2_print_pdf',
    'customizer_v2_customer_layers',
    'customizer_v2_customer_multiselect',
    'customizer_v2_customer_grouping',
    'customizer_v2_qr_codes',
    'customizer_v2_customer_shapes',
    'customizer_v2_customer_lines',
    'customizer_v2_customer_frames',
    'customizer_v2_customer_grids',
    'customizer_v2_image_filters',
    'customizer_v2_product_preview_editing',
    'customizer_v2_split_view'
  )) not valid;
do $$
begin
  alter table public.customizer_feature_flags
    validate constraint customizer_feature_flags_flag_check;
exception
  when check_violation then
    raise warning 'customizer_feature_flags contains legacy flag names; preserving those rows and leaving customizer_feature_flags_flag_check not valid';
end $$;

drop trigger if exists set_customizer_guides_updated_at on public.customizer_guides;
create trigger set_customizer_guides_updated_at
before update on public.customizer_guides
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_mockup_views_updated_at on public.customizer_mockup_views;
create trigger set_customizer_mockup_views_updated_at
before update on public.customizer_mockup_views
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_mockup_artwork_areas_updated_at on public.customizer_mockup_artwork_areas;
create trigger set_customizer_mockup_artwork_areas_updated_at
before update on public.customizer_mockup_artwork_areas
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_mockup_overlays_updated_at on public.customizer_mockup_overlays;
create trigger set_customizer_mockup_overlays_updated_at
before update on public.customizer_mockup_overlays
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_feature_flags_updated_at on public.customizer_feature_flags;
create trigger set_customizer_feature_flags_updated_at
before update on public.customizer_feature_flags
for each row execute function public.set_updated_at();

create index if not exists idx_product_customizations_template_version
  on public.product_customizations(template_id, template_version);
create index if not exists idx_customizer_template_versions_publisher
  on public.customizer_template_versions(published_by) where published_by is not null;
create index if not exists idx_customizer_feature_flags_scope_lookup
  on public.customizer_feature_flags(flag, scope, scope_key, enabled);
create index if not exists idx_customizer_mockup_templates_status
  on public.customizer_mockup_templates(product_id, status, active, version desc);

comment on table public.product_customizer_templates is
  'Authoritative mutable Customizer template draft for one product. Published snapshots live in customizer_template_versions.';
comment on table public.product_customizations is
  'Customer-owned Customizer values and sanitized editor state; cart/order references retain the exact template version.';
comment on table public.customizer_template_versions is
  'Immutable published CustomizerDocument snapshots used by saved designs, rendering, and order snapshots.';
comment on table public.customer_asset_library is
  'Private reusable customer uploads. Object paths remain owner scoped and URLs are signed on demand.';
comment on table public.customizer_mockup_templates is
  'Versioned mockup root. The status column distinguishes mutable draft, published, and archived versions.';
comment on table public.customizer_render_jobs is
  'Lease-based render queue. Claim and recovery functions are executable only by the service role.';
comment on table public.customizer_render_outputs is
  'Verified private preview, mockup, PNG, PDF, or SVG output metadata; binary files live in Storage.';
comment on table public.order_design_snapshots is
  'Immutable order-time design identity and document snapshot. Only render lifecycle fields may advance.';
comment on table public.customizer_feature_flags is
  'Database-authoritative staged rollout flags resolved by product, product type, and global scope.';
comment on table public.customizer_audit_logs is
  'Append-only customer/admin Customizer audit metadata. Never store signed URLs or binary payloads.';

-- Reassert least-privilege grants for the tables added after the original V2
-- migration. RLS remains authoritative for anon/authenticated callers; the
-- service_role bypasses RLS by design and has no user-facing policy.
revoke all on public.customizer_audit_logs from anon;
grant select, insert on public.customizer_audit_logs to authenticated;
grant all on public.customizer_audit_logs to service_role;

grant select on public.customizer_mockup_views,
  public.customizer_mockup_artwork_areas,
  public.customizer_mockup_overlays to anon, authenticated;
grant all on public.customizer_mockup_views,
  public.customizer_mockup_artwork_areas,
  public.customizer_mockup_overlays,
  public.customizer_feature_flags to service_role;
