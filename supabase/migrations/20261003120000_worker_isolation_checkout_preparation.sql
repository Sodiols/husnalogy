
begin;

create table if not exists public.checkout_preparations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  submission_id text not null check (length(submission_id) between 1 and 200),
  cart_fingerprint text not null check (cart_fingerprint ~ '^[a-f0-9]{64}$'),
  -- The order id reserved for this attempt. Pinned bytes live under
  -- orders/<order_id>/, and the id is never reused by another attempt.
  order_id text not null unique check (order_id ~ '^[A-Za-z0-9_-]{1,160}$'),
  lease_token uuid not null default gen_random_uuid(),
  status text not null default 'preparing' check (status in ('preparing', 'committed', 'failed', 'abandoned')),
  lease_expires_at timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  failure_code text check (failure_code is null or length(failure_code) <= 100),
  assets_pinned integer not null default 0 check (assets_pinned >= 0),
  bytes_pinned bigint not null default 0 check (bytes_pinned >= 0),
  cleanup_status text not null default 'none' check (cleanup_status in ('none', 'pending', 'done')),
  cleanup_finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists checkout_preparations_one_active on public.checkout_preparations(customer_id) where status = 'preparing';
create index if not exists checkout_preparations_lease on public.checkout_preparations(status, lease_expires_at);
create index if not exists checkout_preparations_cleanup on public.checkout_preparations(cleanup_status) where cleanup_status = 'pending';

drop trigger if exists set_checkout_preparations_updated_at on public.checkout_preparations;
create trigger set_checkout_preparations_updated_at before update on public.checkout_preparations
for each row execute function public.set_updated_at();

-- Take the lease. Expired leases of this customer are abandoned first. A
-- second concurrent preparation (another tab, a double click, a script) gets
-- 'busy' without doing any expensive work.
create or replace function public.acquire_checkout_preparation(
  p_customer_id uuid, p_submission_id text, p_cart_fingerprint text, p_order_id text, p_lease_seconds integer default 300
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.checkout_preparations;
begin
  if p_customer_id is null or length(coalesce(p_submission_id, '')) not between 1 and 200
     or coalesce(p_cart_fingerprint, '') !~ '^[a-f0-9]{64}$' or coalesce(p_order_id, '') !~ '^[A-Za-z0-9_-]{1,160}$' then
    raise exception 'CHECKOUT_PREPARATION_INVALID' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('husnalogy-checkout-preparation:' || p_customer_id::text, 0));
  -- Waits for (never races) a finalize that holds the row: a committed lease
  -- is no longer 'preparing' when this re-checks it.
  update public.checkout_preparations
     set status = 'abandoned', failure_code = 'LEASE_EXPIRED', finished_at = now(), cleanup_status = 'pending'
   where customer_id = p_customer_id and status = 'preparing' and lease_expires_at <= now();
  select * into v from public.checkout_preparations where customer_id = p_customer_id and status = 'preparing';
  if found then
    return jsonb_build_object(
      'status', 'busy',
      'sameSubmission', v.submission_id = p_submission_id,
      'sameCart', v.cart_fingerprint = p_cart_fingerprint,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v.lease_expires_at - now())))::integer)
    );
  end if;
  insert into public.checkout_preparations (customer_id, submission_id, cart_fingerprint, order_id, lease_expires_at)
  values (p_customer_id, p_submission_id, p_cart_fingerprint, p_order_id,
          now() + make_interval(secs => least(900, greatest(60, coalesce(p_lease_seconds, 300)))))
  returning * into v;
  return jsonb_build_object('status', 'acquired', 'id', v.id, 'leaseToken', v.lease_token, 'leaseExpiresAt', v.lease_expires_at);
end $$;

-- A definitive failure (validation, limit, business refusal, rolled-back
-- transaction). The reserved order id was not used, so its bytes are unused.
create or replace function public.release_checkout_preparation(
  p_id uuid, p_lease_token uuid, p_failure_code text, p_assets integer default 0, p_bytes bigint default 0
)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  update public.checkout_preparations
     set status = 'failed', failure_code = left(coalesce(nullif(p_failure_code, ''), 'FAILED'), 100), finished_at = now(),
         assets_pinned = greatest(0, coalesce(p_assets, 0)), bytes_pinned = greatest(0, coalesce(p_bytes, 0)),
         cleanup_status = 'pending'
   where id = p_id and lease_token = p_lease_token and status = 'preparing'
  returning status into v_status;
  if v_status is null then
    select status into v_status from public.checkout_preparations where id = p_id and lease_token = p_lease_token;
  end if;
  return v_status;
end $$;

-- The only finalize path consumes the lease in the same transaction. A lease
-- that expired or was released can never be committed afterwards.
create or replace function public.consume_checkout_preparation() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.checkout_preparations;
begin
  if new.checkout_state = 'finalized' and old.checkout_state is distinct from 'finalized' then
    select * into v from public.checkout_preparations where order_id = new.id for update;
    if not found then
      raise exception 'CHECKOUT_PREPARATION_REQUIRED' using errcode = 'P0001';
    end if;
    if v.status <> 'preparing' or v.lease_expires_at <= now() then
      raise exception 'CHECKOUT_PREPARATION_EXPIRED' using errcode = 'P0001', detail = v.status;
    end if;
    if v.customer_id is distinct from new.customer_id or v.submission_id is distinct from new.checkout_submission_id then
      raise exception 'CHECKOUT_PREPARATION_MISMATCH' using errcode = 'P0001';
    end if;
    update public.checkout_preparations
       set status = 'committed', finished_at = now(), cleanup_status = 'none'
     where id = v.id;
  end if;
  return new;
end $$;
-- Named to fire after protect_finalized_order and
-- require_finalized_production_contract (BEFORE triggers run alphabetically),
-- so their specific refusals are reported first.
drop trigger if exists consume_checkout_preparation on public.orders;
drop trigger if exists verify_consume_checkout_preparation on public.orders;
create trigger verify_consume_checkout_preparation before update of checkout_state on public.orders
for each row execute function public.consume_checkout_preparation();

-- Worker lease recovery: a crashed or hung preparation is abandoned once its
-- lease expired. Rows held by an in-flight finalize are skipped (never raced).
create or replace function public.expire_checkout_preparations(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.checkout_preparations p
     set status = 'abandoned', failure_code = 'LEASE_EXPIRED', finished_at = now(), cleanup_status = 'pending'
   where p.id in (
     select id from public.checkout_preparations
      where status = 'preparing' and lease_expires_at <= now()
      order by lease_expires_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 200), 1000))
   ) and p.status = 'preparing';
  get diagnostics n = row_count;
  return n;
end $$;

/* ======================================================================== */
/* 2. Storage cleanup lifecycle                                             */
/* ======================================================================== */

create index if not exists order_production_assets_bucket_path on public.order_production_assets(bucket, path);
create index if not exists customizer_render_outputs_ready_bucket_path on public.customizer_render_outputs(bucket, path) where status = 'ready';

-- Why an object may be removed, or NULL when it must be kept. Deterministic:
--   * pinned originals and ready outputs are never candidates;
--   * bytes of an attempt that is still preparing are never candidates;
--   * bytes of a FAILED/ABANDONED preparation whose reserved order id never
--     became an order are unused and removable immediately;
--   * anything else under orders/ becomes an orphan only after 48 hours
--     (crash recovery; new finalization requires assets younger than 24h).
create or replace function public.storage_cleanup_reason(p_bucket text, p_name text, p_created_at timestamptz)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_bucket not in ('order-production', 'customizer-renders') or p_name !~ '^orders/[A-Za-z0-9_-]{1,160}/' then null
    when exists (select 1 from public.order_production_assets a where a.bucket = p_bucket and a.path = p_name) then null
    when exists (select 1 from public.customizer_render_outputs r where r.bucket = p_bucket and r.path = p_name and r.status = 'ready') then null
    when exists (select 1 from public.checkout_preparations p where p.order_id = split_part(p_name, '/', 2) and p.status = 'preparing') then null
    when p_bucket = 'order-production'
         and exists (select 1 from public.checkout_preparations p where p.order_id = split_part(p_name, '/', 2) and p.status in ('failed', 'abandoned'))
         and not exists (select 1 from public.orders o where o.id = split_part(p_name, '/', 2)) then 'abandoned_checkout'
    when p_created_at < now() - interval '48 hours' then 'orphan'
    else null
  end
$$;

-- Read-only listing (kept for compatibility and diagnostics).
create or replace function public.production_storage_cleanup_candidates(p_limit integer default 25)
returns table(bucket text, path text) language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id in ('order-production', 'customizer-renders') and o.name like 'orders/%'
     and public.storage_cleanup_reason(o.bucket_id, o.name, o.created_at) is not null
   order by o.created_at
   limit least(25, greatest(1, p_limit))
$$;

create table if not exists public.production_storage_cleanup_items (
  id uuid not null default gen_random_uuid() unique,
  bucket text not null check (bucket in ('order-production', 'customizer-renders')),
  path text not null,
  reason text not null check (reason in ('abandoned_checkout', 'orphan')),
  order_id text,
  status text not null default 'pending' check (status in ('pending', 'deleted', 'dead_letter', 'dismissed', 'retained')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  dead_lettered_at timestamptz,
  manual_review_required boolean not null default false,
  first_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (bucket, path)
);
create index if not exists production_storage_cleanup_items_due on public.production_storage_cleanup_items(status, next_attempt_at);
create index if not exists production_storage_cleanup_items_order on public.production_storage_cleanup_items(order_id);
drop trigger if exists set_production_storage_cleanup_items_updated_at on public.production_storage_cleanup_items;
create trigger set_production_storage_cleanup_items_updated_at before update on public.production_storage_cleanup_items
for each row execute function public.set_updated_at();

-- Discover new candidates, resolve items whose object disappeared or became
-- protected, dead-letter exhausted items, then lease a bounded batch. The
-- attempt is counted at claim time, so even a worker that crashes while
-- deleting one object cannot retry it forever.
create or replace function public.claim_storage_cleanup_items(
  p_limit integer default 25, p_lease_seconds integer default 300, p_max_attempts integer default 8, p_discover integer default 200
)
returns setof public.production_storage_cleanup_items
language plpgsql security definer set search_path = public, storage as $$
begin
  -- Discovery and resolution touch overlapping rows; only one worker does
  -- them at a time. A concurrent worker skips straight to the SKIP LOCKED
  -- claim below instead of waiting (or deadlocking) on the first.
  if pg_try_advisory_xact_lock(hashtextextended('husnalogy-storage-cleanup-discovery', 0)) then
  insert into public.production_storage_cleanup_items (bucket, path, reason, order_id)
  select c.bucket_id, c.name, c.reason, split_part(c.name, '/', 2)
    from (
      select o.bucket_id, o.name, o.created_at, public.storage_cleanup_reason(o.bucket_id, o.name, o.created_at) as reason
        from storage.objects o
       where o.bucket_id in ('order-production', 'customizer-renders') and o.name like 'orders/%'
         and not exists (select 1 from public.production_storage_cleanup_items i where i.bucket = o.bucket_id and i.path = o.name)
    ) c
   where c.reason is not null
   order by c.created_at
   limit greatest(0, least(coalesce(p_discover, 200), 1000))
  on conflict (bucket, path) do nothing;

  update public.production_storage_cleanup_items i
     set status = 'deleted', resolved_at = now(), manual_review_required = false
   where i.status in ('pending', 'dead_letter')
     and not exists (select 1 from storage.objects o where o.bucket_id = i.bucket and o.name = i.path);

  update public.production_storage_cleanup_items i
     set status = 'retained', resolved_at = now(), manual_review_required = false
   where i.status in ('pending', 'dead_letter')
     and exists (select 1 from storage.objects o where o.bucket_id = i.bucket and o.name = i.path
                  and public.storage_cleanup_reason(o.bucket_id, o.name, o.created_at) is null);

  update public.production_storage_cleanup_items
     set status = 'dead_letter', dead_lettered_at = now(), manual_review_required = true,
         last_error = coalesce(last_error, 'Cleanup attempts exhausted without a recorded outcome.')
   where status = 'pending' and attempt_count >= greatest(1, p_max_attempts) and next_attempt_at <= now();
  end if;

  return query
  with due as (
    select i.bucket, i.path from public.production_storage_cleanup_items i
     where i.status = 'pending' and i.next_attempt_at <= now()
     order by i.next_attempt_at, i.first_seen_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.production_storage_cleanup_items i
     set attempt_count = i.attempt_count + 1, last_attempt_at = now(),
         next_attempt_at = now() + make_interval(secs => greatest(60, coalesce(p_lease_seconds, 300)))
    from due
   where i.bucket = due.bucket and i.path = due.path
  returning i.*;
end $$;

-- The outcome is decided by storage state, not by what the worker believes:
-- an object that is gone is 'deleted'; one that remains is a failure with
-- exponential backoff (5 min .. 24 h) and dead-letters after the ceiling.
create or replace function public.record_storage_cleanup_result(p_id uuid, p_error text default null, p_max_attempts integer default 8)
returns text language plpgsql security definer set search_path = public, storage as $$
declare i public.production_storage_cleanup_items; v_status text;
begin
  select * into i from public.production_storage_cleanup_items where id = p_id for update;
  if not found or i.status <> 'pending' then return i.status; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = i.bucket and o.name = i.path) then
    update public.production_storage_cleanup_items
       set status = 'deleted', resolved_at = now(), last_error = null, manual_review_required = false
     where id = p_id;
    return 'deleted';
  end if;
  update public.production_storage_cleanup_items
     set last_error = left(coalesce(nullif(p_error, ''), 'Object still present after removal.'), 1000),
         status = case when i.attempt_count >= greatest(1, p_max_attempts) then 'dead_letter' else 'pending' end,
         dead_lettered_at = case when i.attempt_count >= greatest(1, p_max_attempts) then now() else null end,
         manual_review_required = i.attempt_count >= greatest(1, p_max_attempts),
         next_attempt_at = now() + make_interval(secs => least(86400, 300 * power(2, least(greatest(i.attempt_count - 1, 0), 9))::integer))
   where id = p_id
  returning status into v_status;
  return v_status;
end $$;

-- A failed/abandoned preparation is clean once none of its bytes remain.
create or replace function public.complete_checkout_preparation_cleanup(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = public, storage as $$
declare n integer;
begin
  update public.checkout_preparations p
     set cleanup_status = 'done', cleanup_finished_at = now()
   where p.id in (
     select c.id from public.checkout_preparations c
      where c.cleanup_status = 'pending' and c.status in ('failed', 'abandoned')
        and not exists (select 1 from storage.objects o where o.bucket_id = 'order-production' and starts_with(o.name, 'orders/' || c.order_id || '/'))
      limit greatest(1, least(coalesce(p_limit, 200), 1000))
   );
  get diagnostics n = row_count;
  return n;
end $$;

-- Staff action after fixing the cause (retry) or deciding to keep the object
-- (dismiss). Audited like every other recovery action.
create or replace function public.review_storage_cleanup_item(p_id uuid, p_actor_id uuid, p_action text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.production_storage_cleanup_items;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin') then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 or length(p_reason) > 500 then raise exception 'REVIEW_REASON_REQUIRED'; end if;
  if p_action not in ('retry', 'dismiss') then raise exception 'REVIEW_ACTION_INVALID'; end if;
  select * into i from public.production_storage_cleanup_items where id = p_id for update;
  if i.id is null or i.status not in ('pending', 'dead_letter') then raise exception 'CLEANUP_REVIEW_NOT_ALLOWED'; end if;
  insert into public.production_recovery_audit (actor_id, target_type, target_id, order_id, reason, previous_state)
  values (p_actor_id, 'storage_cleanup_' || p_action, i.id, coalesce(i.order_id, '-'), left(p_reason, 500),
          jsonb_build_object('status', i.status, 'attemptCount', i.attempt_count, 'error', i.last_error, 'bucket', i.bucket, 'path', i.path));
  if p_action = 'retry' then
    update public.production_storage_cleanup_items
       set status = 'pending', attempt_count = 0, next_attempt_at = now(), dead_lettered_at = null, manual_review_required = false
     where id = p_id;
  else
    update public.production_storage_cleanup_items
       set status = 'dismissed', resolved_at = now(), manual_review_required = false
     where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', i.id, 'action', p_action);
end $$;

/* ======================================================================== */
/* 3. Worker health per subsystem                                           */
/* ======================================================================== */

create table if not exists public.worker_subsystem_runs (
  worker text not null,
  subsystem text not null check (subsystem ~ '^[a-z_]{1,40}$'),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_status text check (last_status in ('ok', 'degraded', 'failed', 'skipped')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error text,
  last_duration_ms integer,
  last_result jsonb not null default '{}'::jsonb,
  primary key (worker, subsystem)
);

-- p_subsystems: [{ name, status, startedAt, durationMs, error, result }]
create or replace function public.record_worker_subsystems(p_worker text, p_subsystems jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare s jsonb; n integer := 0; v_status text;
begin
  if jsonb_typeof(p_subsystems) <> 'array' then raise exception 'WORKER_SUBSYSTEMS_INVALID'; end if;
  for s in select value from jsonb_array_elements(p_subsystems) loop
    v_status := s->>'status';
    if v_status not in ('ok', 'degraded', 'failed', 'skipped') then raise exception 'WORKER_SUBSYSTEM_STATUS_INVALID'; end if;
    insert into public.worker_subsystem_runs as w (worker, subsystem, last_started_at, last_finished_at, last_status,
      last_success_at, last_failure_at, consecutive_failures, last_error, last_duration_ms, last_result)
    values (p_worker, s->>'name', coalesce((s->>'startedAt')::timestamptz, now()), now(), v_status,
      case when v_status = 'ok' then now() end,
      case when v_status in ('failed', 'degraded') then now() end,
      case when v_status in ('failed', 'degraded') then 1 else 0 end,
      case when v_status in ('failed', 'degraded') then left(s->>'error', 1000) end,
      least(2147483647, greatest(0, coalesce((s->>'durationMs')::bigint, 0)))::integer,
      coalesce(s->'result', '{}'::jsonb))
    on conflict (worker, subsystem) do update set
      last_started_at = excluded.last_started_at,
      last_finished_at = excluded.last_finished_at,
      last_status = excluded.last_status,
      last_success_at = coalesce(excluded.last_success_at, w.last_success_at),
      last_failure_at = coalesce(excluded.last_failure_at, w.last_failure_at),
      consecutive_failures = case when excluded.last_status in ('failed', 'degraded') then w.consecutive_failures + 1
                                  when excluded.last_status = 'ok' then 0 else w.consecutive_failures end,
      -- The last error stays visible until the subsystem is healthy again.
      last_error = case when excluded.last_status = 'ok' then null else coalesce(excluded.last_error, w.last_error) end,
      last_duration_ms = excluded.last_duration_ms,
      last_result = excluded.last_result;
    n := n + 1;
  end loop;
  return n;
end $$;

alter table public.worker_runs add column if not exists last_degraded_at timestamptz;
create or replace function public.record_worker_outcome() returns trigger language plpgsql set search_path = public as $$
begin
  if new.last_status = 'ok' then new.last_success_at := new.last_finished_at;
  elsif new.last_status = 'degraded' then new.last_degraded_at := new.last_finished_at;
  elsif new.last_status = 'error' then new.last_failure_at := new.last_finished_at; end if;
  return new;
end $$;

-- Database clock for skew diagnostics (leases, JWT validation, cron).
create or replace function public.server_clock()
returns jsonb language sql volatile security definer set search_path = public as $$
  select jsonb_build_object('now', clock_timestamp(), 'transactionNow', now(), 'timezone', current_setting('TimeZone'))
$$;

/* ======================================================================== */
/* 4. Serialized reconciliation (unchanged repairs, one runner at a time)   */
/* ======================================================================== */

create or replace function public.reconcile_production(p_older_than_seconds integer default 600)
returns integer language plpgsql security definer set search_path = public as $$
declare repaired integer := 0; n integer;
begin
 -- Two overlapping cron runs serialize here; the second sees the first's
 -- repairs and inserts nothing (every insert is also ON CONFLICT DO NOTHING).
 perform pg_advisory_xact_lock(hashtextextended('husnalogy-reconcile-production', 0));
 perform 1 from public.order_design_snapshots s where snapshot_schema_version=1 and (
  render_status not in ('completed','manual_complete','archived') or
  exists(select 1 from jsonb_array_elements_text(s.snapshot#>'{production,requiredJobTypes}') k where not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.job_type=k)) or
  exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.status='completed' and (
   (j.job_type='print_pdf' and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id='all' and r.format='pdf')) or
   (j.job_type='print_png' and exists(select 1 from jsonb_array_elements(s.snapshot#>'{production,template,pages}') p where coalesce((p->>'enabled')::boolean,true) and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id=p->>'id' and r.format='png')))))) order by s.id for update;
 insert into public.production_tasks(order_id,order_item_id,snapshot_id,customization_id,source)
 select s.order_id,s.order_item_id,s.id,s.customization_id,'recovery' from public.order_design_snapshots s join public.orders o on o.id=s.order_id and o.checkout_state='finalized'
 where s.snapshot_schema_version=1 and s.render_status not in ('completed','manual_complete','archived') and s.created_at<now()-make_interval(secs=>greatest(0,p_older_than_seconds))
 on conflict(snapshot_id,task_type) do nothing;
 get diagnostics n=row_count; repaired:=repaired+n;
 update public.production_tasks t set status='pending',next_attempt_at=now(),completed_at=null,last_error='Reconciliation: required render job missing'
 from public.order_design_snapshots s where t.snapshot_id=s.id and t.status='completed' and s.production_mode='automatic' and s.snapshot_schema_version=1
 and exists(select 1 from jsonb_array_elements_text(s.snapshot#>'{production,requiredJobTypes}') k where not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.job_type=k));
 get diagnostics n=row_count; repaired:=repaired+n;
 update public.customizer_render_jobs j set status='retrying',next_attempt_at=now(),completed_at=null,error_code='OUTPUT_VERIFICATION_FAILED',error_message='Reconciliation: required output records missing'
 from public.order_design_snapshots s where j.snapshot_id=s.id and j.status='completed' and (
   (j.job_type='print_pdf' and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id='all' and r.format='pdf')) or
   (j.job_type='print_png' and exists(select 1 from jsonb_array_elements(s.snapshot#>'{production,template,pages}') p where coalesce((p->>'enabled')::boolean,true) and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id=p->>'id' and r.format='png'))));
 get diagnostics n=row_count; repaired:=repaired+n;
 update public.order_design_snapshots s set render_status='queued' where s.production_mode='automatic' and s.render_status='completed' and (
  exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.status<>'completed') or
  exists(select 1 from jsonb_array_elements_text(s.snapshot#>'{production,requiredJobTypes}') k where not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.job_type=k)));
 return repaired;
end $$;

-- Fix: the 20261002 version read old.order_id inside a CASE that also runs
-- for public.orders (which has no order_id). Real PostgreSQL resolves the
-- field at run time and failed EVERY order delete — including non-finalized
-- attempts that staff may remove. Read the column through jsonb instead.
create or replace function public.guard_fulfillment_history_delete() returns trigger language plpgsql set search_path=public as $$
declare oid text;
begin
 oid := case when tg_table_name = 'orders' then to_jsonb(old)->>'id' else to_jsonb(old)->>'order_id' end;
 if exists(select 1 from public.orders where id=oid and checkout_state='finalized') then raise exception 'FINALIZED_FULFILLMENT_HISTORY_MUST_BE_RETAINED'; end if;
 return old;
end $$;

/* ======================================================================== */
/* 5. Aggregate resource backstops (the application enforces tighter ones) */
/* ======================================================================== */

alter table public.order_design_snapshots drop constraint if exists order_design_snapshots_serialized_size;
alter table public.order_design_snapshots add constraint order_design_snapshots_serialized_size
  check (octet_length(snapshot::text) <= 8388608) not valid;

create or replace function public.guard_order_production_asset_budget() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_count integer; v_bytes bigint;
begin
  -- The same bytes shared by two designs of one order are one stored object.
  if exists (select 1 from public.order_production_assets where order_id = new.order_id and path = new.path) then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('husnalogy-order-assets:' || new.order_id, 0));
  select count(*), coalesce(sum(size_bytes), 0) into v_count, v_bytes
    from (select distinct on (path) path, size_bytes from public.order_production_assets where order_id = new.order_id order by path) d;
  if v_count + 1 > 600 or v_bytes + new.size_bytes > 536870912 then
    raise exception 'ORDER_PRODUCTION_ASSET_BUDGET_EXCEEDED' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists guard_order_production_asset_budget on public.order_production_assets;
create trigger guard_order_production_asset_budget before insert on public.order_production_assets
for each row execute function public.guard_order_production_asset_budget();

/* ======================================================================== */
/* 6. Health                                                                */
/* ======================================================================== */

create or replace function public.production_health() returns jsonb language sql stable security definer set search_path = public as $$
 select public.production_queue_health() || jsonb_build_object('chain', jsonb_build_object(
  'missingSnapshots',(select count(*) from public.order_items i join public.orders o on o.id=i.order_id and o.checkout_state='finalized' where (i.customization_id is not null or i.metadata ? 'customizationId' or i.customization_values<>'{}'::jsonb or i.uploaded_files<>'{}'::jsonb or i.metadata ? 'productionSnapshot') and not exists(select 1 from public.order_design_snapshots s where s.order_item_id=i.id)),
  'legacySnapshots',(select count(*) from public.order_design_snapshots s join public.orders o on o.id=s.order_id and o.checkout_state='finalized' where s.snapshot_schema_version<>1),
  'missingTasks',(select count(*) from public.order_design_snapshots s join public.orders o on o.id=s.order_id and o.checkout_state='finalized' where not exists(select 1 from public.production_tasks t where t.snapshot_id=s.id)),
  'missingJobs',(select count(*) from public.order_design_snapshots s where s.production_mode='automatic' and exists(select 1 from jsonb_array_elements_text(s.snapshot#>'{production,requiredJobTypes}') k where not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.job_type=k))),
  'missingOutputs',(select count(*) from public.customizer_render_jobs j join public.order_design_snapshots s on s.id=j.snapshot_id where j.status='completed' and (
   (j.job_type='print_pdf' and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id='all' and r.format='pdf')) or
   (j.job_type='print_png' and exists(select 1 from jsonb_array_elements(s.snapshot#>'{production,template,pages}') p where coalesce((p->>'enabled')::boolean,true) and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id=p->>'id' and r.format='png'))))),
  'stuckJobs',(select count(*) from public.customizer_render_jobs where status='processing' and lock_expires_at<now()),
  'staleSnapshots',(select count(*) from public.order_design_snapshots where production_mode='automatic' and render_status in ('pending','queued','processing') and created_at<now()-interval '30 minutes'),
  'manualRequired',(select count(*) from public.order_design_snapshots where render_status='manual_required'),
  'manualComplete',(select count(*) from public.order_design_snapshots where render_status='manual_complete'),
  'automaticComplete',(select count(*) from public.order_design_snapshots where production_mode='automatic' and render_status='completed')
 )) || jsonb_build_object(
  'subsystems', coalesce((select jsonb_object_agg(s.subsystem, to_jsonb(s) - 'worker' - 'subsystem') from public.worker_subsystem_runs s where s.worker = 'render'), '{}'::jsonb),
  'renderJobsRetrying', (select count(*) from public.customizer_render_jobs where status = 'retrying'),
  'storageCleanup', jsonb_build_object(
    'pending', (select count(*) from public.production_storage_cleanup_items where status = 'pending'),
    'failing', (select count(*) from public.production_storage_cleanup_items where status = 'pending' and last_error is not null),
    'deadLettered', (select count(*) from public.production_storage_cleanup_items where status = 'dead_letter'),
    'manualReviewRequired', (select count(*) from public.production_storage_cleanup_items where manual_review_required),
    'oldestPendingAt', (select min(first_seen_at) from public.production_storage_cleanup_items where status = 'pending'),
    'lastError', (select last_error from public.production_storage_cleanup_items where last_error is not null and status in ('pending', 'dead_letter') order by last_attempt_at desc nulls last limit 1)
  ),
  'outputs', jsonb_build_object(
    'unverified', (select count(*) from public.customizer_render_outputs where snapshot_id is not null and status = 'ready' and (verified_at is null or verified_at < now() - interval '7 days')),
    'invalid', (select count(*) from public.customizer_render_outputs where snapshot_id is not null and status = 'invalid')
  ),
  'checkoutPreparations', jsonb_build_object(
    'active', (select count(*) from public.checkout_preparations where status = 'preparing' and lease_expires_at > now()),
    'expiredActive', (select count(*) from public.checkout_preparations where status = 'preparing' and lease_expires_at <= now()),
    'pendingCleanup', (select count(*) from public.checkout_preparations where cleanup_status = 'pending'),
    'failedLast24h', (select count(*) from public.checkout_preparations where status = 'failed' and finished_at > now() - interval '24 hours'),
    'abandonedLast24h', (select count(*) from public.checkout_preparations where status = 'abandoned' and finished_at > now() - interval '24 hours'),
    'committedLast24h', (select count(*) from public.checkout_preparations where status = 'committed' and finished_at > now() - interval '24 hours')
  )
 );
$$;

/* ======================================================================== */
/* 7. Access                                                                */
/* ======================================================================== */

do $$
declare table_name text;
begin
  foreach table_name in array array['checkout_preparations', 'production_storage_cleanup_items', 'worker_subsystem_runs'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_read', table_name);
    execute format('create policy %I on public.%I for select using (public.is_admin())', table_name || '_admin_read', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'public.acquire_checkout_preparation(uuid,text,text,text,integer)',
    'public.release_checkout_preparation(uuid,uuid,text,integer,bigint)',
    'public.expire_checkout_preparations(integer)',
    'public.storage_cleanup_reason(text,text,timestamptz)',
    'public.production_storage_cleanup_candidates(integer)',
    'public.claim_storage_cleanup_items(integer,integer,integer,integer)',
    'public.record_storage_cleanup_result(uuid,text,integer)',
    'public.complete_checkout_preparation_cleanup(integer)',
    'public.review_storage_cleanup_item(uuid,uuid,text,text)',
    'public.record_worker_subsystems(text,jsonb)',
    'public.server_clock()',
    'public.reconcile_production(integer)',
    'public.production_health()'
  ] loop
    execute 'revoke all on function ' || fn || ' from public, anon, authenticated';
    execute 'grant execute on function ' || fn || ' to service_role';
  end loop;
end $$;
-- Trigger functions are not callable as RPCs.
revoke all on function public.consume_checkout_preparation() from public, anon, authenticated;
revoke all on function public.guard_order_production_asset_budget() from public, anon, authenticated;

commit;
