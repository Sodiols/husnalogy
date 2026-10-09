# Row Level Security verification

Date: **2026-10-09**. What was tested, how, and with what result. "Local" means
the REAL Husnalogy schema and every migration on PostgreSQL (PGlite or
embedded PostgreSQL 17), with each request run as the PostgREST role a real
request uses (`anon`, or `authenticated` with the caller's JWT `sub`), never
as the service role. It is not a hosted Supabase project: PostgREST/GoTrue
themselves were not exercised (no staging project — **BLOCKED**).

## Evidence

| Suite | Engine | What it proves | Result |
|---|---|---|---|
| `lib/database/__tests__/supabase-grants-fidelity.test.ts` (new) | PostgreSQL 17 **with Supabase's real default privileges** (anon/authenticated get ALL on every public table, sequence and function), then every migration | RLS on all 53 tables; every SECURITY DEFINER function pins `search_path`; anon/authenticated can execute only a reviewed allowlist; anon, Customer B and a designer update/delete **0 rows they do not own in every table** (controls: anon really holds the grants; A really reaches own rows); 11 forged inserts refused; Storage policy matrix per bucket × role | **8/8 PASS** |
| `rls-authorization-matrix.test.ts` | PGlite | Customer A's private data visible to A, invisible to guest / B / designer; admins see orders & designs but not addresses or avatars; nobody but the owner changes A's data; no role escalation; customers cannot create orders directly; public surface hardening | PASS |
| `customer-addresses-rls.test.ts`, `account-routes.test.ts` | PGlite | Address book owner-only; profile/avatar routes | PASS |
| `postgres-concurrency.test.ts` | PostgreSQL 17 | Leases, idempotent checkout, cart claims under true concurrency; RLS/grants under separate backends | PASS |
| `backup-restore-drill.test.ts` (new) | PostgreSQL 17 | The same isolation holds on a database **restored from backup** | PASS |
| Production, read-only (publishable key) | hosted Supabase | anon → `profiles`, `orders`, `customer_addresses`, `product_customizations`, `contact_messages`, `newsletter_subscribers`: HTTP 401 *permission denied*; `site_settings`: 0 rows; `product_customizer_templates`: 200, 2 rows ✗ on 2026-10-09 → after the owner applied `20261007150000`: **401 `42501` (both rows) — VERIFIED IN PRODUCTION 2026-10-10**; published versions 20/20 still readable | PASS (anonymous) |
| `npm run test:staging` (`supabase-staging.test.ts`, real PostgREST/Auth/Storage) | hosted staging | — | **NOT RUN — BLOCKED** (no staging project) |

Full-suite totals are in [STAGING_E2E_RESULTS.md](STAGING_E2E_RESULTS.md).

## Authorization matrix (database layer)

R = read, W = insert/update/delete. ✓ allowed, ✗ refused/invisible (tested),
"—" not asserted by a test. Customer A owns every private row in the fixtures.

| Resource | Anonymous | Customer A (owner) | Customer B | Designer | Admin |
|---|---|---|---|---|---|
| Profiles (name, phone) | ✗ R/W (local; prod 401) | ✓ R; ✓ W own fields; ✗ role change | ✗ R/W of A; ✗ self-promotion; ✗ forged admin profile | ✗ R of A; ✗ role change | — R; role changes only via server |
| Addresses | ✗ (local; prod 401) | ✓ R/W own | ✗ R; ✗ insert for A | ✗ | ✗ (by design: not even admins) |
| Cart | ✗ R; ✗ forged insert for A | ✓ R/W own | ✗ | ✗ | — |
| Wishlist | ✗ | ✓ | ✗ | ✗ | — |
| Customizations (saved designs) | ✗ (prod 401) | ✓ R/W; ordered designs locked | ✗ R/W; ✗ insert for A | ✗ | ✓ R (fulfilment) |
| Photo library / upload records | ✗ | ✓ | ✗ | ✗ (unless assigned upload) | — |
| Products | ✓ R public & active only | same | same | ✗ W via table (server API with capability checks) | ✓ via server |
| Template drafts (`product_customizer_templates`) | ✗ local · ✗ **VERIFIED IN PRODUCTION** | ✗ | ✗ | via server (studio capability) | ✓ (production session test pending) |
| Published template versions | ✓ R for public active products | ✓ R | ✓ R | ✗ forged insert | ✓; immutable (trigger) |
| Orders / order items | ✗ (prod 401) | ✓ R own; ✗ change money/state; ✗ create directly | ✗ | ✗ | ✓ R |
| Design snapshots / production assets | ✗ | ✗ (server only) | ✗ | ✗ | ✓ R snapshots; ✗ forged asset insert by A |
| Render jobs | ✗ | ✓ R own | ✗ | ✗ | — |
| Production / notification tasks | ✗ | ✗ forged insert | ✗ | ✗ | server only |
| Site settings | ✗ (prod 0 rows) | ✗ forged insert | ✗ | ✗ | ✓ |
| Privileged RPCs (checkout, leases, task claims, health, reconciliation…) | ✗ not executable | ✗ | ✗ | ✗ | service role only |

## Policy review notes

* **SECURITY DEFINER exposure** (all pin `search_path`). Executable by
  anon/authenticated: `current_user_role`, `is_admin`, `is_designer`,
  `customizer_template_is_public` (read-only booleans about the caller / a
  template), `upsert_customizer_mockup` (authenticated; raises unless admin or
  service role). The other definer functions anon can technically execute are
  trigger functions, which PostgreSQL refuses to call directly.
  Everything else is revoked from anon and authenticated explicitly — which
  matters on Supabase, where a revoke from PUBLIC alone would leave anon's
  default grant in place.
* **Broad policies:** `using (true)`-style read access exists only on public
  catalogue tables and the public media buckets.
* **Service role** is used only server-side (no `NEXT_PUBLIC_` exposure; the
  build output is scanned for secrets — LAUNCH_CHECKLIST.md §1).
* **Production RLS** is verified only for anonymous reads (above). Signed-in
  cross-customer checks against production were not run: they need real
  customer sessions, and production is read-only for this work.

## To complete on a hosted project

1. Create staging (E2E_STAGING.md §6) → `npm run staging:migrate` →
   `npm run staging:seed` → `npm run test:staging` (13 real PostgREST/Auth/
   Storage tests incl. cross-customer isolation and signed URLs).
2. Production: `20261007150000` is applied and the probe prints `"ok":true`
   (2026-10-10). Still pending: real Admin/Designer sessions, live
   contact/newsletter submissions, migration-history entry
   (SECURITY_MIGRATION_20261007150000.md).
