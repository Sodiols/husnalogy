# Supabase architecture, staging and data-protection audit

Audit date: **2026-10-09**. Scope: how Husnalogy uses Supabase (Auth, PostgREST,
RPC, Storage), what protects each trust boundary, what has been verified and
where, and what is still blocked. Everything here was read from the code or
measured; nothing is assumed.

Related: [E2E_STAGING.md](E2E_STAGING.md) (staging setup — this repo's
"SUPABASE_STAGING_SETUP"), [SUPABASE_RLS_VERIFICATION.md](SUPABASE_RLS_VERIFICATION.md),
[SUPABASE_STORAGE_VERIFICATION.md](SUPABASE_STORAGE_VERIFICATION.md),
[STAGING_E2E_RESULTS.md](STAGING_E2E_RESULTS.md),
[PRODUCTION_BACKUP_STRATEGY.md](PRODUCTION_BACKUP_STRATEGY.md),
[HUSNALOGY_DISASTER_RECOVERY.md](HUSNALOGY_DISASTER_RECOVERY.md),
[BACKUP_RESTORE_TEST_RESULTS.md](BACKUP_RESTORE_TEST_RESULTS.md).

## 1. Environments as they exist today

| Environment | Supabase project | Status |
|---|---|---|
| Production | the project in `.env.local` (ref listed in `scripts/staging/staging-env.mjs` → `PRODUCTION_PROJECT_REFS`) | Treated as **production**: read-only probes only. Holds 6 profiles, 2 products, 2 orders, 75 Storage objects (2026-10-09). |
| Staging | **none** | No separate Supabase project exists. All "real hosted staging" checks are **BLOCKED** (owner decision 2026-10-09: no new project during this task). Template: `.env.staging.example`. |
| Local verification | PostgreSQL 17 (embedded-postgres) and PGlite, built from `supabase/schema.sql` + every migration, plus the Supabase role/auth/storage scaffolding (`lib/testing/supabase-scaffold.mjs`) | Used for migration, RLS, Storage-policy, concurrency and backup/restore tests. **Not Supabase**: no PostgREST, GoTrue or Storage API. |
| Local Supabase stack (`supabase start`) | — | Not possible on this machine: no Docker, no Supabase CLI. |

## 2. How the application talks to Supabase

| Path | Client | Credential | Where |
|---|---|---|---|
| Browser (storefront, account, customizer UI) | `@supabase/ssr` browser client | publishable key + the user's session | `lib/supabase/client.ts`, `app/lib/auth.ts`, `app/lib/useAuth.ts`, `app/lib/customer-lists.ts` |
| Server components / route handlers acting **as the user** | `createClient()` (`@supabase/ssr` server client, cookies) | publishable key + session cookie → RLS applies | `lib/supabase/server.ts`; account, customization, customizer upload/resolve/library routes |
| Server acting **as the system** | `createServiceRoleClient()` | `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) | `lib/supabase/server.ts` (60 s bounded fetch), `lib/storage/supabase-storage.ts`, `app/api/admin/uploads/route.ts`, checkout, worker, render, signing |
| Session refresh / route gating | `proxy.js` (Next 16 middleware) | session cookie | refreshes sessions; `/admin`, `/designer`, `/account`… |
| Auth | Supabase Auth: email+password (`signUp`, `signInWithPassword`), password reset (`resetPasswordForEmail` → `/reset-password`), Google OAuth (`signInWithOAuth` → `/auth/callback` → `exchangeCodeForSession`) | — | `app/lib/auth.ts`, `app/auth/callback/route.ts` |
| Database functions | 33 RPCs called by the server (checkout `create_checkout_order`, preparation leases, production/notification task claims, render job claims, storage cleanup, health, reconciliation) | service role (all privileged RPCs are revoked from anon/authenticated) | `lib/orders`, `lib/worker`, `lib/customizer` |
| Worker / cron | `POST /api/admin/customizer/render/process` with `Authorization: Bearer $CRON_SECRET` (or `RENDER_WORKER_SECRET`) | `lib/security/worker-auth.ts` | hPanel cron (HOSTINGER_DEPLOYMENT.md §5) |
| Direct PostgreSQL | **not used by the app**; only by ops tools (`staging:migrate`, `backup:db`, `restore:db`) with an explicit connection string | DB password, operator only | `scripts/staging`, `scripts/backup` |

### Trust boundaries

1. **Browser → PostgREST (publishable key):** only RLS stands between a user and
   the data. Supabase grants anon/authenticated ALL on public tables by default,
   so every table must have RLS and correct policies (verified: §4).
2. **Browser → Next.js API → service role:** routes that use the service role
   must authorize the caller themselves: `requireAdmin` / the capability layer
   in `lib/auth/roles.ts` (`withAdminMutation` on every `/api/admin` mutation,
   enforced by a structural test), ownership re-reads for designers and
   customers, `expectedUserId` preconditions on customizer saves.
3. **Browser → Storage:** private buckets are reachable only through
   server-signed URLs or server routes; Storage RLS decides direct access
   (verified: SUPABASE_STORAGE_VERIFICATION.md).
4. **Cron → worker:** bearer secret, constant-time compared; health endpoint
   requires the same secret.
5. **Role assignment:** `profiles.role` cannot be changed through the public API
   (trigger + policies; verified under Supabase grants).

### Data that matters (and where it lives)

| Data | Tables | Files (bucket) |
|---|---|---|
| Accounts | `auth.users`, `auth.identities`, `profiles` | `customer-avatars` (private) |
| Addresses | `customer_addresses` | — |
| Catalogue | `products`, `product_images/mockups/videos/variants`, `categories`, `product_collections*`, `hero_collections`, `site_settings` | `product-images`, `product-mockups`, `product-videos`, `site-assets` (public) |
| Design templates | `product_customizer_templates` (drafts), `customizer_template_versions` (immutable published versions) | `customizer-elements` (private admin assets), `admin-assets` |
| Customer designs | `product_customizations` (`values`, `asset_references` hold `{bucket, storagePath, editorStoragePath, thumbnailStoragePath}`), `customer_asset_library`, `customer_uploads` | `customer-uploads` (private, `<user id>/…`) |
| Cart / wishlist | `cart_items`, `wishlist_items`, `checkout_cart_claims` | — |
| Orders | `orders`, `order_items`, `order_design_snapshots` (integrity-hashed), `order_production_assets` (pinned, checksummed) | `order-production` (private; pinned files cannot be deleted while referenced) |
| Production | `production_tasks`, `customizer_render_jobs`, `customizer_render_outputs`, `notification_tasks`, `worker_runs` | `customizer-renders` (private) |

## 3. Migrations

* Order: `schema.sql` → `hero_collections.sql` → 22 timestamped files
  (`scripts/staging/apply-migrations.mjs`; one transaction per file; SHA-256
  history in `husnalogy_ops.applied_migrations`; an edited applied file is refused).
* **Fresh-database test: PASS** — all files apply cleanly, in order, on a
  fresh PostgreSQL 17 that starts like a new Supabase project, both with the
  plain scaffold (`staging-tooling.test.ts`) and with Supabase's real default
  privileges (`supabase-grants-fidelity.test.ts`). No duplicate or out-of-order
  ids. 53 public tables, 10 buckets.
* **Production drift (read-only probe, `npm run probe:schema -- --env .env.local`):**
  on 2026-10-09/10 the RPC `customizer_template_is_public` was missing and
  the publishable key read 2 rows of `product_customizer_templates` — migration
  `20261007150000_rls_public_surface_hardening.sql` was not applied. The owner
  applied it; on 2026-10-10 the probe returns `"ok":true` and the drafts are
  refused to the public key (VERIFIED IN PRODUCTION, see F1). Policy-only
  migrations are not visible to this probe; the HOSTINGER_DEPLOYMENT.md §3
  query in the production SQL editor confirms the rest.

## 4. Findings

| # | Severity | Finding | Evidence | Action (needs owner approval) |
|---|---|---|---|---|
| F1 | **High** — **RESOLVED** (anonymous draft access) | Migration `20261007150000` was missing in production: unreviewed customizer drafts readable with the public key; direct anonymous inserts into `contact_messages` / `newsletter_subscribers` may still be allowed. | probe + anon GET → HTTP 200, 2 rows | Applied by the owner. **VERIFIED IN PRODUCTION 2026-10-10:** probe `ok:true`; the public key gets `42501` on drafts (both previously exposed rows); 20/20 published versions still public. **Pending:** real Admin/Designer sessions, live contact/newsletter submissions (and refusal of direct anonymous inserts), migration-history entry — [SECURITY_MIGRATION_20261007150000.md](SECURITY_MIGRATION_20261007150000.md). |
| F2 | **High** (launch blocker) | The production worker has **never run** against this project (`worker_runs` is empty). One checkout preparation has been stuck in `preparing` since its lease expired on 2026-10-07; two failed preparations wait for Storage cleanup; their 4 files remain in `order-production`. Pending production/notification tasks are not processed. | read-only queries 2026-10-09 | Re-verified 2026-10-10 (`npm run worker:queue-summary`): the first run would send **4 e-mails** (2 confirmations + 2 admin alerts for orders of 5 and 8 Oct), expire 1 lease, clean 2 abandoned checkouts. Approval-gated first-run procedure: HOSTINGER_DEPLOYMENT.md §5 "First production run"; rehearsed in `worker-first-run.test.ts`. **Pending owner approval.** |
| F3 | **High** (launch blocker) | No verified database backup exists for production; plan, retention and PITR status are unknown (no dashboard / Management API access here). Storage files have no backup at all. | — | Backup tooling hardened 2026-10-10 (identity cross-check, encrypted metadata, mandatory snapshot consistency, verified off-site upload, retention, monitoring, GitHub workflow). **Pending configuration and approval** (PRODUCTION_BACKUP_STRATEGY.md §9). |
| F4 | Medium | No staging project: PostgREST/GoTrue/Storage-API behaviour (signed URLs, size/MIME enforcement, auth emails, OAuth redirects, real multi-tab checkout) is unverified on a hosted project. | — | Create `husnalogy-staging` when time allows (E2E_STAGING.md §6). |
| F5 | Medium | After a restore into a NEW project, stored absolute Storage URLs (product thumbnails, product images, mockups, hero images, settings) point at the OLD project. | drill | Built `npm run restore:rewrite-urls` (dry-run by default; drill-tested). In the runbook. |
| F6 | Low | 11 unreferenced Storage objects in production (4 = the stuck preparation above, 7 = old logo / collection images in public buckets). | `backup:reconcile` | Review only. Nothing was deleted. |
| F7 | Info | `customer-uploads` lets the owner delete their own upload object directly (policy `customer_uploads_owner_delete_storage`). Orders are unaffected (production uses pinned copies in `order-production`), but a saved draft design can lose its photo. | grants-fidelity test | Decide whether to keep; no change made. |

No application code defect was found by this pass. Two browser tests had
timing assumptions that made them fail intermittently (a performance check
measured a selection's delayed re-renders as drag cost; a WebKit test typed
under the "Loading your design…" overlay); both were fixed and re-verified.
Full results: [STAGING_E2E_RESULTS.md](STAGING_E2E_RESULTS.md).

## 5. Staging safety guard (implemented)

`scripts/staging/staging-env.mjs` (all staging tools) and
`scripts/backup/lib/target.mjs` (all restore tools):

* read only `.env.staging` / an explicitly named env file — never `.env.local`;
* **refuse** known production refs (`PRODUCTION_PROJECT_REFS` +
  `HUSNALOGY_PRODUCTION_SUPABASE_REFS`) and the project in `.env.local`;
* require an explicit confirmation of the target identity
  (`STAGING_CONFIRM_PROJECT_REF`, `RESTORE_CONFIRM_TARGET`) — an allowlist of
  one, typed by the operator;
* require the API URL and the database URL to resolve to the same project;
* print the operation, target identity and kind before acting (never secrets);
* destructive restore steps additionally refuse a target that already holds
  accounts/profiles/orders unless `--replace-existing-data` is given;
* backups (`npm run backup:run`, the only entry point) prove the database
  and the Storage API are the approved project before writing anything, are
  always encrypted (no plaintext mode), and refuse an inconsistent snapshot
  (`scripts/backup/lib/source.mjs`, PRODUCTION_BACKUP_STRATEGY.md §3–§6).

Tested in `staging-tooling.test.ts`, `backup-tooling.test.ts`,
`backup-restore-drill.test.ts`.
