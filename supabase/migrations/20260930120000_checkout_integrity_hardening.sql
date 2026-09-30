-- Checkout integrity hardening (production readiness remediation, 2026-09-30).
--
-- What this migration fixes, and why each piece lives in the DATABASE rather
-- than only in application code:
--
--   1. ATOMIC ORDER CREATION. Checkout used to insert `orders`, then
--      `order_items`, then `order_design_snapshots`, then lock the
--      customizations as four separate REST calls, with compensating deletes
--      on failure. A failed compensating delete left a partial order standing,
--      and a retry could return it as a "successful" order. All of those
--      writes now happen inside ONE Postgres transaction
--      (`create_checkout_order`), so they either all commit or none do.
--
--   2. IDEMPOTENCY UNDER CONCURRENCY. The per-customer unique index on
--      (customer_id, checkout_submission_id) is kept, and the RPC additionally
--      takes a transaction-scoped advisory lock on that key, so two parallel
--      requests with the same submission id serialize: exactly one creates the
--      order and the other replays it. A replay with a DIFFERENT payload is
--      reported as a conflict instead of silently returning the first order.
--
--   3. DURABLE ORDER STATE. `orders.checkout_state` ('creating', 'finalized',
--      'failed', 'cancelled'). Only 'finalized' orders are ever visible to a
--      customer or returned as an idempotent success.
--
--   4. ONE ORDER PER CUSTOMIZATION. `order_items.customization_id` with a
--      partial unique index — the database, not only the application, refuses
--      to sell the same personalized design twice.
--
--   5. COLUMN-LEVEL AUTHORIZATION. RLS decides WHICH ROWS a customer may touch,
--      not WHICH COLUMNS. Customers could previously PATCH
--      `product_customizations` directly through PostgREST and change
--      `status`, `order_id`, `print_files`, `template_version`, … and bypass
--      the server's template validation entirely. Customer writes to that
--      table now go exclusively through the API (service role, after
--      authentication, ownership and template validation).
--
--   6. IMMUTABLE PRODUCTION HISTORY. Finalized order financials, order item
--      pricing and order design snapshots can no longer be rewritten after the
--      fact (published template versions already could not be).
--
--   7. STORAGE IDOR. The customer-uploads storage read policy granted access
--      whenever ANY `customer_uploads` row with that path named the caller as
--      `assigned_designer_id` — and customers could insert such rows
--      themselves, for any path. Assignment is now server-controlled and the
--      designer branch requires the designer role and an owner-matching path.
--
-- DEPLOYMENT ORDER: apply this migration BEFORE deploying the application
-- build that calls `create_checkout_order`. The previous application build
-- keeps working against this schema except for direct customer writes to
-- `product_customizations` from the old `/api/customizations` routes (which
-- used the customer's session); deploy the new build immediately after.
--
-- DATA SAFETY: forward-only and non-destructive. No table, column or row is
-- dropped. Legacy rows are never rewritten except for the documented,
-- evidence-based backfills below (currency / delivery method copied from the
-- order's own metadata). New CHECK constraints are added NOT VALID and only
-- validated when existing data already satisfies them, so legacy rows can
-- never make this migration fail. Safe to re-run.

/* ======================================================================== */
/* 1. orders: durable checkout state, trusted money/currency, terms audit    */
/* ======================================================================== */

alter table public.orders
  add column if not exists checkout_state text not null default 'finalized',
  add column if not exists currency text not null default 'BDT',
  add column if not exists payment_method text not null default 'cash_on_delivery',
  add column if not exists delivery_method text,
  add column if not exists request_hash text,
  add column if not exists finalized_at timestamp with time zone,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamp with time zone,
  add column if not exists terms_accepted_by_user_id uuid references public.profiles(id) on delete set null;

comment on column public.orders.checkout_state is
  'creating | finalized | failed | cancelled. Only finalized orders are customer visible or returned as an idempotent checkout success.';
comment on column public.orders.request_hash is
  'SHA-256 of the validated checkout request. A replayed submission id with a different payload is a conflict, not a success.';

-- Evidence-based backfill: legacy orders stored these in metadata only.
update public.orders
set currency = 'USD'
where upper(coalesce(metadata->>'currency', '')) = 'USD' and currency = 'BDT';

update public.orders
set delivery_method = case when lower(metadata->>'deliveryMethod') = 'store' then 'store' else 'delivery' end
where delivery_method is null and metadata ? 'deliveryMethod';

update public.orders
set finalized_at = created_at
where finalized_at is null and checkout_state = 'finalized';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_checkout_state_check') then
    alter table public.orders add constraint orders_checkout_state_check
      check (checkout_state in ('creating', 'finalized', 'failed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_currency_check') then
    alter table public.orders add constraint orders_currency_check check (currency in ('BDT', 'USD'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_method_check') then
    alter table public.orders add constraint orders_payment_method_check check (payment_method in ('cash_on_delivery'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_delivery_method_check') then
    alter table public.orders add constraint orders_delivery_method_check
      check (delivery_method is null or delivery_method in ('delivery', 'store'));
  end if;

  -- Money and status integrity. NOT VALID first so a legacy row can never
  -- abort the migration; validated immediately when the data already agrees.
  if not exists (select 1 from pg_constraint where conname = 'orders_money_non_negative_check') then
    alter table public.orders add constraint orders_money_non_negative_check
      check (subtotal >= 0 and delivery_charge >= 0 and total >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_total_arithmetic_check') then
    alter table public.orders add constraint orders_total_arithmetic_check
      check (total = subtotal + delivery_charge) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_status_check') then
    alter table public.orders add constraint orders_status_check
      check (status in ('pending', 'confirmed', 'in design review', 'proof sent', 'customer approved', 'printing',
                        'ready for delivery', 'delivered', 'cancelled', 'new', 'reviewing', 'in design', 'completed')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_status_check') then
    alter table public.orders add constraint orders_payment_status_check
      check (payment_status in ('unpaid', 'paid', 'partially paid', 'refunded', 'cancelled')) not valid;
  end if;
end $$;

do $$
declare
  constraint_name text;
begin
  foreach constraint_name in array array[
    'orders_money_non_negative_check', 'orders_total_arithmetic_check',
    'orders_status_check', 'orders_payment_status_check'
  ] loop
    begin
      execute format('alter table public.orders validate constraint %I', constraint_name);
    exception when check_violation then
      raise notice 'Legacy orders violate %; the constraint stays NOT VALID (enforced for new and updated rows). Review with the diagnostic queries in docs/CHECKOUT_ARCHITECTURE.md.', constraint_name;
    end;
  end loop;
end $$;

-- The idempotency key. Re-asserted here so this migration is self-sufficient.
create unique index if not exists orders_customer_checkout_submission_id_key
  on public.orders (customer_id, checkout_submission_id)
  where checkout_submission_id is not null;

create index if not exists idx_orders_checkout_state on public.orders(checkout_state);

/* ======================================================================== */
/* 2. order_items: canonical identity + one order per customization          */
/* ======================================================================== */

alter table public.order_items
  add column if not exists line_number integer,
  add column if not exists currency text,
  add column if not exists product_sku text,
  add column if not exists pricing jsonb not null default '{}'::jsonb,
  add column if not exists customization_id uuid references public.product_customizations(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_money_check') then
    alter table public.order_items add constraint order_items_money_check
      check (unit_price >= 0 and line_total >= 0 and line_total = unit_price * quantity) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_items_quantity_range_check') then
    alter table public.order_items add constraint order_items_quantity_range_check
      check (quantity between 1 and 10000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_items_currency_check') then
    alter table public.order_items add constraint order_items_currency_check
      check (currency is null or currency in ('BDT', 'USD'));
  end if;
end $$;

do $$
declare
  constraint_name text;
begin
  foreach constraint_name in array array['order_items_money_check', 'order_items_quantity_range_check'] loop
    begin
      execute format('alter table public.order_items validate constraint %I', constraint_name);
    exception when check_violation then
      raise notice 'Legacy order_items violate %; the constraint stays NOT VALID (enforced for new and updated rows).', constraint_name;
    end;
  end loop;
end $$;

-- A personalized design can be sold exactly once. Legacy rows have NULL here
-- (their customization id lives in metadata), so this cannot fail on old data.
create unique index if not exists order_items_customization_once
  on public.order_items (customization_id)
  where customization_id is not null;

create unique index if not exists order_items_order_line_number_key
  on public.order_items (order_id, line_number)
  where line_number is not null;

/* ======================================================================== */
/* 3. order_design_snapshots: one per customization per order, immutable     */
/* ======================================================================== */

create unique index if not exists order_design_snapshots_order_customization_key
  on public.order_design_snapshots (order_id, customization_id)
  where customization_id is not null;

-- Production data that is written once, at checkout, and must never change
-- afterwards. The render worker may still record render progress and output
-- files; foreign keys that are `on delete set null` are also excluded so a
-- referenced row can still be removed.
create or replace function public.protect_order_design_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  mutable_keys text[] := array[
    'render_status', 'print_files', 'preview_files', 'preflight', 'updated_at',
    'order_item_id', 'customization_id', 'template_version_id'
  ];
begin
  -- A database-owner session (SQL editor / audited manual repair) may correct
  -- data; nothing reachable through PostgREST can.
  if current_user in ('postgres', 'supabase_admin') and coalesce(auth.role(), '') = '' then
    return new;
  end if;
  if (to_jsonb(new) - mutable_keys) is distinct from (to_jsonb(old) - mutable_keys) then
    raise exception 'Order design snapshots are immutable once created.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_order_design_snapshot on public.order_design_snapshots;
create trigger protect_order_design_snapshot
before update on public.order_design_snapshots
for each row execute function public.protect_order_design_snapshot();

/* ======================================================================== */
/* 4. Finalized order financials and order item pricing are immutable        */
/* ======================================================================== */

create or replace function public.protect_finalized_order()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Fields an administrator legitimately changes after checkout: fulfilment
  -- status, payment collection, the quoted delivery charge (and therefore the
  -- total, which the arithmetic CHECK keeps consistent), notes and metadata.
  mutable_keys text[] := array[
    'status', 'payment_status', 'delivery_charge', 'total', 'metadata', 'message',
    'updated_at', 'checkout_state'
  ];
begin
  if current_user in ('postgres', 'supabase_admin') and coalesce(auth.role(), '') = '' then
    return new;
  end if;

  if old.checkout_state = 'finalized' then
    -- `on delete set null` foreign keys (a deleted customer profile, a
    -- permanently deleted product) must still be able to clear their column.
    if (new.customer_id is not null and new.customer_id is distinct from old.customer_id)
       or (new.product_id is not null and new.product_id is distinct from old.product_id)
       or (new.terms_accepted_by_user_id is not null and new.terms_accepted_by_user_id is distinct from old.terms_accepted_by_user_id) then
      raise exception 'The owner or product of a finalized order cannot be reassigned.' using errcode = '42501';
    end if;
    if (to_jsonb(new) - mutable_keys - array['customer_id', 'product_id', 'terms_accepted_by_user_id'])
       is distinct from
       (to_jsonb(old) - mutable_keys - array['customer_id', 'product_id', 'terms_accepted_by_user_id']) then
      raise exception 'The identity, customer and priced subtotal of a finalized order cannot be changed.'
        using errcode = '42501';
    end if;
    if new.checkout_state not in ('finalized', 'cancelled') then
      raise exception 'A finalized order can only be cancelled.' using errcode = '42501';
    end if;
  elsif old.checkout_state in ('failed', 'cancelled') and new.checkout_state = 'finalized' then
    -- A failed or cancelled checkout can never be promoted into a successful
    -- order; the customer must check out again.
    raise exception 'A failed or cancelled checkout cannot become a finalized order.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_finalized_order on public.orders;
create trigger protect_finalized_order
before update on public.orders
for each row execute function public.protect_finalized_order();

create or replace function public.protect_order_item_pricing()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  mutable_keys text[] := array['metadata', 'updated_at', 'customization_id', 'product_id'];
begin
  if current_user in ('postgres', 'supabase_admin') and coalesce(auth.role(), '') = '' then
    return new;
  end if;
  if (to_jsonb(new) - mutable_keys) is distinct from (to_jsonb(old) - mutable_keys) then
    raise exception 'Order items are immutable once the order is placed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_order_item_pricing on public.order_items;
create trigger protect_order_item_pricing
before update on public.order_items
for each row execute function public.protect_order_item_pricing();

/* ======================================================================== */
/* 5. Customers only ever see their own FINALIZED orders                    */
/* ======================================================================== */

-- Ownership is the customer id only. The previous email clause matched the
-- JWT email claim, which is not an ownership proof on its own (and the
-- application already filtered by customer id exclusively).
drop policy if exists "orders_customer_read" on public.orders;
create policy "orders_customer_read" on public.orders
for select using (
  public.is_admin()
  or (customer_id = auth.uid() and checkout_state = 'finalized')
);

drop policy if exists "order_items_customer_read" on public.order_items;
create policy "order_items_customer_read" on public.order_items
for select using (
  public.is_admin() or exists (
    select 1 from public.orders o
    where o.id = order_id and o.customer_id = auth.uid() and o.checkout_state = 'finalized'
  )
);

/* ======================================================================== */
/* 6. product_customizations: server-managed writes only                     */
/* ======================================================================== */

-- Customers keep READ access to their own rows (RLS owner policy). Every
-- write goes through /api/customizations, which authenticates, checks strict
-- ownership, validates against the authoritative published template, and
-- writes with the service role. Direct PostgREST writes would bypass all of
-- that (and let a customer rewrite status/order_id/print_files/template).
revoke insert, update, delete on public.product_customizations from anon, authenticated;

create or replace function public.guard_customization_writes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Durable even if a later `grant ... to authenticated` restores table
  -- privileges (supabase/schema.sql used to grant them).
  if current_user in ('anon', 'authenticated') then
    raise exception 'Customizations can only be changed through the Husnalogy API.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is null then
      raise exception 'A customization must have an owner.' using errcode = '23502';
    end if;
    if new.status = 'ordered' or new.order_id is not null then
      raise exception 'A new customization cannot already be ordered.' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists guard_customization_writes on public.product_customizations;
create trigger guard_customization_writes
before insert or update or delete on public.product_customizations
for each row execute function public.guard_customization_writes();

-- Strict ownership for every new or modified row. NOT VALID keeps legacy
-- ownerless rows readable by admins without assigning them to anyone.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_customizations_owner_required') then
    alter table public.product_customizations add constraint product_customizations_owner_required
      check (user_id is not null) not valid;
  end if;
  begin
    alter table public.product_customizations validate constraint product_customizations_owner_required;
  exception when check_violation then
    raise notice 'Legacy product_customizations without an owner exist; they can never be ordered (checkout requires strict ownership). The constraint stays NOT VALID.';
  end;
end $$;

-- Once ordered, the design AND its binding to the order are permanent. The
-- previous trigger still allowed `status` and `order_id` to change, which
-- would have let an ordered design be unlocked and re-sold.
--
-- It also rejected the `on delete set null` actions of its own foreign keys:
-- deleting the cart line of an ordered design (i.e. clearing the cart after a
-- successful checkout) failed with "ordered customizations are immutable".
-- Those columns may now move to NULL — and only to NULL.
create or replace function public.protect_ordered_customization_design()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  fk_keys text[] := array['cart_item_id', 'order_id', 'product_id', 'template_id'];
  mutable_keys text[] := array['preview_images', 'print_files', 'updated_at'];
begin
  if old.status = 'ordered' then
    if current_user in ('postgres', 'supabase_admin') and coalesce(auth.role(), '') = '' then
      return new;
    end if;
    if (new.cart_item_id is not null and new.cart_item_id is distinct from old.cart_item_id)
       or (new.order_id is not null and new.order_id is distinct from old.order_id)
       or (new.product_id is not null and new.product_id is distinct from old.product_id)
       or (new.template_id is not null and new.template_id is distinct from old.template_id) then
      raise exception 'ordered customizations are immutable';
    end if;
    if (to_jsonb(new) - mutable_keys - fk_keys) is distinct from (to_jsonb(old) - mutable_keys - fk_keys) then
      raise exception 'ordered customizations are immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_ordered_customization_design on public.product_customizations;
create trigger protect_ordered_customization_design
before update on public.product_customizations
for each row execute function public.protect_ordered_customization_design();

/* ======================================================================== */
/* 7. Published template versions                                           */
/* ======================================================================== */

-- Already immutable: prevent_customizer_version_mutation
-- (20260726120000_customizer_public_versioning.sql) rejects every UPDATE.
-- Checkout additionally requires a customization's version to belong to the
-- ordered product, and the order snapshot keeps a full copy of the document.

/* ======================================================================== */
/* 8. Customer uploads: server-controlled assignment, owner-prefixed paths   */
/* ======================================================================== */

create or replace function public.guard_customer_upload_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assigned_designer_id is not null or new.order_id is not null then
      raise exception 'Upload assignment is managed by Husnalogy.' using errcode = '42501';
    end if;
    if split_part(coalesce(new.path, ''), '/', 1) <> new.user_id::text then
      raise exception 'An upload record must point inside the owner''s own folder.' using errcode = '42501';
    end if;
  else
    if new.user_id is distinct from old.user_id
       or new.path is distinct from old.path
       or new.bucket is distinct from old.bucket
       or new.assigned_designer_id is distinct from old.assigned_designer_id
       or new.order_id is distinct from old.order_id then
      raise exception 'Only the file name and metadata of an upload record can be changed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_customer_upload_row on public.customer_uploads;
create trigger guard_customer_upload_row
before insert or update on public.customer_uploads
for each row execute function public.guard_customer_upload_row();

-- The designer branch now requires the designer role, and the upload row must
-- belong to the owner of the storage folder being read.
drop policy if exists "customer_uploads_owner_read_storage" on storage.objects;
create policy "customer_uploads_owner_read_storage" on storage.objects
for select using (
  bucket_id = 'customer-uploads'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or public.is_admin()
    or (
      public.is_designer()
      and exists (
        select 1 from public.customer_uploads cu
        where cu.path = storage.objects.name
          and cu.assigned_designer_id = auth.uid()
          and cu.user_id::text = split_part(storage.objects.name, '/', 1)
      )
    )
  )
);

-- Customer files are written only by /api/customizer/upload, which decodes and
-- re-encodes images server side. The browser can no longer PUT arbitrary
-- bytes into the bucket with a forged Content-Type.
drop policy if exists "customer_uploads_owner_insert_storage" on storage.objects;
drop policy if exists "customer_uploads_owner_update_storage" on storage.objects;

-- The asset library can only ever describe files in the owner's own folder.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_asset_library_owner_paths') then
    alter table public.customer_asset_library add constraint customer_asset_library_owner_paths check (
      split_part(path, '/', 1) = user_id::text
      and (editor_path is null or split_part(editor_path, '/', 1) = user_id::text)
      and (thumbnail_path is null or split_part(thumbnail_path, '/', 1) = user_id::text)
    ) not valid;
  end if;
  begin
    alter table public.customer_asset_library validate constraint customer_asset_library_owner_paths;
  exception when check_violation then
    raise notice 'Legacy customer_asset_library rows point outside their owner folder; the constraint stays NOT VALID. The server-side resolver already refuses them.';
  end;
end $$;

/* ======================================================================== */
/* 9. profiles.email is not self-service                                    */
/* ======================================================================== */

create or replace function public.protect_profile_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;
  -- A customer may only ever record the address their own session proves.
  if new.email is not null and lower(new.email) is distinct from lower(coalesce(auth.jwt()->>'email', '')) then
    raise exception 'The profile email is managed by Husnalogy.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_email on public.profiles;
create trigger protect_profile_email
before insert or update on public.profiles
for each row execute function public.protect_profile_email();

/* ======================================================================== */
/* 10. The checkout transaction                                             */
/* ======================================================================== */

-- Called ONLY by the server (service role) after it has authenticated the
-- customer, validated the request, resolved every product/option/price from
-- trusted rows, validated each customization and built the design snapshots.
--
-- Inputs:
--   p_order      order header (id, customer, contact, address, trusted money)
--   p_items      [{ line_number, product_id, ..., unit_price, quantity, line_total, customization_id? }]
--   p_snapshots  [{ line_number, customization_id, ... }]
--   p_guards     { products: [{ id, updated_at }], customizations: [{ id, product_id, updated_at }] }
--
-- Returns { status: created | replayed | conflict | incomplete, order_id }.
-- Business-rule failures raise P0001 with a CHECKOUT_* message.
create or replace function public.create_checkout_order(
  p_order jsonb,
  p_items jsonb,
  p_snapshots jsonb,
  p_guards jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id text := nullif(p_order->>'id', '');
  v_customer uuid := nullif(p_order->>'customer_id', '')::uuid;
  v_submission text := nullif(p_order->>'checkout_submission_id', '');
  v_hash text := nullif(p_order->>'request_hash', '');
  v_existing record;
  v_row record;
  v_guard jsonb;
  v_item jsonb;
  v_snapshot jsonb;
  v_item_id uuid;
  v_item_ids jsonb := '{}'::jsonb;
  v_subtotal numeric(12,2) := 0;
  v_customization_ids uuid[] := '{}';
  v_bound integer;
begin
  if v_order_id is null or v_customer is null or v_submission is null or v_hash is null then
    raise exception 'CHECKOUT_INVALID_INPUT' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'CHECKOUT_INVALID_INPUT' using errcode = 'P0001', detail = 'items';
  end if;

  -- Serialize every request carrying this customer's submission id. The
  -- unique index is the backstop; the lock makes the replay deterministic.
  perform pg_advisory_xact_lock(
    hashtextextended('husnalogy-checkout:' || v_customer::text || ':' || v_submission, 0)
  );

  select id, checkout_state, request_hash
    into v_existing
    from public.orders
   where customer_id = v_customer and checkout_submission_id = v_submission;

  if found then
    if v_existing.checkout_state <> 'finalized' then
      return jsonb_build_object('status', 'incomplete', 'order_id', v_existing.id);
    end if;
    if v_existing.request_hash is distinct from v_hash then
      return jsonb_build_object('status', 'conflict', 'order_id', v_existing.id);
    end if;
    return jsonb_build_object('status', 'replayed', 'order_id', v_existing.id);
  end if;

  -- Optimistic concurrency on the catalogue rows that were priced. A product
  -- edited, hidden or sold out since pricing aborts the whole checkout.
  for v_guard in select value from jsonb_array_elements(coalesce(p_guards->'products', '[]'::jsonb)) loop
    select id, status, visibility, is_stock_out, deleted_at, updated_at
      into v_row
      from public.products
     where id = v_guard->>'id'
     for share;
    if not found
       or v_row.status <> 'active'
       or v_row.visibility = 'hidden'
       or v_row.is_stock_out
       or v_row.deleted_at is not null then
      raise exception 'CHECKOUT_PRODUCT_UNAVAILABLE' using errcode = 'P0001', detail = v_guard->>'id';
    end if;
    if v_row.updated_at is distinct from (v_guard->>'updated_at')::timestamptz then
      raise exception 'CHECKOUT_PRICE_CHANGED' using errcode = 'P0001', detail = v_guard->>'id';
    end if;
  end loop;

  -- Every customization: strict owner, same product, still editable (never
  -- ordered before) and exactly the version that was validated and frozen.
  for v_guard in select value from jsonb_array_elements(coalesce(p_guards->'customizations', '[]'::jsonb)) loop
    select id, user_id, product_id, status, order_id, updated_at
      into v_row
      from public.product_customizations
     where id = (v_guard->>'id')::uuid
     for update;
    if not found then
      raise exception 'CHECKOUT_CUSTOMIZATION_NOT_FOUND' using errcode = 'P0001', detail = v_guard->>'id';
    end if;
    if v_row.user_id is null or v_row.user_id <> v_customer then
      raise exception 'CHECKOUT_CUSTOMIZATION_FORBIDDEN' using errcode = 'P0001', detail = v_guard->>'id';
    end if;
    if v_row.product_id is distinct from (v_guard->>'product_id') then
      raise exception 'CHECKOUT_CUSTOMIZATION_MISMATCH' using errcode = 'P0001', detail = v_guard->>'id';
    end if;
    if v_row.status not in ('draft', 'in_cart') or v_row.order_id is not null then
      raise exception 'CHECKOUT_CUSTOMIZATION_LOCKED' using errcode = 'P0001', detail = v_guard->>'id';
    end if;
    if v_row.updated_at is distinct from (v_guard->>'updated_at')::timestamptz then
      raise exception 'CHECKOUT_CUSTOMIZATION_CHANGED' using errcode = 'P0001', detail = v_guard->>'id';
    end if;
    v_customization_ids := v_customization_ids || v_row.id;
  end loop;

  -- The order header. payment_status/status/payment_method are FIXED here,
  -- never read from the request: a COD order always starts unpaid/pending.
  insert into public.orders (
    id, customer_id, customer_name, customer_email, customer_phone,
    product_id, product_title, product_slug,
    subtotal, delivery_charge, total, currency,
    payment_status, status, payment_method, delivery_method,
    message, address, customization_details, uploaded_files, metadata,
    checkout_submission_id, request_hash, checkout_state,
    terms_version, terms_accepted_at, terms_accepted_by_user_id
  ) values (
    v_order_id, v_customer, p_order->>'customer_name', lower(p_order->>'customer_email'), p_order->>'customer_phone',
    nullif(p_order->>'product_id', ''), p_order->>'product_title', nullif(p_order->>'product_slug', ''),
    (p_order->>'subtotal')::numeric, (p_order->>'delivery_charge')::numeric, (p_order->>'total')::numeric,
    p_order->>'currency',
    'unpaid', 'pending', 'cash_on_delivery', p_order->>'delivery_method',
    nullif(p_order->>'message', ''), coalesce(p_order->'address', '{}'::jsonb), '{}'::jsonb, '{}'::jsonb,
    coalesce(p_order->'metadata', '{}'::jsonb),
    v_submission, v_hash, 'creating',
    p_order->>'terms_version', now(), v_customer
  );

  for v_item in select value from jsonb_array_elements(p_items) loop
    if (v_item->>'currency') is distinct from (p_order->>'currency') then
      raise exception 'CHECKOUT_CURRENCY_MISMATCH' using errcode = 'P0001';
    end if;
    if (v_item->>'line_total')::numeric <> (v_item->>'unit_price')::numeric * (v_item->>'quantity')::integer then
      raise exception 'CHECKOUT_ARITHMETIC_MISMATCH' using errcode = 'P0001', detail = 'line_total';
    end if;

    insert into public.order_items (
      order_id, line_number, product_id, product_slug, product_title, product_image, product_sku,
      quantity, unit_price, line_total, currency, pricing,
      selected_options, customization_values, uploaded_files, preview_data, metadata, customization_id
    ) values (
      v_order_id, (v_item->>'line_number')::integer, v_item->>'product_id', nullif(v_item->>'product_slug', ''),
      v_item->>'product_title', nullif(v_item->>'product_image', ''), nullif(v_item->>'product_sku', ''),
      (v_item->>'quantity')::integer, (v_item->>'unit_price')::numeric, (v_item->>'line_total')::numeric,
      v_item->>'currency', coalesce(v_item->'pricing', '{}'::jsonb),
      coalesce(v_item->'selected_options', '{}'::jsonb), coalesce(v_item->'customization_values', '{}'::jsonb),
      coalesce(v_item->'uploaded_files', '{}'::jsonb), coalesce(v_item->'preview_data', '{}'::jsonb),
      coalesce(v_item->'metadata', '{}'::jsonb), nullif(v_item->>'customization_id', '')::uuid
    )
    returning id into v_item_id;

    v_item_ids := v_item_ids || jsonb_build_object(v_item->>'line_number', v_item_id);
    v_subtotal := v_subtotal + (v_item->>'line_total')::numeric;
  end loop;

  if v_subtotal <> (p_order->>'subtotal')::numeric
     or (p_order->>'total')::numeric <> (p_order->>'subtotal')::numeric + (p_order->>'delivery_charge')::numeric then
    raise exception 'CHECKOUT_ARITHMETIC_MISMATCH' using errcode = 'P0001', detail = 'totals';
  end if;

  for v_snapshot in select value from jsonb_array_elements(coalesce(p_snapshots, '[]'::jsonb)) loop
    if not ((v_snapshot->>'customization_id')::uuid = any(v_customization_ids)) then
      raise exception 'CHECKOUT_SNAPSHOT_MISMATCH' using errcode = 'P0001', detail = v_snapshot->>'customization_id';
    end if;
    insert into public.order_design_snapshots (
      order_id, order_item_id, customization_id, product_id, product_title, product_sku,
      quantity, selected_options, pricing, template_id, template_version, template_version_id,
      snapshot, preflight, preview_files, print_files, render_status, integrity_hash
    ) values (
      v_order_id, (v_item_ids->>(v_snapshot->>'line_number'))::uuid, (v_snapshot->>'customization_id')::uuid,
      v_snapshot->>'product_id', v_snapshot->>'product_title', nullif(v_snapshot->>'product_sku', ''),
      (v_snapshot->>'quantity')::integer, coalesce(v_snapshot->'selected_options', '{}'::jsonb),
      coalesce(v_snapshot->'pricing', '{}'::jsonb), nullif(v_snapshot->>'template_id', '')::uuid,
      (v_snapshot->>'template_version')::integer, nullif(v_snapshot->>'template_version_id', '')::uuid,
      coalesce(v_snapshot->'snapshot', '{}'::jsonb), coalesce(v_snapshot->'preflight', '{}'::jsonb),
      coalesce(v_snapshot->'preview_files', '{}'::jsonb), '{}'::jsonb, 'pending', v_snapshot->>'integrity_hash'
    );
  end loop;

  -- Every customization must have exactly one frozen snapshot on this order.
  if (select count(*) from public.order_design_snapshots s
       where s.order_id = v_order_id and s.customization_id = any(v_customization_ids))
     <> coalesce(array_length(v_customization_ids, 1), 0) then
    raise exception 'CHECKOUT_SNAPSHOT_MISSING' using errcode = 'P0001';
  end if;

  -- Detach from the cart at the same moment: the cart line is about to be
  -- cleared and must not keep a reference into a locked, ordered design.
  update public.product_customizations
     set status = 'ordered', order_id = v_order_id, cart_item_id = null, updated_at = now()
   where id = any(v_customization_ids);
  get diagnostics v_bound = row_count;
  if v_bound <> coalesce(array_length(v_customization_ids, 1), 0) then
    raise exception 'CHECKOUT_CUSTOMIZATION_BIND_FAILED' using errcode = 'P0001';
  end if;

  -- The one canonical moment an order becomes real.
  update public.orders
     set checkout_state = 'finalized', finalized_at = now()
   where id = v_order_id;

  return jsonb_build_object('status', 'created', 'order_id', v_order_id);
end;
$$;

revoke all on function public.create_checkout_order(jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.create_checkout_order(jsonb, jsonb, jsonb, jsonb) from anon, authenticated;
grant execute on function public.create_checkout_order(jsonb, jsonb, jsonb, jsonb) to service_role;
