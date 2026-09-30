# Checkout architecture (2026-10-01)

The browser is untrusted. Everything that affects money, ownership, product
identity, production or order state is decided on the server from database
rows, and every durability or duplication guarantee is enforced inside one
Postgres transaction.

The current manufacturing contract is documented in
[SNAPSHOT_PRODUCTION.md](SNAPSHOT_PRODUCTION.md). Checkout freezes versioned
production input and pins original images, exact font files and license notices
into private order storage before the atomic finalization RPC. Dispatch, rendering
and recovery load that immutable snapshot; live customization/catalogue/template
lookups belong only to checkout validation and unfinalized draft previews.

## 1. Flow: customer presses "Place order"

1. **Browser** (`app/checkout/checkout-client.tsx`) — terms start unchecked; a
   synchronous guard blocks double clicks/Enter; the trusted quote
   (`/api/checkout/quote`, same resolver as checkout, including the chosen
   delivery method) is what the summary shows. The request carries only ids,
   option choices, quantities, personalization answers, upload paths and
   contact details (`lib/orders/checkout-client.ts`). Every line names its
   **server-side cart line**. The attempt (submission id + canonical cart
   fingerprint) lives in `localStorage` so refresh/retry/other tabs reuse it —
   UX only.
2. **Route** `POST /api/order-requests` — same-origin check, per-IP and
   per-account rate limits, verified Supabase session, 64 KB streamed body
   limit.
3. **Schema** (`lib/orders/checkout-schema.ts`) — strict; unknown fields are
   rejected; `cartItemId` mandatory and unique per line; canonical phone,
   validated address, current terms version.
4. **Idempotency pre-check** — finalized order for (customer, submission id)?
   same hash → 200 replay; different → 409 with that order id; non-finalized →
   409, never success.
5. **Trusted products** → purchasability (active, visible, not deleted or
   internal, in stock, positive price, BDT).
6. **Trusted options + price** (`lib/orders/pricing-resolver.ts`) — identity
   matching, integer paisa, fail closed. **Delivery** (`priceOrder` →
   `resolveDeliveryChargeMinor`) — shared with the quote.
7. **Personalization / uploads** — against the product's fields and the
   customer's own verified uploads.
8. **Customizations** — strict owner, same product, orderable, options equal
   to the line, template + published version of THIS product, server design
   validation, blocking preflight, then the snapshot is built by the
   production composer (`lib/customizer/snapshot-compose.ts`) with the line's
   **mandatory `line_number`**.
9. **Transaction** `create_checkout_order` (service role only), in order:
   advisory lock (customer, submission) → replay/conflict/incomplete →
   **cart claim**: `FOR UPDATE` on every submitted cart line, owner, product,
   quantity and design must match; a consumed line → `CART_ALREADY_ORDERED`
   (with the order id) → product guards → customization guards (`FOR UPDATE`)
   → order (`creating`; unpaid / pending / COD fixed in SQL) → items
   (arithmetic re-checked, each bound to its cart line) → snapshots (line
   number → order item of THIS order with the same design, product and a
   version of this product's template; otherwise abort) → one
   **production task per snapshot** → bind designs (`ordered`) → **claim +
   delete cart lines** → two **notification tasks** → `finalized`. Any
   failure rolls everything back.
10. **Response** 201 (or 200 replay).
11. **Fast path** runs this order's tasks immediately (render enqueue, emails).
    Failures leave tasks pending — never affect the order.
12. **Browser** marks the attempt `placed`, shows the confirmation, refreshes
    (never deletes) the cart.
13. **Worker** (cron every 5 min): heartbeat → recover unscheduled snapshots →
    drain production and notification tasks (leases, retry, backoff, attempt
    ceiling) → render jobs. `GET /api/admin/production/health` alerts when the
    worker stops or work is stuck.

## 2. Field classification

| Field | Class | Source of truth |
|---|---|---|
| checkoutSubmissionId | client input | idempotency key, customer scoped |
| items[].cartItemId | client input (identifier) | locked, verified and consumed in the transaction |
| customerName, customerPhone, address, city, postalCode, deliveryNote | client input | validated/normalized |
| deliveryMethod | client input (enum) | `delivery` \| `store`; price from server |
| acceptTerms, termsVersion | client input | must be `true` and current |
| items[].productId, customizationId | client input (identifier) | verified against the database |
| items[].quantity | client input | integer 1–10 000, must equal the cart line |
| items[].selectedOptions | client input (choice) | matched to configured options |
| items[].personalization / uploads | client input | checked against product fields / owned uploads |
| customerId, customerEmail | server derived | session |
| prices, surcharges, totals, currency | database derived | products/options, paisa |
| delivery charge | server derived | `resolveDeliveryChargeMinor` |
| product title/slug/SKU/image | database derived | product row |
| payment/order status, checkout state | server controlled | fixed in SQL |
| snapshot, template version, order item link | server controlled | stored design + published version + line number |
| production and notification tasks | server controlled | written by the transaction only |

## 3. Retry and duplication safety

| Operation | Class | Why it is safe |
|---|---|---|
| POST /api/order-requests (same submission) | idempotent | advisory lock + unique index + request hash |
| Same cart, different submission (tabs, windows, devices) | refused | cart lines locked and consumed in the transaction; claims keyed by cart line |
| Lost DB response during commit | idempotent | pipeline re-checks the submission before reporting failure |
| Production task | at-least-once, idempotent | leased; render jobs dedupe by input hash; snapshot update conditional |
| Notification task | at-least-once, deduplicated | leased; provider `Idempotency-Key` = task id; replay creates no task |
| Worker crash | recoverable | lease expiry makes the task claimable again |
| Pre-outbox snapshots | recovered | `enqueue_missing_production_tasks` |

## 4. Observability

- Structured JSON logs (`lib/observability/logger.ts`): `checkout.*`,
  `production.task_failed`, `notification.task_failed`, `worker.*`.
- Every error-level event and every unhandled server error
  (`instrumentation.ts` `onRequestError`) goes to Sentry when `SENTRY_DSN` is
  set; secrets, emails and phone numbers are scrubbed.
- `production_health()` / `GET /api/admin/production/health`: last worker run,
  pending/failed render jobs, production and notification tasks, oldest
  pending timestamps, unscheduled snapshots.

## 5. Legacy data diagnostics (read only)

```sql
-- Orders with no items (possible partial orders left by the old code path)
select o.id, o.created_at, o.customer_email from public.orders o
where not exists (select 1 from public.order_items i where i.order_id = o.id);

-- Legacy orders that violate the new money/status constraints (NOT VALID)
select id, subtotal, delivery_charge, total, status, payment_status from public.orders
where total <> subtotal + delivery_charge or subtotal < 0 or delivery_charge < 0
   or payment_status not in ('unpaid','paid','partially paid','refunded','cancelled');

-- Legacy snapshots without an order item link (kept; new ones are refused)
select id, order_id, customization_id, created_at from public.order_design_snapshots where order_item_id is null;

-- Ownerless customizations (can never be ordered)
select id, product_id, created_at from public.product_customizations where user_id is null;
```

To withdraw a legacy partial order from the admin queue, set
`checkout_state = 'failed'` in the SQL editor after review.
