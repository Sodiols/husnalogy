# Staging E2E environment (Playwright)

The full browser suite places **real orders**. Run it only against a dedicated
**staging** Supabase project — never against production data or real
customer accounts. Every staging command reads only `.env.staging` (template:
`.env.staging.example`) and refuses known production project refs and the
project configured in `.env.local`.

## 1. Staging Supabase project

1. Create a separate, disposable Supabase project (e.g. `husnalogy-staging`).
2. `cp .env.staging.example .env.staging` and fill it in (URL, publishable key,
   service-role key, the session-pooler `STAGING_DATABASE_URL`, the ref again in
   `STAGING_CONFIRM_PROJECT_REF`, a seed password, `CRON_SECRET`,
   `GOOGLE_FONTS_API_KEY`).
3. `npm run staging:migrate` — applies `schema.sql`, `hero_collections.sql` and
   every timestamped migration in order, one transaction per file, stopping at
   (and naming) the first failure. Re-runs skip applied files.
4. `npm run test:staging` — real PostgREST/Auth/Storage verification: the
   HOSTINGER_DEPLOYMENT.md §3 query, RLS on every table, private buckets,
   cross-customer isolation (orders, items, designs, cart, snapshots, assets,
   profile/address), anonymous access, privileged RPCs, protected columns,
   signed URLs, storage guard + cleanup bookkeeping, concurrent checkouts
   (same submission; different submissions, same cart), preparation leases,
   rollback, uniqueness/relationship constraints, worker leases, expired lease
   recovery, admin retry, concurrent reconciliation. A missing `.env.staging`
   FAILS this command (in plain `npm test` the suite is skipped with the reason).

## 2. Seed dedicated test data (reproducible, no hidden state)

```bash
npm run staging:seed
```

It creates, idempotently:

| Entity | Manifest key (`.customizer-e2e.json`, git-ignored) |
|---|---|
| Admin test account | `adminEmail` |
| Customer A test account | `customerAEmail` |
| Customer B test account | `customerBEmail` |
| Shared password | `password` |
| Personalized test product + published template + mockup + feature flags | `productId`, `productSlug`, `templateId` |
| Normal, listed test product with every option group incl. Paper Style | `normalProductId`, `normalProductSlug` |
| Customer A saved customization + uploaded asset | `customizationAId`, `customerAssetReference` |
| Customer B saved customization | `customizationBId` |
| Customizer URL | `customizerUrl` |
| Admin product URL | `adminProductUrl` |

Cart state is created by each test through the storefront's own Supabase
REST path (`createCartLine`), never prepared by hand.

## 3. Environment for Playwright

`npm run test:e2e:staging` sets these from `.env.staging`; override only if needed.

| Variable | Value |
|---|---|
| `E2E_BASE_URL` | a staging deployment of THIS build (with `ENABLE_CUSTOMIZER_E2E_FIXTURE=1`); empty = a fresh local server on port 3200 with the staging variables |
| `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY` | set automatically from the staging URL and publishable key |
| `E2E_CUSTOMER_EMAIL` / `E2E_CUSTOMER_PASSWORD` | optional overrides of Customer A |
| `E2E_CUSTOMER_B_EMAIL` / `E2E_CUSTOMER_B_PASSWORD` | optional overrides of Customer B |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | optional overrides of the admin |
| `E2E_CUSTOMIZER_URL`, `E2E_CUSTOMIZATION_A_ID`, `E2E_ADMIN_PRODUCT_URL` | optional overrides of manifest values |

A staging deployment needs the variables in HOSTINGER_DEPLOYMENT.md §2 (with
staging values), including `CRON_SECRET` and a Resend **test** key or none
(emails then wait as deferred tasks).

## 4. Run

```bash
npx playwright install chromium webkit
npm run test:e2e:staging
```

It prints `{"e2e":{"executed","passed","failed","flaky","skipped","collectionErrors"}}`
and FAILS when tests failed, nothing executed, or specs could not even be
collected — a run that never started is never reported as passed.

What it covers (spec files in `e2e/`): homepage, listing, product page and
option selection incl. Paper Style, add to cart, cart quantity edit and removal
(`storefront-staging.spec.ts`); valid and manipulated options
(`checkout-adversarial.spec.ts`); customizer open, text editing, allowed font
and colour changes, upload, save, reload (`customer-journey-multitab.spec.ts`,
`customer-customizer.spec.ts`, `google-fonts.spec.ts`,
`customizer-text-editing.spec.ts`); add customized item, checkout with customer
details, delivery, terms, COD, confirmation, cart consumption, order history
and details, admin login and order visibility, production and notification
task existence; **real multi-tab and multi-device checkout**
(`customer-journey-multitab.spec.ts`: separate Playwright pages/contexts, the
same signed-in customer and cart, browser-generated submission ids, Place
order pressed simultaneously → exactly one order, one cart consumption, no
duplicate production/notification task or snapshot, the other tab gets a
controlled 409 and is then shown the placed order); session expiry,
cross-customer protection and unauthorized admin access
(`storefront-staging.spec.ts`, `checkout-adversarial.spec.ts`,
`admin-security-render.spec.ts`); option persistence
(`product-option-persistence.spec.ts`, fixture-based).

Without the seeded manifest the seeded specs stop with an explicit
"Seeded Customizer V2 acceptance cannot run" error — they are never reported
as passed. `npm run test:e2e:public` runs only the public smoke specs.

## 5. Controlled staging order (before launch)

After the suite passes, place one order by hand on staging as Customer A
(personalized product, uploaded photo, COD) and check in SQL: the order is
`finalized` with the correct total/currency/customer/terms version; the cart
line is claimed; one order item, one snapshot linked to it, pinned assets in
`order_production_assets`; one production task and two notification tasks;
after the next worker run a completed render job with a `ready` output whose
checksum matches (`GET /api/admin/production/health` → 200).

For snapshot independence, place a second such order **with the staging cron
paused**, then delete the live customization, edit the live template, archive
the product and delete the temporary customer upload; run the worker once by
hand and confirm the render completes from the order's own snapshot and pinned
assets (automated equivalent: the "REGRESSION" test in
`lib/customizer/__tests__/snapshot-production.test.ts`).
