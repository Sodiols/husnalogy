-- Checkout idempotency (spec: prevent duplicate orders from double
-- submission, retries, or network resends). The client generates one
-- checkoutSubmissionId per genuine checkout attempt; the server treats a
-- repeat of the same id BY THE SAME CUSTOMER as "already handled" instead of
-- creating another order.
--
-- SECURITY: uniqueness is scoped to (customer_id, checkout_submission_id),
-- not to the token alone. An idempotency token is not an authorization
-- token — two different customers presenting the same token must be treated
-- as two independent checkouts, and the application layer additionally scopes
-- every submission-id lookup to the authenticated customer so one customer's
-- token can never return another customer's order.
--
-- A partial index (rather than NOT NULL UNIQUE) keeps existing rows,
-- admin-created orders, and any other future order path valid without a
-- submission id, while still enforcing uniqueness whenever one is present.

alter table public.orders
  add column if not exists checkout_submission_id text;

-- Drop the earlier globally-unique index if a previous deploy created it.
drop index if exists public.orders_checkout_submission_id_key;

create unique index if not exists orders_customer_checkout_submission_id_key
  on public.orders (customer_id, checkout_submission_id)
  where checkout_submission_id is not null;
