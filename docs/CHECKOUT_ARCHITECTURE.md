# Checkout architecture (2026-09-30)

The browser is untrusted. Everything that affects money, ownership, product
identity, production or order state is decided on the server from database
rows. This document describes the flow, what the browser may and may not
send, and how failures and retries behave.

## 1. Flow: customer presses "Place order"

1. **Browser** (`app/checkout/checkout-client.tsx`) — terms checkbox starts
   unchecked; a synchronous guard blocks double clicks/Enter; the request
   carries only identifiers, option choices, quantities and contact details
   (`lib/orders/checkout-client.ts`). One `checkoutSubmissionId` per cart,
   kept in `sessionStorage`, reused by every retry, rotated only when the cart
   changes.
2. **Route** `POST /api/order-requests` — same-origin check, per-IP rate limit,
   Supabase session (`getUser`, verified with Supabase Auth), per-account rate
   limit, body read with a hard 64 KB streaming limit.
3. **Schema** (`lib/orders/checkout-schema.ts`) — strict zod schema; unknown
   fields are rejected. Output is a trusted representation: normalized name,
   canonical `+8801XXXXXXXXX` phone, validated address/postcode/note, current
   terms version, integer quantities 1–10 000, ≤ 50 lines.
4. **Idempotency pre-check** — finalized order for (customer, submission id)?
   Same request hash → 200 replay. Different hash → 409 with the existing
   order id. Non-finalized → 409, never success.
5. **Trusted products** (`getProductRecordsForCheckout`) — rows by id with the
   service role. Must be active, not hidden/deleted/internal/discontinued, in
   stock, with a positive price in an accepted currency (BDT).
6. **Trusted options and prices** (`lib/orders/pricing-resolver.ts`) — each
   selection matched to a configured option by identity (label or stable
   value, any price suffix discarded). Unknown/inactive/hidden/foreign/
   ambiguous/missing options and unknown option keys are rejected. Money in
   integer paisa. Mixed currencies are rejected. Delivery charge is decided
   server side (`resolveDeliveryChargeMinor`, 0 — quoted later by an admin).
7. **Personalization** (`lib/orders/personalization.ts`) — answers checked
   against the product's field list; uploads accepted only as storage paths
   the database confirms belong to the customer.
8. **Customizations** — strict owner (`user_id = session user`, null never
   passes), same product, status draft/in_cart and no order, options equal to
   the cart line's, template belongs to this product, published version of it
   published for this product, server-side design validation (permissions,
   fonts, upload ownership), blocking preflight, snapshot built from the row.
9. **Transaction** `create_checkout_order` (service role only): advisory lock
   on (customer, submission) → replay/conflict/incomplete check → product
   guards (`updated_at` unchanged, still purchasable) → customization guards
   (`FOR UPDATE`, owner, product, status, `updated_at` unchanged) → insert
   order (`creating`, payment `unpaid`, status `pending`, COD fixed in SQL) →
   items (arithmetic re-verified) → snapshots → bind designs (`ordered`,
   detached from cart) → **finalize** (`checkout_state = 'finalized'`). Any
   failure rolls back everything.
10. **Response** — 201 with the order (or 200 for a replay).
11. **Follow-ups** (never affect the order): render jobs queued, preflight
    audit rows, ordered cart lines deleted. Failures are logged.
12. **Browser** — marks the attempt `placed` before anything else, shows the
    confirmation, then clears the cart; a cleanup failure is logged only.

## 2. Field classification (Part 47)

| Field | Class | Source of truth |
|---|---|---|
| checkoutSubmissionId | client input | browser (idempotency key, customer scoped) |
| customerName, customerPhone, address, city, postalCode, deliveryNote | client input | validated/normalized by the schema |
| deliveryMethod | client input (enum) | `delivery` \| `store` |
| acceptTerms, termsVersion | client input | must be `true` and the current version |
| items[].productId, customizationId, cartItemId | client input (identifier) | verified against the database |
| items[].quantity | client input | integer 1–10 000 |
| items[].selectedOptions | client input (choice) | matched to configured options by identity |
| items[].personalization / uploads | client input | checked against product fields / owned uploads |
| customerId, customerEmail | **server derived** | Supabase session |
| unit price, surcharges, line totals, subtotal, total | **database derived** | products + options, integer paisa |
| currency | **database derived** | product currency (BDT only) |
| delivery charge | **server derived** | `resolveDeliveryChargeMinor` |
| product title/slug/SKU/image | **database derived** | product row |
| payment method/status, order status, checkout state | **sensitive, server controlled** | fixed in `create_checkout_order` |
| terms_accepted_at / by | **server derived** | `now()` / session user |
| snapshot, template version, production data | **sensitive, server controlled** | stored customization + published version |

Any client-controlled value for a server-owned field is **rejected** (400),
not ignored.

## 3. Retry safety (Part 53)

| Operation | Class | Why it is safe |
|---|---|---|
| POST /api/order-requests | idempotent | submission id + advisory lock + unique index; replay only for finalized orders with the same request hash |
| Lost DB response during commit | idempotent | the pipeline re-checks the submission id before reporting failure |
| Cart cleanup (server and browser) | safe to retry | deletes by id; cannot affect the order |
| `queueOrderProduction` / render enqueue | idempotent | render jobs dedupe by input hash; status updates are conditional |
| Snapshot creation | non-repeatable, transactional | only inside `create_checkout_order`, unique per (order, design) |
| Customization binding | non-repeatable, transactional | `status` guard + unique `order_items(customization_id)` |

## 4. Structured log events

One JSON line per event (`lib/observability/logger.ts`), with `requestId`,
`userId`, `submissionId`, `stage` and `orderId` where known. Secrets are
redacted by key name.

`checkout.validation_failed`, `checkout.authorization_failed`,
`checkout.pricing_rejected`, `checkout.database_failed`,
`checkout.snapshot_failed`, `checkout.idempotent_replay`,
`checkout.duplicate_prevented`, `checkout.unexpected_error`,
`checkout.order_created`, `checkout.cart_cleanup_failed`,
`checkout.post_order_task_failed`, `order.render_enqueue_failed`.
There is no `rollback_failed` event any more: rollback is performed by
Postgres itself.

## 5. Legacy data diagnostics (run manually, read only)

The migration never rewrites legacy orders. Review these after applying it:

```sql
-- Orders with no items (possible partial orders left by the old code path)
select o.id, o.created_at, o.customer_email from public.orders o
where not exists (select 1 from public.order_items i where i.order_id = o.id);

-- Legacy orders that violate the new money/status constraints (NOT VALID)
select id, subtotal, delivery_charge, total, status, payment_status from public.orders
where total <> subtotal + delivery_charge or subtotal < 0 or delivery_charge < 0
   or payment_status not in ('unpaid','paid','partially paid','refunded','cancelled');

-- Ownerless customizations (can never be ordered)
select id, product_id, created_at from public.product_customizations where user_id is null;
```

To withdraw a legacy partial order from the admin queue, set
`checkout_state = 'failed'` for it in the SQL editor after review.
