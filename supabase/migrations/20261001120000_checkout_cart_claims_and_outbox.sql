-- Checkout: cart consumption, snapshot linkage, durable production and
-- notification work, identity immutability (2026-10-01).
--
-- Builds on 20260930120000_checkout_integrity_hardening.sql, which must be
-- applied first. Forward-only, non-destructive, safe to re-run.
--
--   1. CART CONSUMPTION. Idempotency keys only stop the SAME submission from
--      creating two orders. Two tabs, two windows or two devices holding the
--      same cart produce DIFFERENT keys. The checkout transaction now locks
--      every submitted cart line (`FOR UPDATE`), verifies ownership and
--      contents, records a claim (`checkout_cart_claims`, primary key on the
--      cart line) and deletes the line — all in the transaction that creates
--      the order. A second checkout of the same cart lines finds them consumed
--      and is refused with the id of the order that consumed them. A NEW cart
--      (new cart lines) for the same product is unaffected.
--
--   2. SNAPSHOT ↔ ORDER ITEM LINKAGE. Every snapshot must carry the order line
--      number, which must resolve to an order item of the same order with the
--      same customization and product, and a template version published for
--      that product. Anything else aborts the transaction. New snapshots can
--      no longer have a NULL `order_item_id`.
--
--   3. DURABLE PRODUCTION WORK (transactional outbox). The same transaction
--      writes one `production_tasks` row per snapshot and the order's
--      `notification_tasks`. A crash after commit, a failed render enqueue or
--      a failed email can delay work but never lose it: the scheduled worker
--      claims due tasks with leases and retries with backoff. Snapshots from
--      before this migration that never received a render job are recovered
--      by `enqueue_missing_production_tasks`.
--
--   4. IDENTITY IMMUTABILITY. On finalized history, identity foreign keys may
--      stay the same or become NULL (legitimate `on delete set null`) but can
--      never be re-pointed to a different row.
--
--   5. OBSERVABILITY. `worker_runs` records every worker run and
--      `production_health()` reports queue depth, failures and staleness.

/* ======================================================================== */
/* 1. Cart claims                                                           */
/* ======================================================================== */

create table if not exists public.checkout_cart_claims (
  cart_item_id uuid primary key,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  claimed_at timestamp with time zone not null default now()
);

create index if not exists idx_checkout_cart_claims_order on public.checkout_cart_claims(order_id);

comment on table public.checkout_cart_claims is
  'One row per cart line consumed by a finalized checkout. The primary key makes a cart line purchasable exactly once.';

alter table public.checkout_cart_claims enable row level security;
drop policy if exists "checkout_cart_claims_admin_read" on public.checkout_cart_claims;
create policy "checkout_cart_claims_admin_read" on public.checkout_cart_claims for select using (public.is_admin());
revoke all on public.checkout_cart_claims from anon, authenticated;
grant select on public.checkout_cart_claims to authenticated;
grant all on public.checkout_cart_claims to service_role;

/* ======================================================================== */
/* 2. Snapshot linkage is mandatory for new rows                            */
/* ======================================================================== */

-- Snapshots follow their order item (an order item is only ever removed with
-- its order). CASCADE replaces SET NULL so a snapshot can never be left
-- pointing at nothing, and makes the NOT NULL check below safe.
do $$
declare
  fk_name text;
begin
  select conname into fk_name
    from pg_constraint
   where conrelid = 'public.order_design_snapshots'::regclass
     and contype = 'f'
     and conkey = array[(select attnum from pg_attribute where attrelid = 'public.order_design_snapshots'::regclass and attname = 'order_item_id')]::smallint[];
  if fk_name is not null and fk_name <> 'order_design_snapshots_order_item_id_fkey_cascade' then
    execute format('alter table public.order_design_snapshots drop constraint %I', fk_name);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_design_snapshots_order_item_id_fkey_cascade') then
    alter table public.order_design_snapshots
      add constraint order_design_snapshots_order_item_id_fkey_cascade
      foreign key (order_item_id) references public.order_items(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'order_design_snapshots_order_item_required') then
    alter table public.order_design_snapshots
      add constraint order_design_snapshots_order_item_required check (order_item_id is not null) not valid;
  end if;
  begin
    alter table public.order_design_snapshots validate constraint order_design_snapshots_order_item_required;
  exception when check_violation then
    raise notice 'Legacy order_design_snapshots without order_item_id exist. They are kept; new snapshots require the link. See docs/CHECKOUT_ARCHITECTURE.md §5.';
  end;
end $$;

create unique index if not exists order_design_snapshots_order_item_key
  on public.order_design_snapshots (order_item_id)
  where order_item_id is not null;

/* ======================================================================== */
/* 3. Identity immutability                                                 */
/* ======================================================================== */

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
  -- Identity may be cleared by a parent deletion, never re-pointed.
  if (new.customization_id is not null and new.customization_id is distinct from old.customization_id)
     or (new.product_id is not null and new.product_id is distinct from old.product_id) then
    raise exception 'The product or design of an order item cannot be re-assigned.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - mutable_keys) is distinct from (to_jsonb(old) - mutable_keys) then
    raise exception 'Order items are immutable once the order is placed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ONE snapshot guard. 20260714210000 added `protect_order_design_snapshot_identity`,
-- which overlapped with `protect_order_design_snapshot` (20260930120000) and,
-- being column-blind, also rejected the legitimate `on delete set null` of the
-- design/template references. Consolidated here: the strict mutable column
-- set of the old trigger plus the identity rule (unchanged or NULL only).
drop trigger if exists protect_order_design_snapshot_identity on public.order_design_snapshots;
drop function if exists public.protect_order_design_snapshot_identity();

create or replace function public.protect_order_design_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Only render progress and output files ever change after checkout.
  mutable_keys text[] := array[
    'render_status', 'print_files', 'preview_files', 'updated_at',
    'order_item_id', 'customization_id', 'template_version_id'
  ];
begin
  if current_user in ('postgres', 'supabase_admin') and coalesce(auth.role(), '') = '' then
    return new;
  end if;
  if (new.order_item_id is not null and new.order_item_id is distinct from old.order_item_id)
     or (new.customization_id is not null and new.customization_id is distinct from old.customization_id)
     or (new.template_version_id is not null and new.template_version_id is distinct from old.template_version_id) then
    raise exception 'The order item, design or template version of a snapshot cannot be re-assigned.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - mutable_keys) is distinct from (to_jsonb(old) - mutable_keys) then
    raise exception 'Order design snapshots are immutable once created.' using errcode = '42501';
  end if;
  return new;
end;
$$;

/* ======================================================================== */
/* 4. Outbox tables                                                          */
/* ======================================================================== */

create table if not exists public.production_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  -- NULL only for tasks recovered from legacy snapshots that were never linked.
  order_item_id uuid references public.order_items(id) on delete cascade,
  snapshot_id uuid not null references public.order_design_snapshots(id) on delete cascade,
  customization_id uuid references public.product_customizations(id) on delete set null,
  task_type text not null default 'render_print_files' check (task_type in ('render_print_files')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  source text not null default 'checkout' check (source in ('checkout', 'recovery', 'admin')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  next_attempt_at timestamp with time zone not null default now(),
  lock_token uuid,
  locked_until timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (snapshot_id, task_type)
);

create index if not exists idx_production_tasks_due on public.production_tasks(status, next_attempt_at);
create index if not exists idx_production_tasks_order on public.production_tasks(order_id);

create table if not exists public.notification_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('order_confirmation_customer', 'order_notification_admin')),
  -- Customer tasks store the address captured at checkout; the admin
  -- recipient is resolved from server configuration when sending.
  recipient text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  next_attempt_at timestamp with time zone not null default now(),
  lock_token uuid,
  locked_until timestamp with time zone,
  sent_at timestamp with time zone,
  provider_message_id text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (order_id, kind)
);

create index if not exists idx_notification_tasks_due on public.notification_tasks(status, next_attempt_at);

create table if not exists public.worker_runs (
  worker text primary key,
  last_started_at timestamp with time zone,
  last_finished_at timestamp with time zone,
  last_status text,
  last_result jsonb not null default '{}'::jsonb,
  run_count bigint not null default 0
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['production_tasks', 'notification_tasks', 'worker_runs'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_read', table_name);
    execute format('create policy %I on public.%I for select using (public.is_admin())', table_name || '_admin_read', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;

drop trigger if exists set_production_tasks_updated_at on public.production_tasks;
create trigger set_production_tasks_updated_at before update on public.production_tasks
for each row execute function public.set_updated_at();
drop trigger if exists set_notification_tasks_updated_at on public.notification_tasks;
create trigger set_notification_tasks_updated_at before update on public.notification_tasks
for each row execute function public.set_updated_at();

/* ======================================================================== */
/* 5. Task leasing (service role only)                                       */
/* ======================================================================== */

-- Claim due tasks with a lease. `FOR UPDATE SKIP LOCKED` lets overlapping
-- workers run safely; an expired lease (worker crashed mid-task) makes the
-- task claimable again.
create or replace function public.claim_production_tasks(p_limit integer, p_lease_seconds integer default 300, p_order_id text default null)
returns setof public.production_tasks
language sql
security definer
set search_path = public
as $$
  update public.production_tasks t
     set status = 'processing',
         lock_token = gen_random_uuid(),
         locked_until = now() + make_interval(secs => greatest(30, p_lease_seconds)),
         attempt_count = t.attempt_count + 1
   where t.id in (
     select id from public.production_tasks
      where ((status = 'pending' and next_attempt_at <= now())
          or (status = 'processing' and locked_until < now()))
        and (p_order_id is null or order_id = p_order_id)
      order by next_attempt_at, created_at
      for update skip locked
      limit greatest(1, least(p_limit, 100))
   )
  returning t.*;
$$;

create or replace function public.finish_production_task(p_id uuid, p_lock_token uuid, p_error text default null, p_max_attempts integer default 8)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  update public.production_tasks
     set status = case
                    when p_error is null then 'completed'
                    when attempt_count >= p_max_attempts then 'failed'
                    else 'pending'
                  end,
         completed_at = case when p_error is null then now() else completed_at end,
         last_error = case when p_error is null then null else left(p_error, 1000) end,
         next_attempt_at = case when p_error is null then next_attempt_at
                                else now() + make_interval(secs => least(3600, 30 * power(2, least(attempt_count, 7))::integer)) end,
         lock_token = null,
         locked_until = null
   where id = p_id and lock_token = p_lock_token and status = 'processing'
  returning status into v_status;
  return v_status;
end;
$$;

create or replace function public.claim_notification_tasks(p_limit integer, p_lease_seconds integer default 120, p_order_id text default null)
returns setof public.notification_tasks
language sql
security definer
set search_path = public
as $$
  update public.notification_tasks t
     set status = 'processing',
         lock_token = gen_random_uuid(),
         locked_until = now() + make_interval(secs => greatest(30, p_lease_seconds)),
         attempt_count = t.attempt_count + 1
   where t.id in (
     select id from public.notification_tasks
      where ((status = 'pending' and next_attempt_at <= now())
          or (status = 'processing' and locked_until < now()))
        and (p_order_id is null or order_id = p_order_id)
      order by next_attempt_at, created_at
      for update skip locked
      limit greatest(1, least(p_limit, 100))
   )
  returning t.*;
$$;

create or replace function public.finish_notification_task(
  p_id uuid, p_lock_token uuid, p_error text default null, p_provider_message_id text default null, p_max_attempts integer default 10
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  update public.notification_tasks
     set status = case
                    when p_error is null then 'sent'
                    when attempt_count >= p_max_attempts then 'failed'
                    else 'pending'
                  end,
         sent_at = case when p_error is null then now() else sent_at end,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         last_error = case when p_error is null then null else left(p_error, 1000) end,
         next_attempt_at = case when p_error is null then next_attempt_at
                                else now() + make_interval(secs => least(3600, 60 * power(2, least(attempt_count, 6))::integer)) end,
         lock_token = null,
         locked_until = null
   where id = p_id and lock_token = p_lock_token and status = 'processing'
  returning status into v_status;
  return v_status;
end;
$$;

-- Release a claimed notification WITHOUT spending an attempt (e.g. no email
-- provider is configured yet): the task waits until it can really be sent.
create or replace function public.defer_notification_task(p_id uuid, p_lock_token uuid, p_reason text, p_delay_seconds integer default 900)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_tasks
     set status = 'pending',
         attempt_count = greatest(0, attempt_count - 1),
         last_error = left(p_reason, 1000),
         next_attempt_at = now() + make_interval(secs => greatest(60, p_delay_seconds)),
         lock_token = null,
         locked_until = null
   where id = p_id and lock_token = p_lock_token and status = 'processing';
$$;

-- Recovery for finalized snapshots that never received production work
-- (orders placed before the outbox existed, or created by any other path).
create or replace function public.enqueue_missing_production_tasks(p_older_than_seconds integer default 600)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.production_tasks (order_id, order_item_id, snapshot_id, customization_id, source)
  select s.order_id, s.order_item_id, s.id, s.customization_id, 'recovery'
    from public.order_design_snapshots s
    join public.orders o on o.id = s.order_id and o.checkout_state = 'finalized'
   where s.render_status = 'pending'
     and s.created_at < now() - make_interval(secs => greatest(60, p_older_than_seconds))
     and not exists (select 1 from public.production_tasks t where t.snapshot_id = s.id)
     and not exists (
       select 1 from public.customizer_render_jobs j
        where j.order_id = s.order_id and j.customization_id = s.customization_id
     )
  on conflict (snapshot_id, task_type) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.record_worker_run(p_worker text, p_phase text, p_status text default null, p_result jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.worker_runs as w (worker, last_started_at, last_finished_at, last_status, last_result, run_count)
  values (
    p_worker,
    case when p_phase = 'start' then now() end,
    case when p_phase = 'finish' then now() end,
    case when p_phase = 'start' then 'running' else p_status end,
    coalesce(p_result, '{}'::jsonb),
    case when p_phase = 'start' then 1 else 0 end
  )
  on conflict (worker) do update set
    last_started_at = case when p_phase = 'start' then now() else w.last_started_at end,
    last_finished_at = case when p_phase = 'finish' then now() else w.last_finished_at end,
    last_status = case when p_phase = 'start' then 'running' else p_status end,
    last_result = case when p_phase = 'finish' then coalesce(p_result, '{}'::jsonb) else w.last_result end,
    run_count = w.run_count + case when p_phase = 'start' then 1 else 0 end;
$$;

create or replace function public.production_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'checkedAt', now(),
    'worker', (select to_jsonb(w) - 'worker' from public.worker_runs w where w.worker = 'render'),
    'renderJobs', jsonb_build_object(
      'pending', (select count(*) from public.customizer_render_jobs where status in ('queued', 'retrying')),
      'processing', (select count(*) from public.customizer_render_jobs where status = 'processing'),
      'failed', (select count(*) from public.customizer_render_jobs where status = 'failed'),
      'oldestPendingAt', (select min(created_at) from public.customizer_render_jobs where status in ('queued', 'retrying'))
    ),
    'productionTasks', jsonb_build_object(
      'pending', (select count(*) from public.production_tasks where status in ('pending', 'processing')),
      'failed', (select count(*) from public.production_tasks where status = 'failed'),
      'oldestPendingAt', (select min(created_at) from public.production_tasks where status in ('pending', 'processing'))
    ),
    'notificationTasks', jsonb_build_object(
      'pending', (select count(*) from public.notification_tasks where status in ('pending', 'processing')),
      'failed', (select count(*) from public.notification_tasks where status = 'failed'),
      'oldestPendingAt', (select min(created_at) from public.notification_tasks where status in ('pending', 'processing'))
    ),
    'unscheduledSnapshots', (
      select count(*) from public.order_design_snapshots s
        join public.orders o on o.id = s.order_id and o.checkout_state = 'finalized'
       where s.render_status = 'pending'
         and not exists (select 1 from public.production_tasks t where t.snapshot_id = s.id)
         and not exists (select 1 from public.customizer_render_jobs j where j.order_id = s.order_id and j.customization_id = s.customization_id)
    )
  );
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.claim_production_tasks(integer, integer, text)',
    'public.finish_production_task(uuid, uuid, text, integer)',
    'public.claim_notification_tasks(integer, integer, text)',
    'public.finish_notification_task(uuid, uuid, text, text, integer)',
    'public.defer_notification_task(uuid, uuid, text, integer)',
    'public.enqueue_missing_production_tasks(integer)',
    'public.record_worker_run(text, text, text, jsonb)',
    'public.production_health()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

/* ======================================================================== */
/* 6. The checkout transaction                                              */
/* ======================================================================== */

-- Same signature as before; `p_guards` gains `cart_items`:
--   [{ id, line_number, product_id, quantity, customization_id }]
-- and every snapshot must carry `line_number`.
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
  v_claim record;
  v_guard jsonb;
  v_item jsonb;
  v_snapshot jsonb;
  v_item_id uuid;
  v_snapshot_id uuid;
  v_item_ids jsonb := '{}'::jsonb;
  v_subtotal numeric(12,2) := 0;
  v_customization_ids uuid[] := '{}';
  v_cart_ids uuid[] := '{}';
  v_item_count integer;
  v_bound integer;
begin
  if v_order_id is null or v_customer is null or v_submission is null or v_hash is null then
    raise exception 'CHECKOUT_INVALID_INPUT' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'CHECKOUT_INVALID_INPUT' using errcode = 'P0001', detail = 'items';
  end if;
  v_item_count := jsonb_array_length(p_items);

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

  -- Cart consumption, step 1: lock and verify every submitted cart line.
  -- A concurrent checkout of the same lines (another tab, window or device,
  -- with its own submission id) blocks here until this transaction ends, then
  -- finds the lines consumed.
  if jsonb_array_length(coalesce(p_guards->'cart_items', '[]'::jsonb)) <> v_item_count then
    raise exception 'CHECKOUT_CART_REQUIRED' using errcode = 'P0001';
  end if;
  -- Locks are always taken in id order so two concurrent checkouts can never
  -- deadlock on overlapping rows.
  for v_guard in select value from jsonb_array_elements(p_guards->'cart_items') order by value->>'id' loop
    select id, user_id, product_id, quantity, metadata
      into v_row
      from public.cart_items
     where id = (v_guard->>'id')::uuid
     for update;
    if not found then
      select order_id, customer_id into v_claim from public.checkout_cart_claims where cart_item_id = (v_guard->>'id')::uuid;
      if found and v_claim.customer_id = v_customer then
        raise exception 'CHECKOUT_CART_ALREADY_ORDERED' using errcode = 'P0001', detail = v_claim.order_id;
      end if;
      raise exception 'CHECKOUT_CART_ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_row.user_id is distinct from v_customer then
      raise exception 'CHECKOUT_CART_ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_row.id = any(v_cart_ids) then
      raise exception 'CHECKOUT_CART_CHANGED' using errcode = 'P0001', detail = 'duplicate cart line';
    end if;
    if v_row.product_id is distinct from (v_guard->>'product_id')
       or v_row.quantity is distinct from (v_guard->>'quantity')::integer
       or coalesce(v_row.metadata->>'customizationId', '') is distinct from coalesce(v_guard->>'customization_id', '') then
      raise exception 'CHECKOUT_CART_CHANGED' using errcode = 'P0001';
    end if;
    v_cart_ids := v_cart_ids || v_row.id;
  end loop;

  for v_guard in select value from jsonb_array_elements(coalesce(p_guards->'products', '[]'::jsonb)) order by value->>'id' loop
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

  for v_guard in select value from jsonb_array_elements(coalesce(p_guards->'customizations', '[]'::jsonb)) order by value->>'id' loop
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
    if (v_item->>'line_number') is null or (v_item->>'line_number')::integer < 1 then
      raise exception 'CHECKOUT_INVALID_INPUT' using errcode = 'P0001', detail = 'line_number';
    end if;
    if (v_item->>'currency') is distinct from (p_order->>'currency') then
      raise exception 'CHECKOUT_CURRENCY_MISMATCH' using errcode = 'P0001';
    end if;
    if (v_item->>'line_total')::numeric <> (v_item->>'unit_price')::numeric * (v_item->>'quantity')::integer then
      raise exception 'CHECKOUT_ARITHMETIC_MISMATCH' using errcode = 'P0001', detail = 'line_total';
    end if;
    -- Every order line consumes exactly its own cart line.
    if not exists (
      select 1 from jsonb_array_elements(p_guards->'cart_items') g
       where (g.value->>'line_number')::integer = (v_item->>'line_number')::integer
         and g.value->>'product_id' = v_item->>'product_id'
         and (g.value->>'quantity')::integer = (v_item->>'quantity')::integer
         and coalesce(g.value->>'customization_id', '') = coalesce(v_item->>'customization_id', '')
    ) then
      raise exception 'CHECKOUT_CART_CHANGED' using errcode = 'P0001', detail = 'line ' || (v_item->>'line_number');
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

  if (select count(*) from jsonb_object_keys(v_item_ids)) <> v_item_count then
    raise exception 'CHECKOUT_INVALID_INPUT' using errcode = 'P0001', detail = 'duplicate line_number';
  end if;
  if v_subtotal <> (p_order->>'subtotal')::numeric
     or (p_order->>'total')::numeric <> (p_order->>'subtotal')::numeric + (p_order->>'delivery_charge')::numeric then
    raise exception 'CHECKOUT_ARITHMETIC_MISMATCH' using errcode = 'P0001', detail = 'totals';
  end if;

  for v_snapshot in select value from jsonb_array_elements(coalesce(p_snapshots, '[]'::jsonb)) loop
    -- Linkage is mandatory and must be exact; never insert an unlinked snapshot.
    if (v_snapshot->>'line_number') is null or (v_item_ids->>(v_snapshot->>'line_number')) is null then
      raise exception 'CHECKOUT_SNAPSHOT_UNLINKED' using errcode = 'P0001', detail = coalesce(v_snapshot->>'customization_id', '?');
    end if;
    v_item_id := (v_item_ids->>(v_snapshot->>'line_number'))::uuid;
    if not ((v_snapshot->>'customization_id')::uuid = any(v_customization_ids)) then
      raise exception 'CHECKOUT_SNAPSHOT_MISMATCH' using errcode = 'P0001', detail = v_snapshot->>'customization_id';
    end if;
    if not exists (
      select 1 from public.order_items i
       where i.id = v_item_id
         and i.order_id = v_order_id
         and i.customization_id = (v_snapshot->>'customization_id')::uuid
         and i.product_id = v_snapshot->>'product_id'
    ) then
      raise exception 'CHECKOUT_SNAPSHOT_MISMATCH' using errcode = 'P0001', detail = 'line ' || (v_snapshot->>'line_number');
    end if;
    if not exists (
      select 1 from public.customizer_template_versions v
        join public.product_customizer_templates t on t.id = v.template_id
       where v.id = nullif(v_snapshot->>'template_version_id', '')::uuid
         and v.template_id = nullif(v_snapshot->>'template_id', '')::uuid
         and v.version = (v_snapshot->>'template_version')::integer
         and v.product_id = v_snapshot->>'product_id'
         and t.product_id = v_snapshot->>'product_id'
    ) then
      raise exception 'CHECKOUT_SNAPSHOT_TEMPLATE_MISMATCH' using errcode = 'P0001', detail = 'line ' || (v_snapshot->>'line_number');
    end if;

    insert into public.order_design_snapshots (
      order_id, order_item_id, customization_id, product_id, product_title, product_sku,
      quantity, selected_options, pricing, template_id, template_version, template_version_id,
      snapshot, preflight, preview_files, print_files, render_status, integrity_hash
    ) values (
      v_order_id, v_item_id, (v_snapshot->>'customization_id')::uuid,
      v_snapshot->>'product_id', v_snapshot->>'product_title', nullif(v_snapshot->>'product_sku', ''),
      (v_snapshot->>'quantity')::integer, coalesce(v_snapshot->'selected_options', '{}'::jsonb),
      coalesce(v_snapshot->'pricing', '{}'::jsonb), nullif(v_snapshot->>'template_id', '')::uuid,
      (v_snapshot->>'template_version')::integer, nullif(v_snapshot->>'template_version_id', '')::uuid,
      coalesce(v_snapshot->'snapshot', '{}'::jsonb), coalesce(v_snapshot->'preflight', '{}'::jsonb),
      coalesce(v_snapshot->'preview_files', '{}'::jsonb), '{}'::jsonb, 'pending', v_snapshot->>'integrity_hash'
    )
    returning id into v_snapshot_id;

    -- Durable production work, committed with the order (outbox).
    insert into public.production_tasks (order_id, order_item_id, snapshot_id, customization_id, source)
    values (v_order_id, v_item_id, v_snapshot_id, (v_snapshot->>'customization_id')::uuid, 'checkout');
  end loop;

  if (select count(*) from public.order_design_snapshots s
       where s.order_id = v_order_id and s.customization_id = any(v_customization_ids))
     <> coalesce(array_length(v_customization_ids, 1), 0) then
    raise exception 'CHECKOUT_SNAPSHOT_MISSING' using errcode = 'P0001';
  end if;

  update public.product_customizations
     set status = 'ordered', order_id = v_order_id, cart_item_id = null, updated_at = now()
   where id = any(v_customization_ids);
  get diagnostics v_bound = row_count;
  if v_bound <> coalesce(array_length(v_customization_ids, 1), 0) then
    raise exception 'CHECKOUT_CUSTOMIZATION_BIND_FAILED' using errcode = 'P0001';
  end if;

  -- Cart consumption, step 2: claim and remove the lines, atomically with the order.
  insert into public.checkout_cart_claims (cart_item_id, customer_id, order_id, line_number)
  select (g.value->>'id')::uuid, v_customer, v_order_id, (g.value->>'line_number')::integer
    from jsonb_array_elements(p_guards->'cart_items') g;
  delete from public.cart_items where id = any(v_cart_ids) and user_id = v_customer;

  -- Durable notifications (sent by the worker; never part of checkout success).
  insert into public.notification_tasks (order_id, kind, recipient)
  values (v_order_id, 'order_confirmation_customer', lower(p_order->>'customer_email')),
         (v_order_id, 'order_notification_admin', null);

  update public.orders
     set checkout_state = 'finalized', finalized_at = now()
   where id = v_order_id;

  return jsonb_build_object('status', 'created', 'order_id', v_order_id);
end;
$$;

revoke all on function public.create_checkout_order(jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.create_checkout_order(jsonb, jsonb, jsonb, jsonb) from anon, authenticated;
grant execute on function public.create_checkout_order(jsonb, jsonb, jsonb, jsonb) to service_role;
