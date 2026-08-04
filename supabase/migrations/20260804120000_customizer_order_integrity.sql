-- ---------------------------------------------------------------------------
-- Customized order integrity hardening.
--
-- 1. Permanent order design snapshots become unique per (order item,
--    customization) so a retried checkout can never duplicate them.
-- 2. Snapshots gain operational render columns (error code/message, attempt
--    count, queue timestamps) so a queue failure is visible instead of silent.
-- 3. Render jobs link directly to the immutable snapshot they must render, so
--    production output is frozen to the order rather than the live draft.
-- 4. Orders gain a separate personalized production status that never collides
--    with the customer-facing order status.
-- 5. product_customizations gains a revision counter for optimistic
--    concurrency between browser tabs.
-- 6. create_customized_order() inserts the order, its items and every required
--    snapshot inside a single transaction, returning the real order_items.id
--    each snapshot was attached to.
--
-- Safe and idempotent: every statement guards with if not exists / drop if
-- exists and no existing row is modified destructively.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Order design snapshots: operational render metadata
-- ---------------------------------------------------------------------------

alter table public.order_design_snapshots
  add column if not exists render_error_code text,
  add column if not exists render_error_message text,
  add column if not exists render_attempt_count integer not null default 0,
  add column if not exists last_render_attempt_at timestamp with time zone,
  add column if not exists render_queued_at timestamp with time zone,
  add column if not exists manual_review_requested_at timestamp with time zone,
  add column if not exists manual_review_note text;

-- 'queue_failed' records a snapshot whose print job could not be enqueued, and
-- 'attention_required' is set by an admin. Neither may be left implicit: a
-- snapshot is never allowed to sit at 'pending' when no job exists.
alter table public.order_design_snapshots
  drop constraint if exists order_design_snapshots_render_status_check;
alter table public.order_design_snapshots
  add constraint order_design_snapshots_render_status_check
  check (render_status in (
    'pending', 'queued', 'processing', 'completed', 'failed',
    'queue_failed', 'attention_required', 'not_required', 'archived'
  ));

-- Duplicate protection. order_item_id is nullable (a snapshot survives its
-- order item being detached), so the pair is guarded with a partial index and
-- the order/customization pair is guarded unconditionally.
create unique index if not exists uniq_order_design_snapshot_order_customization
  on public.order_design_snapshots(order_id, customization_id)
  where customization_id is not null;

create unique index if not exists uniq_order_design_snapshot_item_customization
  on public.order_design_snapshots(order_item_id, customization_id)
  where order_item_id is not null and customization_id is not null;

-- Render health lookups: "which snapshots need attention" must not table scan.
create index if not exists idx_order_design_snapshots_render_status
  on public.order_design_snapshots(render_status, created_at desc);
create index if not exists idx_order_design_snapshots_order_item
  on public.order_design_snapshots(order_item_id)
  where order_item_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Snapshot immutability: widen the mutable allow-list to the new
--    operational columns only. Design identity stays frozen.
-- ---------------------------------------------------------------------------

create or replace function public.protect_order_design_snapshot_identity()
returns trigger language plpgsql as $$
declare
  mutable_columns text[] := array[
    'print_files', 'preview_files', 'render_status', 'updated_at',
    'render_error_code', 'render_error_message', 'render_attempt_count',
    'last_render_attempt_at', 'render_queued_at',
    'manual_review_requested_at', 'manual_review_note'
  ];
begin
  if (to_jsonb(new) - mutable_columns) is distinct from (to_jsonb(old) - mutable_columns) then
    raise exception 'order design snapshots are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_order_design_snapshot_identity on public.order_design_snapshots;
create trigger protect_order_design_snapshot_identity before update on public.order_design_snapshots
for each row execute function public.protect_order_design_snapshot_identity();

-- ---------------------------------------------------------------------------
-- 3. Render jobs link to the frozen snapshot they render
-- ---------------------------------------------------------------------------

alter table public.customizer_render_jobs
  add column if not exists snapshot_id uuid references public.order_design_snapshots(id) on delete set null,
  add column if not exists order_item_id uuid references public.order_items(id) on delete set null;

create index if not exists idx_render_jobs_snapshot
  on public.customizer_render_jobs(snapshot_id)
  where snapshot_id is not null;
create index if not exists idx_render_jobs_order
  on public.customizer_render_jobs(order_id, job_type)
  where order_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Personalized production status, kept separate from orders.status
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists production_status text not null default 'not_required',
  add column if not exists idempotency_key text;

alter table public.orders
  drop constraint if exists orders_production_status_check;
alter table public.orders
  add constraint orders_production_status_check
  check (production_status in (
    'not_required', 'snapshot_pending', 'snapshot_ready', 'render_queued',
    'rendering', 'render_ready', 'attention_required', 'failed'
  ));

-- A retried checkout submission reuses the same order instead of creating a
-- second one.
create unique index if not exists uniq_orders_idempotency_key
  on public.orders(idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_orders_production_status
  on public.orders(production_status, created_at desc)
  where production_status <> 'not_required';

-- ---------------------------------------------------------------------------
-- 5. Optimistic concurrency for customer drafts
-- ---------------------------------------------------------------------------

alter table public.product_customizations
  add column if not exists revision integer not null default 0;

create or replace function public.bump_product_customization_revision()
returns trigger language plpgsql as $$
begin
  -- Only advance for real content changes so bookkeeping updates (marking a
  -- draft ordered, attaching print files) do not invalidate an open editor.
  if new.values is distinct from old.values
     or new.render_data is distinct from old.render_data
     or new.selected_options is distinct from old.selected_options
     or new.uploaded_files is distinct from old.uploaded_files then
    new.revision := coalesce(old.revision, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_product_customization_revision on public.product_customizations;
create trigger bump_product_customization_revision before update on public.product_customizations
for each row execute function public.bump_product_customization_revision();

-- ---------------------------------------------------------------------------
-- 6. Transactional customized order creation.
--
-- The trusted server builds and validates every snapshot payload first, then
-- calls this function once. The order, its items and all required snapshots
-- commit together or not at all, and each snapshot is attached to the real
-- order_items.id rather than a client-supplied identifier.
-- ---------------------------------------------------------------------------

create or replace function public.create_customized_order(
  p_order jsonb,
  p_items jsonb,
  p_snapshots jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id text;
  v_item jsonb;
  v_snapshot jsonb;
  v_item_id uuid;
  v_item_refs jsonb := '{}'::jsonb;
  v_snapshot_results jsonb := '[]'::jsonb;
  v_snapshot_id uuid;
  v_existing_order public.orders;
  v_idempotency_key text;
  v_expected_snapshots integer;
  v_inserted_snapshots integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  v_idempotency_key := nullif(p_order->>'idempotency_key', '');

  -- Idempotent replay: an identical retried submission returns the order that
  -- already exists instead of creating a duplicate.
  if v_idempotency_key is not null then
    select * into v_existing_order from public.orders where idempotency_key = v_idempotency_key;
    if found then
      return jsonb_build_object(
        'order_id', v_existing_order.id,
        'reused', true,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('id', oi.id) order by oi.created_at)
          from public.order_items oi where oi.order_id = v_existing_order.id
        ), '[]'::jsonb),
        'snapshots', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id,
            'order_item_id', s.order_item_id,
            'customization_id', s.customization_id
          ))
          from public.order_design_snapshots s where s.order_id = v_existing_order.id
        ), '[]'::jsonb)
      );
    end if;
  end if;

  v_order_id := p_order->>'id';
  if v_order_id is null or v_order_id = '' then
    raise exception 'order id is required';
  end if;

  insert into public.orders (
    id, customer_id, customer_name, customer_email, customer_phone,
    product_id, product_title, product_slug,
    subtotal, delivery_charge, total, payment_status, status,
    message, address, customization_details, uploaded_files, metadata,
    production_status, idempotency_key, created_at, updated_at
  ) values (
    v_order_id,
    nullif(p_order->>'customer_id', '')::uuid,
    p_order->>'customer_name',
    p_order->>'customer_email',
    nullif(p_order->>'customer_phone', ''),
    nullif(p_order->>'product_id', ''),
    p_order->>'product_title',
    nullif(p_order->>'product_slug', ''),
    coalesce((p_order->>'subtotal')::numeric, 0),
    coalesce((p_order->>'delivery_charge')::numeric, 0),
    coalesce((p_order->>'total')::numeric, 0),
    coalesce(p_order->>'payment_status', 'unpaid'),
    coalesce(p_order->>'status', 'pending'),
    nullif(p_order->>'message', ''),
    coalesce(p_order->'address', '{}'::jsonb),
    coalesce(p_order->'customization_details', '{}'::jsonb),
    coalesce(p_order->'uploaded_files', '{}'::jsonb),
    coalesce(p_order->'metadata', '{}'::jsonb),
    coalesce(p_order->>'production_status', 'not_required'),
    v_idempotency_key,
    coalesce((p_order->>'created_at')::timestamptz, now()),
    coalesce((p_order->>'updated_at')::timestamptz, now())
  );

  -- Order items, remembering the real id each client "ref" maps to.
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.order_items (
      order_id, product_id, product_slug, product_title, product_image,
      quantity, unit_price, line_total,
      selected_options, customization_values, uploaded_files, preview_data, metadata
    ) values (
      v_order_id,
      nullif(v_item->>'product_id', ''),
      nullif(v_item->>'product_slug', ''),
      coalesce(nullif(v_item->>'product_title', ''), 'Order item'),
      nullif(v_item->>'product_image', ''),
      coalesce((v_item->>'quantity')::integer, 1),
      coalesce((v_item->>'unit_price')::numeric, 0),
      coalesce((v_item->>'line_total')::numeric, 0),
      coalesce(v_item->'selected_options', '{}'::jsonb),
      coalesce(v_item->'customization_values', '{}'::jsonb),
      coalesce(v_item->'uploaded_files', '{}'::jsonb),
      coalesce(v_item->'preview_data', '{}'::jsonb),
      coalesce(v_item->'metadata', '{}'::jsonb)
    )
    returning id into v_item_id;

    v_item_refs := v_item_refs || jsonb_build_object(coalesce(v_item->>'ref', v_item_id::text), v_item_id::text);
  end loop;

  -- Required snapshots. Every payload must resolve to a real order item.
  v_expected_snapshots := jsonb_array_length(coalesce(p_snapshots, '[]'::jsonb));

  for v_snapshot in select * from jsonb_array_elements(coalesce(p_snapshots, '[]'::jsonb))
  loop
    v_item_id := nullif(v_item_refs->>(v_snapshot->>'item_ref'), '')::uuid;
    if v_item_id is null then
      raise exception 'snapshot for customization % has no matching order item (ref %)',
        v_snapshot->>'customization_id', v_snapshot->>'item_ref';
    end if;

    insert into public.order_design_snapshots (
      order_id, order_item_id, customization_id, product_id, product_title, product_sku,
      quantity, selected_options, pricing,
      template_id, template_version, template_version_id,
      snapshot, preflight, preview_files, print_files,
      render_status, integrity_hash
    ) values (
      v_order_id,
      v_item_id,
      nullif(v_snapshot->>'customization_id', '')::uuid,
      nullif(v_snapshot->>'product_id', ''),
      v_snapshot->>'product_title',
      v_snapshot->>'product_sku',
      coalesce((v_snapshot->>'quantity')::integer, 1),
      coalesce(v_snapshot->'selected_options', '{}'::jsonb),
      coalesce(v_snapshot->'pricing', '{}'::jsonb),
      nullif(v_snapshot->>'template_id', '')::uuid,
      coalesce((v_snapshot->>'template_version')::integer, 1),
      nullif(v_snapshot->>'template_version_id', '')::uuid,
      coalesce(v_snapshot->'snapshot', '{}'::jsonb),
      coalesce(v_snapshot->'preflight', '{}'::jsonb),
      coalesce(v_snapshot->'preview_files', '{}'::jsonb),
      coalesce(v_snapshot->'print_files', '{}'::jsonb),
      coalesce(v_snapshot->>'render_status', 'pending'),
      v_snapshot->>'integrity_hash'
    )
    returning id into v_snapshot_id;

    v_inserted_snapshots := v_inserted_snapshots + 1;
    v_snapshot_results := v_snapshot_results || jsonb_build_object(
      'id', v_snapshot_id,
      'order_item_id', v_item_id,
      'customization_id', v_snapshot->>'customization_id',
      'item_ref', v_snapshot->>'item_ref'
    );
  end loop;

  -- Belt and braces: refuse to commit a customized order that lost a snapshot.
  if v_inserted_snapshots <> v_expected_snapshots then
    raise exception 'expected % order design snapshots but inserted %',
      v_expected_snapshots, v_inserted_snapshots;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'reused', false,
    'item_refs', v_item_refs,
    'snapshots', v_snapshot_results
  );
end;
$$;

revoke all on function public.create_customized_order(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_customized_order(jsonb, jsonb, jsonb) to service_role;

comment on function public.create_customized_order(jsonb, jsonb, jsonb) is
  'Inserts an order, its items and every required immutable design snapshot in one transaction. Snapshots are attached to the real order_items.id. Idempotent on orders.idempotency_key.';

comment on column public.order_design_snapshots.render_error_code is
  'Canonical render failure code (queue or worker). Never shown to customers.';
comment on column public.customizer_render_jobs.snapshot_id is
  'The immutable order design snapshot this production job must render. Preview jobs leave this null and use the live customization.';
comment on column public.orders.production_status is
  'Personalized production lifecycle, separate from the customer-facing order status.';
comment on column public.product_customizations.revision is
  'Optimistic concurrency token; advanced by trigger on real content changes.';
