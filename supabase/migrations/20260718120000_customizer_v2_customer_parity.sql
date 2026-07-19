-- Husnalogy Customizer V2 customer-editor parity.
-- Additive only: existing template snapshots, customizations, cart rows, orders,
-- render outputs, and storage objects are deliberately left untouched.

-- New publications default to the current document schema. Historical rows
-- retain their original schema_version and continue through the migration path.
alter table public.customizer_template_versions
  alter column schema_version set default 4;

-- Keep the JSON document used by the application as the single canonical
-- customer state. This constraint protects new writes without rewriting legacy
-- rows; layer visibility, customer locks, groups, filters and inserted objects
-- live inside render_data.editorState.
alter table public.product_customizations
  drop constraint if exists product_customizations_render_data_object_check;
alter table public.product_customizations
  add constraint product_customizations_render_data_object_check
  check (render_data is null or jsonb_typeof(render_data) = 'object') not valid;
create index if not exists idx_product_customizations_render_data_gin
  on public.product_customizations using gin (render_data jsonb_path_ops);

-- Database-authoritative staged rollout flags for the customer parity tools.
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
  ));

insert into public.customizer_feature_flags(product_id,flag,enabled,scope,scope_key,rollout_percentage)
values
  (null,'customizer_v2_customer_layers',false,'global','*',100),
  (null,'customizer_v2_customer_multiselect',false,'global','*',100),
  (null,'customizer_v2_customer_grouping',false,'global','*',100),
  (null,'customizer_v2_qr_codes',false,'global','*',100),
  (null,'customizer_v2_customer_shapes',false,'global','*',100),
  (null,'customizer_v2_customer_lines',false,'global','*',100),
  (null,'customizer_v2_customer_frames',false,'global','*',100),
  (null,'customizer_v2_customer_grids',false,'global','*',100),
  (null,'customizer_v2_image_filters',false,'global','*',100),
  (null,'customizer_v2_product_preview_editing',false,'global','*',100),
  (null,'customizer_v2_split_view',false,'global','*',100)
on conflict (scope,scope_key,flag) do nothing;

-- Append-only customer/customizer audit trail. Details may include the editor
-- state schema, affected layer IDs and typed validation violations, but never
-- binary uploads or signed asset URLs.
create table if not exists public.customizer_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  customization_id uuid references public.product_customizations(id) on delete set null,
  product_id text references public.products(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  layer_ids text[] not null default '{}',
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_customizer_audit_logs_actor_created
  on public.customizer_audit_logs(actor_id, created_at desc);
create index if not exists idx_customizer_audit_logs_customization_created
  on public.customizer_audit_logs(customization_id, created_at desc);
create index if not exists idx_customizer_audit_logs_product_created
  on public.customizer_audit_logs(product_id, created_at desc);

alter table public.customizer_audit_logs enable row level security;
drop policy if exists "customizer_audit_logs_owner_read" on public.customizer_audit_logs;
create policy "customizer_audit_logs_owner_read" on public.customizer_audit_logs
  for select using (actor_id = auth.uid() or public.is_admin());
drop policy if exists "customizer_audit_logs_actor_insert" on public.customizer_audit_logs;
create policy "customizer_audit_logs_actor_insert" on public.customizer_audit_logs
  for insert with check (actor_id = auth.uid() or public.is_admin());

revoke all on public.customizer_audit_logs from anon;
grant select,insert on public.customizer_audit_logs to authenticated;
grant all on public.customizer_audit_logs to service_role;
