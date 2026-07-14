-- Husnalogy Customizer V2 production hardening.
-- Additive/backward-compatible: existing customizations, order snapshots,
-- legacy mockup JSON, and files remain readable.

alter table public.product_customizations
  add column if not exists asset_references jsonb not null default '[]'::jsonb;

-- -------------------------------------------------------------------------
-- Normalized, versioned mockup scenes
-- -------------------------------------------------------------------------

alter table public.customizer_mockup_templates
  add column if not exists product_type text not null default 'flat-card',
  add column if not exists version integer not null default 1,
  add column if not exists status text not null default 'draft';

alter table public.customizer_mockup_templates drop constraint if exists customizer_mockup_templates_status_check;
alter table public.customizer_mockup_templates add constraint customizer_mockup_templates_status_check check (status in ('draft','published','archived'));
update public.customizer_mockup_templates set status = 'published' where active and status = 'draft';

alter table public.customizer_mockup_views
  add column if not exists requires_transparency boolean not null default false;

alter table public.customizer_mockup_artwork_areas
  add column if not exists visible boolean not null default true,
  add column if not exists locked boolean not null default false;
alter table public.customizer_mockup_artwork_areas drop constraint if exists customizer_mockup_artwork_areas_warp_type_check;
alter table public.customizer_mockup_artwork_areas add constraint customizer_mockup_artwork_areas_warp_type_check check (warp_type in ('none','perspective','cylinder','custom'));

alter table public.customizer_mockup_overlays
  add column if not exists visible boolean not null default true,
  add column if not exists locked boolean not null default false,
  add column if not exists updated_at timestamp with time zone not null default now();

create unique index if not exists uq_customizer_mockup_product_version on public.customizer_mockup_templates(product_id, version);
create unique index if not exists uq_customizer_mockup_product_draft on public.customizer_mockup_templates(product_id) where status = 'draft' and active;
create unique index if not exists uq_customizer_mockup_product_published on public.customizer_mockup_templates(product_id) where status = 'published' and active;

drop policy if exists "customizer_mockup_templates_read" on public.customizer_mockup_templates;
create policy "customizer_mockup_templates_read" on public.customizer_mockup_templates for select using ((active and status = 'published') or public.is_admin());
drop policy if exists "customizer_mockup_views_public_read" on public.customizer_mockup_views;
create policy "customizer_mockup_views_public_read" on public.customizer_mockup_views for select using (
  exists (select 1 from public.customizer_mockup_templates t where t.id = mockup_template_id and t.active and t.status = 'published')
);
drop policy if exists "customizer_mockup_artwork_areas_public_read" on public.customizer_mockup_artwork_areas;
create policy "customizer_mockup_artwork_areas_public_read" on public.customizer_mockup_artwork_areas for select using (
  exists (select 1 from public.customizer_mockup_views v join public.customizer_mockup_templates t on t.id = v.mockup_template_id where v.id = mockup_view_id and v.active and t.active and t.status = 'published')
);
drop policy if exists "customizer_mockup_overlays_public_read" on public.customizer_mockup_overlays;
create policy "customizer_mockup_overlays_public_read" on public.customizer_mockup_overlays for select using (
  exists (select 1 from public.customizer_mockup_views v join public.customizer_mockup_templates t on t.id = v.mockup_template_id where v.id = mockup_view_id and v.active and t.active and t.status = 'published')
);

create or replace function public.upsert_customizer_mockup(p_product_id text, p_payload jsonb, p_publish boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
  v_view_id uuid;
  v_view jsonb;
  v_area jsonb;
  v_overlay jsonb;
  v_version integer;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'administrator access required';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'product not found';
  end if;

  select id into v_template_id from public.customizer_mockup_templates
    where product_id = p_product_id and status = 'draft' and active order by updated_at desc limit 1 for update;
  select coalesce(max(version), 0) + 1 into v_version from public.customizer_mockup_templates where product_id = p_product_id and status <> 'draft';

  if v_template_id is null then
    insert into public.customizer_mockup_templates(product_id, product_type, name, view, config, version, status, active)
    values (
      p_product_id,
      coalesce(nullif(p_payload->>'productType',''), 'flat-card'),
      coalesce(nullif(p_payload->>'name',''), 'Product mockup'),
      coalesce(p_payload#>>'{views,0,id}', 'front'),
      jsonb_build_object('width', coalesce((p_payload->>'width')::integer,1600), 'height', coalesce((p_payload->>'height')::integer,1200)),
      v_version,
      'draft',
      true
    ) returning id into v_template_id;
  else
    update public.customizer_mockup_templates set
      product_type = coalesce(nullif(p_payload->>'productType',''), product_type),
      name = coalesce(nullif(p_payload->>'name',''), name),
      view = coalesce(p_payload#>>'{views,0,id}', view),
      config = jsonb_build_object('width', coalesce((p_payload->>'width')::integer,1600), 'height', coalesce((p_payload->>'height')::integer,1200)),
      version = v_version,
      updated_at = now()
    where id = v_template_id;
  end if;

  delete from public.customizer_mockup_views where mockup_template_id = v_template_id;
  for v_view in select value from jsonb_array_elements(coalesce(p_payload->'views','[]'::jsonb)) loop
    insert into public.customizer_mockup_views(mockup_template_id,name,base_image_url,width,height,sort_order,active,requires_transparency)
    values (
      v_template_id,
      coalesce(nullif(v_view->>'name',''), 'Mockup view'),
      nullif(v_view->>'baseImageUrl',''),
      coalesce((v_view->>'width')::integer,(p_payload->>'width')::integer,1600),
      coalesce((v_view->>'height')::integer,(p_payload->>'height')::integer,1200),
      coalesce((v_view->>'sortOrder')::integer,0),
      true,
      coalesce((v_view->>'requiresTransparency')::boolean,false)
    ) returning id into v_view_id;

    for v_area in select value from jsonb_array_elements(coalesce(v_view->'artworkAreas','[]'::jsonb)) loop
      insert into public.customizer_mockup_artwork_areas(
        mockup_view_id,source_page_id,x,y,width,height,rotation,clip_path,perspective_points,warp_type,opacity,blend_mode,sort_order,visible,locked
      ) values (
        v_view_id,
        coalesce(nullif(v_area->>'sourcePageId',''),'front'),
        coalesce((v_area->>'x')::numeric,0), coalesce((v_area->>'y')::numeric,0),
        greatest(1,coalesce((v_area->>'width')::numeric,1)), greatest(1,coalesce((v_area->>'height')::numeric,1)),
        coalesce((v_area->>'rotation')::numeric,0), nullif(v_area->>'clipPath',''), v_area->'perspectivePoints',
        coalesce(nullif(v_area->>'warpType',''),'none'), coalesce((v_area->>'opacity')::numeric,1), nullif(v_area->>'blendMode',''),
        coalesce((v_area->>'sortOrder')::integer,0), coalesce((v_area->>'visible')::boolean,true), coalesce((v_area->>'locked')::boolean,false)
      );
    end loop;

    for v_overlay in select value from jsonb_array_elements(coalesce(v_view->'overlays','[]'::jsonb)) loop
      insert into public.customizer_mockup_overlays(mockup_view_id,src,overlay_type,opacity,blend_mode,sort_order,visible,locked)
      values (
        v_view_id, nullif(v_overlay->>'src',''), coalesce(nullif(v_overlay->>'type',''),'shadow'),
        coalesce((v_overlay->>'opacity')::numeric,1), nullif(v_overlay->>'blendMode',''), coalesce((v_overlay->>'sortOrder')::integer,0),
        coalesce((v_overlay->>'visible')::boolean,true), coalesce((v_overlay->>'locked')::boolean,false)
      );
    end loop;
  end loop;

  if p_publish then
    update public.customizer_mockup_templates set status = 'archived', active = false, updated_at = now()
      where product_id = p_product_id and status = 'published' and id <> v_template_id;
    update public.customizer_mockup_templates set status = 'published', active = true, version = v_version, updated_at = now() where id = v_template_id;
  end if;
  return v_template_id;
end;
$$;
revoke all on function public.upsert_customizer_mockup(text,jsonb,boolean) from public, anon;
grant execute on function public.upsert_customizer_mockup(text,jsonb,boolean) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- Database-authoritative feature flags
-- -------------------------------------------------------------------------

alter table public.customizer_feature_flags drop constraint if exists customizer_feature_flags_flag_check;
alter table public.customizer_feature_flags drop constraint if exists customizer_feature_flags_product_id_flag_key;
alter table public.customizer_feature_flags
  add column if not exists scope text not null default 'product',
  add column if not exists scope_key text,
  add column if not exists product_type text,
  add column if not exists environments text[] not null default array['development','preview','production','test'],
  add column if not exists rollout_percentage integer not null default 100,
  add column if not exists admin_only boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.customizer_feature_flags set scope = case when product_id is null then 'global' else 'product' end where scope is null or scope = '';
update public.customizer_feature_flags set scope_key = case when scope = 'global' then '*' else coalesce(product_id, product_type, '*') end where scope_key is null or scope_key = '';
alter table public.customizer_feature_flags alter column scope_key set not null;
alter table public.customizer_feature_flags add constraint customizer_feature_flags_flag_check check (flag in (
  'customizer_v2','customizer_v2_grids','customizer_v2_groups','customizer_v2_mockups','customizer_v2_perspective_mockups','customizer_v2_server_rendering','customizer_v2_print_pdf'
));
alter table public.customizer_feature_flags add constraint customizer_feature_flags_scope_check check (scope in ('global','product_type','product'));
alter table public.customizer_feature_flags add constraint customizer_feature_flags_rollout_check check (rollout_percentage between 0 and 100);
create unique index if not exists uq_customizer_feature_flag_scope on public.customizer_feature_flags(scope,scope_key,flag);

insert into public.customizer_feature_flags(product_id,flag,enabled,scope,scope_key,rollout_percentage)
values
  (null,'customizer_v2',true,'global','*',100),
  (null,'customizer_v2_grids',false,'global','*',100),
  (null,'customizer_v2_groups',false,'global','*',100),
  (null,'customizer_v2_mockups',false,'global','*',100),
  (null,'customizer_v2_perspective_mockups',false,'global','*',100),
  (null,'customizer_v2_server_rendering',false,'global','*',100),
  (null,'customizer_v2_print_pdf',false,'global','*',100)
on conflict (scope,scope_key,flag) do nothing;

drop policy if exists "customizer_feature_flags_read" on public.customizer_feature_flags;
drop policy if exists "customizer_feature_flags_admin_read" on public.customizer_feature_flags;
create policy "customizer_feature_flags_admin_read" on public.customizer_feature_flags for select using (public.is_admin());
revoke all on public.customizer_feature_flags from anon;
revoke select on public.customizer_feature_flags from authenticated;
grant select,insert,update,delete on public.customizer_feature_flags to authenticated;
grant all on public.customizer_feature_flags to service_role;

-- -------------------------------------------------------------------------
-- Lease-based render jobs, recovery, cancellation, and verified outputs
-- -------------------------------------------------------------------------

alter table public.customizer_render_jobs
  add column if not exists locked_by text,
  add column if not exists lock_token uuid,
  add column if not exists lock_expires_at timestamp with time zone,
  add column if not exists heartbeat_at timestamp with time zone,
  add column if not exists next_attempt_at timestamp with time zone,
  add column if not exists cancel_requested_at timestamp with time zone;
alter table public.customizer_render_jobs drop constraint if exists customizer_render_jobs_status_check;
alter table public.customizer_render_jobs add constraint customizer_render_jobs_status_check check (status in ('queued','retrying','processing','completed','failed','cancelled'));

alter table public.customizer_render_outputs
  add column if not exists order_id text references public.orders(id) on delete set null,
  add column if not exists mockup_version integer,
  add column if not exists output_type text,
  add column if not exists mime_type text,
  add column if not exists input_hash text,
  add column if not exists status text not null default 'ready',
  add column if not exists expires_at timestamp with time zone,
  add column if not exists verified_at timestamp with time zone;
alter table public.customizer_render_outputs drop constraint if exists customizer_render_outputs_format_check;
alter table public.customizer_render_outputs add constraint customizer_render_outputs_format_check check (format in ('png','webp','pdf','svg'));
alter table public.customizer_render_outputs add constraint customizer_render_outputs_status_check check (status in ('writing','ready','invalid','expired'));

create index if not exists idx_render_jobs_lease on public.customizer_render_jobs(status,next_attempt_at,lock_expires_at,priority desc,created_at);
create index if not exists idx_render_outputs_input_hash on public.customizer_render_outputs(input_hash,output_type,status);

create or replace function public.claim_customizer_render_job(p_job_id uuid, p_worker_id text, p_lease_seconds integer default 120)
returns public.customizer_render_jobs
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.customizer_render_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.customizer_render_jobs set
    status = 'processing', locked_by = left(p_worker_id,120), lock_token = gen_random_uuid(),
    lock_expires_at = now() + make_interval(secs => greatest(30,least(p_lease_seconds,900))),
    heartbeat_at = now(), started_at = coalesce(started_at,now()), updated_at = now()
  where id = p_job_id
    and cancel_requested_at is null
    and attempt_count < 3
    and (next_attempt_at is null or next_attempt_at <= now())
    and (status in ('queued','retrying','failed') or (status = 'processing' and lock_expires_at < now()))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.recover_abandoned_customizer_render_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.customizer_render_jobs set
    status = case when attempt_count >= 3 then 'failed' else 'retrying' end,
    error_code = 'WORKER_LEASE_EXPIRED', error_message = 'The render worker lease expired; the job was recovered.',
    locked_by = null, lock_token = null, lock_expires_at = null, next_attempt_at = case when attempt_count < 3 then now() else null end,
    updated_at = now()
  where status = 'processing' and lock_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.claim_customizer_render_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.recover_abandoned_customizer_render_jobs() from public,anon,authenticated;
grant execute on function public.claim_customizer_render_job(uuid,text,integer) to service_role;
grant execute on function public.recover_abandoned_customizer_render_jobs() to service_role;

-- Snapshot identity/design fields are immutable; only render lifecycle fields
-- may advance after order creation.
create or replace function public.protect_order_design_snapshot_identity()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['print_files','preview_files','render_status','updated_at'])
     is distinct from (to_jsonb(old) - array['print_files','preview_files','render_status','updated_at']) then
    raise exception 'order design snapshots are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_order_design_snapshot_identity on public.order_design_snapshots;
create trigger protect_order_design_snapshot_identity before update on public.order_design_snapshots
for each row execute function public.protect_order_design_snapshot_identity();

update storage.buckets set allowed_mime_types = array['image/png','image/webp','application/pdf','image/svg+xml'] where id = 'customizer-renders';
