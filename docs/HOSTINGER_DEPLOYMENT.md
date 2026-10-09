# Husnalogy — Hostinger production deployment

Husnalogy is a normal Node.js Next.js **server** application (server routes,
Supabase SSR auth, admin/designer workspaces, checkout, the render worker).
It must run with `next start`. Do **not** use static export.

No secrets belong in this file, in git, or in any `NEXT_PUBLIC_` variable.

---

## 1. Runtime

| Setting | Value |
|---|---|
| Node.js version | **22.x (LTS)**. Pinned in `package.json` `engines` and `.nvmrc`. In hPanel → Node.js app, select **22.x** (not 20 or 24): the final release validation (install, typecheck, lint, tests, build, Playwright, audit, sharp/resvg native binaries) ran on Node v22.23.3, and the host must run the same major. Check after deploy: the startup log line `▲ Next.js …` and `node -v` over SSH. |
| Install command | `npm ci` |
| Build command | `npm run build` (runs `next build --webpack`; see below) |
| Start command | `npm start` (runs `next start`; it honours Hostinger's `PORT`) |
| Application root | the repository root (the folder containing `package.json`) |

`npm run build` needs the `NEXT_PUBLIC_*` variables **at build time**, because
they are inlined into the bundle. `NEXT_PUBLIC_SUPABASE_URL` also decides which
Supabase host may serve images. A production build stops with a clear error
when it is missing, or when `NEXT_PUBLIC_SITE_URL` is not an `https://` public
origin. **Changing a `NEXT_PUBLIC_` value in hPanel needs a rebuild to take
effect.**

The production build uses **Webpack, not Turbopack**. Hostinger's build servers
have glibc older than 2.29, so Next.js's native SWC binary cannot load and it
falls back to WebAssembly bindings, which Turbopack does not support. Keep
`--webpack` in the build script; `npm run dev` still uses Turbopack locally.

At `npm start` the server checks every required variable (see
`instrumentation.ts` and `lib/env/server-env.ts`). If one is missing or
malformed, the process exits and the log names the variable. It never prints
the value.

---

## 2. Environment variables

Set these in hPanel → your Node.js app → **Environment variables**. Anything
marked *secret* must never be given a `NEXT_PUBLIC_` prefix.

| Variable | Required | Visibility | Value / notes |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | **yes** (build + run) | public | `https://husnalogy.com`. Must be https and not localhost. Used for canonical URLs, sitemap, robots and auth redirects. |
| `NEXT_PUBLIC_SUPABASE_URL` | **yes** (build + run) | public | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **yes** (build + run) | public | Supabase publishable (or legacy anon) key. RLS protects the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | **secret** | Supabase service-role / `sb_secret_` key. Bypasses RLS and is server-only. |
| `GOOGLE_FONTS_API_KEY` | **yes** | **secret** | Google Fonts Developer API key. Needed for the customizer font catalog and print rendering. |
| `CRON_SECRET` | **yes** | **secret** | At least 32 characters. Authenticates the render worker cron job. Generate with `openssl rand -hex 32`. |
| `RENDER_WORKER_SECRET` | optional | **secret** | Second accepted worker secret, e.g. while rotating `CRON_SECRET`. At least 32 characters. |
| `UPSTASH_REDIS_REST_URL` | optional | **secret** | Set together with the token to make rate limits global across instances. Without both, the in-memory limiter is used and the site still starts. |
| `UPSTASH_REDIS_REST_TOKEN` | optional | **secret** | See above. |
| `REQUIRE_DISTRIBUTED_RATE_LIMIT` | optional | server | Set to `1` when more than one app instance serves traffic: startup then FAILS unless Upstash is configured. Leave unset for the single `npm start` process Hostinger runs (the in-memory limiter is exact for one process). |
| `RESEND_API_KEY` | **yes for email** | **secret** | Resend API key. Order confirmation and new-order emails are queued durably and sent by the worker; without it they wait (nothing is lost) and startup warns. |
| `EMAIL_FROM` | with the key | server | Verified sender, e.g. `Husnalogy <orders@husnalogy.com>` (domain verified in Resend). |
| `EMAIL_REPLY_TO` | optional | server | Reply-to address for customer emails. |
| `ORDER_NOTIFICATION_EMAIL` | recommended | server | Where new-order alerts go. Defaults to the store email in Admin → Settings. |
| `SENTRY_DSN` | **yes for monitoring** | **secret** | Sentry (or GlitchTip) DSN. Unhandled server errors and every error-level event (checkout, production task, render, worker, email failures) are reported; secrets and personal data are scrubbed. Without it, errors are only in the app log and startup warns. |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | optional | server | Tags for monitoring events. |
| `TRUSTED_PROXY_HOPS` | optional | server | Number of reverse proxies in front of Node that APPEND to `X-Forwarded-For` (default **1**). Rate limits use the address that many entries from the RIGHT (a port the proxy appended is ignored); the client-supplied leftmost entry is never trusted, and a chain SHORTER than this number resolves to `unknown` (one shared bucket) instead of a guess. **The default is an assumption about Hostinger's topology, not a verified fact** — verify it after every deployment (section 9, "Rate limiting"). Never set `0` here (every anonymous visitor would share one bucket). |
| `OPENAI_API_KEY` | optional | **secret** | Ask Logy. Falls back to local answers when absent. |
| `OPENAI_MODEL`, `LOGY_USE_OPENAI` | optional | server | Ask Logy tuning. |
| `ICONIFY_API_BASE_URL` | optional | server | Defaults to the public Iconify API. No key. |
| `DELETE_ADMIN_EMAIL`, `DELETE_ADMIN_PASSWORD` | optional | **secret** | Enables permanent product deletion only. Leave unset to keep it disabled. |
| `ENABLE_CUSTOMIZER_E2E_FIXTURE` | **must be unset** | server | Test fixture pages. Never set on the live site. |
| `NEXT_DIST_DIR` | **must be unset** | server | Test infrastructure only (a separate build folder for the isolated e2e server). Ignored by production builds. |

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted as a legacy alias for the
publishable key. `STORAGE_DRIVER` in `.env.example` is informational only;
Supabase Storage is always used.

---

## 3. Supabase: migrations to verify before launch

Do not assume production already has them. Apply any missing migration **in
filename order** from `supabase/migrations/`, in the Supabase SQL editor or with
`supabase db push`. Never edit a migration that has already run, never reset
the database, and never drop tables. The migrations are written to be additive
(`if not exists`, `create or replace`, `drop policy if exists`).

| # | Migration | Why it matters |
|---|---|---|
| 1 | `supabase/schema.sql` (core schema, fresh projects only) | Tables, RLS, storage buckets |
| 2 | `hero_collections.sql` | Homepage hero section |
| 3 | `20260714120000_customizer_v2.sql` | Customizer tables, render queue |
| 4 | `20260714153000_customizer_v2_completion.sql` | Render/mockup columns |
| 5 | `20260714210000_customizer_v2_production_hardening.sql` | Render job claim/lease RPCs. **The worker needs these.** |
| 6 | `20260718120000_customizer_v2_customer_parity.sql` | Audit log |
| 7 | `20260719120000_customizer_v2_schema_consolidation.sql` | Triggers/columns |
| 8 | `20260719180000_permanent_admin_asset_library.sql` | Admin asset library |
| 9 | `20260726120000_customizer_public_versioning.sql` | Immutable published versions |
| 10 | `20260823120000_lock_ordered_customizations.sql` | Ordered designs immutable |
| 11 | `20260824090000_checkout_idempotency.sql` | Duplicate-order protection |
| 12 | `20260824180000_customizer_asset_source_provenance.sql` | Element licensing |
| 13 | **`20260917120000_restrict_site_settings_read.sql`** | **BLOCKER.** Without it the SMTP and payment secrets in `site_settings` are readable with the public key. |
| 14 | **`20260918120000_designer_role_and_product_workflow.sql`** | **BLOCKER.** Product ownership and workflow columns. The designer workspace and admin product APIs read them. |
| 15 | **`20260919120000_production_security_hardening.sql`** | **BLOCKER.** Stops a signed-in customer from making themselves `admin` by updating `profiles.role`, and removes direct customer `orders` inserts. |
| 17 | **`20261001120000_checkout_cart_claims_and_outbox.sql`** | **BLOCKER — apply BEFORE deploying the matching app build, after #16.** Cart lines consumed inside the checkout transaction (no duplicate orders across tabs/devices), mandatory snapshot↔order item linkage, durable `production_tasks` / `notification_tasks` (outbox), worker heartbeat + `production_health()`, identity immutability of finalized history. |
| 16 | **`20260930120000_checkout_integrity_hardening.sql`** | **BLOCKER — apply BEFORE deploying the matching app build.** The atomic `create_checkout_order` transaction (the new checkout calls it), durable order states, one-order-per-design, column guards on `product_customizations`, immutable order financials/snapshots, the customer-uploads storage IDOR fix, strict customer-id order visibility. See `docs/CHECKOUT_ARCHITECTURE.md`. |
| 19 | **`20261003120000_worker_isolation_checkout_preparation.sql`** | **BLOCKER — apply together with the matching application build, after #18.** Checkout preparation leases (one expensive preparation per customer; the order transaction must consume a lease — the PREVIOUS app build is refused with `CHECKOUT_PREPARATION_REQUIRED`), cleanup-item lifecycle with dead-lettering, per-subsystem worker health, serialized reconciliation, asset/snapshot size backstops, `server_clock()`, and a fix to `guard_fulfillment_history_delete()` (real PostgreSQL refused every order delete). Pause checkout, apply, deploy, resume. |
| 18 | **`20261002120000_snapshot_owned_production.sql`** | **BLOCKER — requires a coordinated checkout/worker pause and matching application deployment.** Versioned, order-owned rendering; pinned private originals/fonts/licenses; audited recovery; explicit manual mode; output verification and reconciliation. Read `docs/SNAPSHOT_PRODUCTION.md` before applying. |
| 20 | `20261005120000_customizer_font_favourites.sql` | Husnalogy-wide favourite fonts. |
| 21 | **`20261007120000_customer_addresses.sql`** | **BLOCKER — apply BEFORE deploying the matching app build.** Saved addresses move from a browser key shared by every account to `customer_addresses` (RLS: owner only; no admin/anon access; one default; max 10). The account page, checkout and `/saved-addresses` call `/api/account/addresses`. |
| 22 | **`20261007130000_customer_profile_and_avatars.sql`** | **BLOCKER — apply BEFORE deploying the matching app build.** `profiles.avatar_path`, bounds on customer-writable profile columns (added `NOT VALID`: new writes only), and the PRIVATE `customer-avatars` bucket used by the real profile-photo upload. |
| 23 | `20261007140000_admin_media_limits.sql` | `product-videos` bucket limit = the application's 30 MB video limit. |
| 24 | **`20261007150000_rls_public_surface_hardening.sql`** | **Apply with this build.** Unreviewed customizer drafts are no longer readable with the public key (published versions still are, via `customizer_template_is_public()`); contact messages and newsletter sign-ups can only be written through the rate-limited API routes. |

Run this query in the SQL editor. **Every row must be `true`:**

```sql
select * from (values
  ('customizer_v2',                 to_regclass('public.customizer_render_jobs') is not null),
  ('customizer_v2_completion',      exists (select 1 from information_schema.columns where table_schema='public' and table_name='customizer_render_outputs' and column_name='render_engine_version')),
  ('production_hardening (RPCs)',   to_regprocedure('public.claim_customizer_render_job(uuid,text,integer)') is not null
                                    and to_regprocedure('public.recover_abandoned_customizer_render_jobs()') is not null),
  ('customer_parity',               to_regclass('public.customizer_audit_logs') is not null),
  ('permanent_admin_asset_library', to_regclass('public.customizer_asset_folders') is not null),
  ('public_versioning',             to_regprocedure('public.prevent_customizer_version_mutation()') is not null),
  ('lock_ordered_customizations',   to_regprocedure('public.protect_ordered_customization_design()') is not null),
  ('checkout_idempotency',          exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='checkout_submission_id')),
  ('asset_source_provenance',       exists (select 1 from information_schema.columns where table_schema='public' and table_name='customizer_assets' and column_name='source_provider')),
  ('hero_collections',              to_regclass('public.hero_collections') is not null),
  ('site_settings NOT public',      not exists (select 1 from pg_policies where schemaname='public' and tablename='site_settings' and policyname='site_settings_public_read')
                                    and exists (select 1 from pg_policies where schemaname='public' and tablename='site_settings' and policyname='site_settings_admin_read')),
  ('designer_workflow',             exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='workflow_state')
                                    and to_regprocedure('public.is_designer()') is not null),
  ('profile role protected',        exists (select 1 from pg_trigger where tgname='protect_profile_role' and not tgisinternal)),
  ('no direct order inserts',       not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='orders_customer_insert_own')),
  ('checkout transaction',          to_regprocedure('public.create_checkout_order(jsonb,jsonb,jsonb,jsonb)') is not null
                                    and not has_function_privilege('authenticated', 'public.create_checkout_order(jsonb,jsonb,jsonb,jsonb)', 'execute')),
  ('durable order state',           exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='checkout_state')),
  ('one order per design',          to_regclass('public.order_items_customization_once') is not null),
  ('customization writes guarded',  exists (select 1 from pg_trigger where tgname='guard_customization_writes' and not tgisinternal)
                                    and not has_table_privilege('authenticated', 'public.product_customizations', 'update')),
  ('snapshots immutable',           exists (select 1 from pg_trigger where tgname='protect_order_design_snapshot' and not tgisinternal)),
  ('upload storage IDOR closed',    not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='customer_uploads_owner_insert_storage')),
  ('cart consumption',              to_regclass('public.checkout_cart_claims') is not null
                                    and position('checkout_cart_claims' in pg_get_functiondef('public.create_checkout_order(jsonb,jsonb,jsonb,jsonb)'::regprocedure)) > 0),
  ('snapshot linkage required',     exists (select 1 from pg_constraint where conname='order_design_snapshots_order_item_required')
                                    and exists (select 1 from pg_constraint where conname='order_design_snapshots_order_item_id_fkey_cascade')),
  ('production outbox',             to_regclass('public.production_tasks') is not null
                                    and to_regprocedure('public.claim_production_tasks(integer,integer,text)') is not null
                                    and to_regprocedure('public.enqueue_missing_production_tasks(integer)') is not null),
  ('notification outbox',           to_regclass('public.notification_tasks') is not null
                                    and to_regprocedure('public.claim_notification_tasks(integer,integer,text)') is not null),
  ('worker health',                 to_regprocedure('public.production_health()') is not null and to_regclass('public.worker_runs') is not null),
  ('one snapshot guard',            not exists (select 1 from pg_trigger where tgname='protect_order_design_snapshot_identity' and not tgisinternal)),
  ('outbox not customer callable',  not has_function_privilege('authenticated', 'public.claim_production_tasks(integer,integer,text)', 'execute')
                                    and not has_table_privilege('authenticated', 'public.production_tasks', 'insert')),
  ('checkout preparation leases',   to_regclass('public.checkout_preparations') is not null
                                    and exists (select 1 from pg_trigger where tgname='verify_consume_checkout_preparation' and not tgisinternal)
                                    and not has_function_privilege('authenticated', 'public.acquire_checkout_preparation(uuid,text,text,text,integer)', 'execute')),
  ('cleanup lifecycle',             to_regclass('public.production_storage_cleanup_items') is not null
                                    and to_regprocedure('public.claim_storage_cleanup_items(integer,integer,integer,integer)') is not null
                                    and to_regprocedure('public.review_storage_cleanup_item(uuid,uuid,text,text)') is not null),
  ('subsystem health',              to_regclass('public.worker_subsystem_runs') is not null
                                    and to_regprocedure('public.record_worker_subsystems(text,jsonb)') is not null
                                    and to_regprocedure('public.server_clock()') is not null),
  ('serialized reconciliation',     position('husnalogy-reconcile-production' in pg_get_functiondef('public.reconcile_production(integer)'::regprocedure)) > 0),
  ('history delete guard fixed',    position('to_jsonb(old)' in pg_get_functiondef('public.guard_fulfillment_history_delete()'::regprocedure)) > 0),
  ('asset budget backstop',         exists (select 1 from pg_trigger where tgname='guard_order_production_asset_budget' and not tgisinternal)
                                    and exists (select 1 from pg_constraint where conname='order_design_snapshots_serialized_size')),
  ('customer addresses (RLS)',      to_regclass('public.customer_addresses') is not null
                                    and (select relrowsecurity from pg_class where oid = 'public.customer_addresses'::regclass)
                                    and not has_table_privilege('anon', 'public.customer_addresses', 'select')
                                    and exists (select 1 from pg_trigger where tgname='guard_customer_address' and not tgisinternal)),
  ('profile photo storage',         exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='avatar_path')
                                    and exists (select 1 from storage.buckets where id='customer-avatars' and public = false)
                                    and exists (select 1 from pg_constraint where conname='profiles_avatar_path_own_folder')),
  ('video limit = app limit',       (select file_size_limit from storage.buckets where id='product-videos') = 31457280),
  ('drafts not public',             not exists (select 1 from pg_policies where schemaname='public' and tablename='product_customizer_templates' and policyname='customizer_templates_public_read_active')
                                    and not has_table_privilege('anon', 'public.product_customizer_templates', 'select')
                                    and to_regprocedure('public.customizer_template_is_public(uuid)') is not null),
  ('no direct public inserts',      not has_table_privilege('anon', 'public.contact_messages', 'insert')
                                    and not has_table_privilege('anon', 'public.newsletter_subscribers', 'insert'))
) as checks(migration, applied);
```

Also check:

- **RLS is enabled on every public table.** This query must return no rows:
  `select tablename from pg_tables where schemaname='public' and not rowsecurity;`
- **Storage buckets.** `customer-uploads`, `customer-avatars`, `customizer-renders`,
  `customizer-elements`, `order-production` and `admin-assets` are **private**. `product-images`, `product-mockups`,
  `product-videos` and `site-assets` are public, read-only for everyone and
  writable by admins only. Check with:
  `select id, public from storage.buckets;`
- **Snapshot linkage of legacy orders.** Read-only; rows returned are legacy
  snapshots without an order item (kept, never deleted; new ones are refused):
  `select id, order_id, created_at from public.order_design_snapshots where order_item_id is null;`
- **Production health.** `select public.production_health();` — after the
  worker has run once, `worker.last_status` is `ok` and `unscheduledSnapshots`
  is `0`.
- **Every active product has a published customizer version**, if it offers
  personalization. See `docs/LAUNCH_CHECKLIST.md` §3.
- Create the first admin with the SQL editor, which runs as a database owner:
  `update public.profiles set role = 'admin' where email = '<owner email>';`
  The role trigger allows this there and refuses it through the public API.

### Staging first (required before production)

Apply and verify everything on a **dedicated, disposable staging project**
before production — never against the live project:

```bash
npm run staging:migrate     # schema.sql → hero_collections.sql → timestamped files; one transaction per file
npm run staging:seed        # e2e accounts (admin, Customer A, Customer B), products, designs
npm run test:staging        # real PostgREST/Auth/Storage/RLS/RPC/concurrency checks
npm run test:e2e:staging    # complete Playwright suite incl. real multi-tab checkout
```

All four read only `.env.staging` (template `.env.staging.example`), refuse
known production project refs and the project in `.env.local`, and require
`STAGING_CONFIRM_PROJECT_REF`. `staging:migrate` records each applied file with
its SHA-256 in `husnalogy_ops.applied_migrations`, skips applied files, refuses
an edited applied file, and stops at the first failing file — reporting its
name — with nothing of that file applied. Details: `docs/E2E_STAGING.md`.

### Migration file names (reviewed 2026-10-02)

`20261001120000`, `20261002120000` and `20261003120000` carry dates up to two
days after the files were written. They are **kept as they are**: their order
is correct (each depends only on earlier files), and objects of
`20261003120000` were found in a persistent project, so renaming could make a
tracked history disagree with the files. New migrations must use a timestamp
later than `20261003120000`.

### If a migration fails or must be backed out

**Snapshot production (#18) changes the compatibility boundary.** Pause new
personalized checkout and worker invocations, back up the database and private
storage, apply #18 once through migration tracking, deploy this matching build,
verify the chain and resume. The previous application cannot create a valid v1
production contract and must not be used as a checkout/worker rollback after
#18. Fix forward or restore a coordinated database/storage/application backup.
The older compatibility notes below apply only to #16 and #17. The new migration
is transactional and safe to replay in full after an existing-object error. It
recreates its named constraints/triggers/policies, replaces functions and keeps
existing fulfillment data. The original queue-health function is renamed only
on the first application. Run the complete file, including `begin` and `commit`.

- Each migration is one transaction in the SQL editor: a failure leaves the
  database exactly as it was. Read the error, fix the cause (usually a missing
  earlier migration), re-run. Both checkout migrations are safe to re-run.
- **Deploy order protects you:** the new application needs migrations #16 and
  #17; the previous application keeps working on the migrated database (the
  RPC signature is unchanged and the old code does not use the new tables),
  except that customers can no longer write `product_customizations` directly
  (the new `/api/customizations` does it server side). So: migrate → verify →
  deploy the app; to roll the APP back, redeploy the previous build — no
  database rollback is needed.
- A true database rollback is a restore from the backup taken first (Supabase
  → Database → Backups / PITR). Do not hand-drop tables or triggers: they hold
  order history.

---

## 4. Auth URLs (Supabase and Google)

**Supabase → Authentication → URL Configuration**

- Site URL: `https://husnalogy.com`
- Redirect URLs:
  - `https://husnalogy.com/auth/callback`
  - `https://husnalogy.com/auth/callback/finish`
  - `https://www.husnalogy.com/auth/callback` (only if www is served rather than redirected)
- Remove any `http://localhost...` entry from the production project, or keep
  it only in a separate development project.

**Google Cloud Console → OAuth client (Web application)**

- Authorized JavaScript origins: `https://husnalogy.com` (and
  `https://www.husnalogy.com` if served)
- Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
  Google redirects to Supabase, and Supabase then redirects to
  `/auth/callback` on the site.
- Put the Google client ID and secret in **Supabase → Authentication →
  Providers → Google**. They are never app environment variables.

Flows that use these URLs: Google sign-in, sign-up email confirmation
(`/auth/callback?next=/`), password reset
(`/auth/callback?next=/reset-password`). After any sign-in, email/password or
Google, admins go to `/admin/dashboard`, designers to `/designer` and customers
to the storefront. Server-side redirects in production always use
`NEXT_PUBLIC_SITE_URL` (or its www twin), never the internal `0.0.0.0:3000`
address the Node process sees behind Hostinger's proxy.

Recommended: redirect `www.husnalogy.com` → `husnalogy.com` at DNS/hPanel so
sessions live on one host.

---

### Canonical host (one production origin)

The site is served on exactly ONE host: the host of `NEXT_PUBLIC_SITE_URL`
(`https://husnalogy.com`). Its twin (`www.husnalogy.com`) answers with a
**permanent redirect** to the same path and query on the canonical host
(`canonicalHostRedirects` in `next.config.mjs`). This matters beyond SEO:
mutation requests are only accepted from the canonical origin
(`lib/security/same-origin.ts`), so a site reachable on both hosts would refuse
every form, save and checkout on the other one.

- In hPanel, attach BOTH `husnalogy.com` and `www.husnalogy.com` to the Node.js
  app (with TLS certificates for both), so the app can issue the redirect.
- If you prefer `www` as canonical, set `NEXT_PUBLIC_SITE_URL=https://www.husnalogy.com`,
  rebuild, and update every Supabase/Google redirect URL to the www origin;
  the apex then redirects to www.
- Verify after deploy: `curl -sI https://www.husnalogy.com/products?x=1` →
  `308` with `location: https://husnalogy.com/products?x=1`.

---

## 5. Render worker cron job

Every personalized order commits a durable **production task**, and every
order commits its **notification tasks** (customer confirmation + admin
alert), in the same transaction as the order. The worker turns production
tasks into print PNG/PDF render jobs, renders them, and sends the emails.
Nothing processes that work on its own, so schedule the worker as a Hostinger
cron job:

- **Endpoint:** `https://husnalogy.com/api/admin/customizer/render/process`
- **Method:** `GET` (or `POST`)
- **Auth header:** `Authorization: Bearer <CRON_SECRET>`. The
  `x-render-secret: <secret>` header is also accepted. The secret is never
  accepted in the URL.
- **Schedule:** every 5 minutes, `*/5 * * * *`

hPanel → Advanced → **Cron Jobs** → Custom command:

```sh
curl -fsS --max-time 290 -H "Authorization: Bearer YOUR_CRON_SECRET" "https://husnalogy.com/api/admin/customizer/render/process" > /dev/null
```

Replace `YOUR_CRON_SECRET` with the same value set in the app's environment.
The cron command lives only in hPanel, never in git.

**Each run** records a heartbeat, then runs seven subsystems in this order,
each ISOLATED from the others (`lib/worker/production-worker.ts`):

1. **lease recovery** — expired render leases, abandoned checkout preparations, clock-offset measurement;
2. **production tasks** — outbox → render jobs / manual hand-off *(critical)*;
3. **render jobs** — print PNG/PDF *(critical)*;
4. **notifications** — order emails *(critical)*;
5. **reconciliation** — repairs missing chain links (serialized in the database);
6. **output verification** — stored bytes still match their checksums;
7. **storage cleanup** — removes abandoned copies one object at a time.

A subsystem that throws is recorded as `failed` (logged, sent to Sentry, stored
in `worker_subsystem_runs`) and the next one still runs: a storage outage or a
poison cleanup object can never stop production or customer emails, and an
email outage never stops production. The pass has a 270 s budget with time
reserved for the later critical subsystems. Tasks are also attempted
immediately after checkout; the cron guarantees completion after a crash, a
failed render enqueue or a failed email.

**Storage cleanup lifecycle.** Every candidate is tracked in
`production_storage_cleanup_items` with its attempt count, last error and next
attempt (backoff 5 min → 24 h). After 8 failed attempts it is dead-lettered
(`manual_review_required`) and never retried automatically. Review with
`GET /api/admin/production/storage-cleanup` (admin) and retry or dismiss with
`POST {"id","action":"retry"|"dismiss","reason"}` — audited in
`production_recovery_audit`. Bytes of a checkout that definitively failed are
removed immediately by the request; a crashed checkout's bytes are removed
once its preparation lease (4 min) expires. Committed order bytes are never
candidates, and a storage trigger refuses their deletion anyway.

### First production run (approval-gated) — do this BEFORE enabling the cron

As of 2026-10-10 the worker has **never run** against production. Its first
run acts on a backlog, so it is done by hand, once, with the owner present:

1. **Inspect (read-only):** `npm run worker:queue-summary -- --env .env.local`.
   It prints counts only (no recipients or paths) and `wouldNow`: e-mails it
   would send, checkout leases it would expire, abandoned checkouts and files
   it would clean up, production and render work. On 2026-10-10 it showed:
   **4 e-mails** (2 customer confirmations + 2 admin alerts for the orders of
   5 and 8 October), 1 stale checkout lease to expire, 2 abandoned checkouts
   awaiting cleanup, no render or production work.
2. **Decide about the old e-mails.** If those orders were tests, sending the
   confirmations days later would reach whoever placed them. Safe default:
   make the first run with `RESEND_API_KEY` **unset** in hPanel — the worker
   then *defers* e-mails (no attempt is spent, nothing is lost) while lease
   expiry and cleanup proceed. Afterwards either set the key (they are sent
   once) or, with explicit approval, mark those specific tasks failed in the
   SQL editor with a reason (`update public.notification_tasks set
   status='failed', last_error='dismissed by owner before first run' where
   order_id in ('…')`) — a production data change.
3. **Run once by hand** (owner approval):
   `curl -fsS --max-time 290 -H "Authorization: Bearer $CRON_SECRET" https://husnalogy.com/api/admin/customizer/render/process`
   → expect `200` with `subsystems.*.status` `ok` (or `degraded` with a stated
   reason). A `401` means the secret differs from the app's `CRON_SECRET`.
4. **Check:** `GET /api/admin/production/health` (Bearer) → `200`; rerun the
   queue summary → `wouldNow` all 0 (or only the deliberately deferred
   e-mails); `npm run backup:reconcile -- --source-env .env.local` → still
   0 missing.
5. **Then** create the cron job below (every 5 minutes) and point an uptime
   monitor at the health URL.

**Disable / roll back:** delete or pause the hPanel cron job (work simply
waits in the queues; nothing is lost); in an emergency also rotate
`CRON_SECRET` so no caller can trigger runs. Rehearsed locally:
`lib/worker/__tests__/worker-first-run.test.ts` (this exact backlog shape:
one pass does it all once; repeated passes change nothing; a transient
database failure is recovered next pass) and
`lib/security/__tests__/worker-endpoint-overlap.test.ts` (overlapping calls → 409).

### Verify the cron actually runs (do not assume)

`GET https://husnalogy.com/api/admin/production/health` with the same
`Authorization: Bearer <CRON_SECRET>` header (or as a signed-in admin) returns:

- `200 {"status":"healthy"}` — the worker finished a run within 15 minutes, every subsystem ran and nothing is stuck;
- `200 {"status":"degraded","warnings":[…]}` — customer work is being done, but a
  **maintenance** subsystem (lease recovery, reconciliation, output verification,
  storage cleanup) failed, degraded or was skipped, cleanup objects are
  dead-lettered, or expired checkout preparation leases await the worker. Look
  at it soon; it does not page.
- `503 {"status":"unhealthy","problems":[…]}` — customer work is NOT being done:
  a **critical** subsystem (`production_tasks`, `render_jobs`, `notifications`)
  is `failed`, `degraded` or **`skipped`** (e.g. the pass ran out of time), or
  has never been recorded; the worker never ran or last finished > 15 minutes
  ago; a task waited > 30 minutes; permanently failed tasks/jobs; fulfilment
  chain gaps (missing snapshots/tasks/jobs/outputs, stuck jobs); outputs that
  failed verification; emails waiting > 1 hour; or a server/database clock
  offset above 2 s.

Each entry of `subsystemIssues` names the subsystem, its classification, status
and reason, the worker **run id**, when it happened, its last successful run,
and — for critical subsystems — the pending queue size and oldest pending task.
The policy lives in `lib/worker/health-policy.ts`.

`production_health()` (in the JSON) also exposes per-subsystem
`last_success_at` / `last_failure_at` / `last_duration_ms`, oldest pending
production and notification tasks, failed/retrying render jobs, cleanup
pending/failing/dead-lettered counts, unverified outputs and checkout
preparation counts.

Point an uptime monitor (e.g. UptimeRobot/Better Stack keyword or status
check, every 5–15 minutes, with the Bearer header) at this URL so the team is
alerted when production work stops. The JSON also contains pending/failed
counts and the oldest pending timestamps for render jobs, production tasks and
notifications, and the last worker run.

Behaviour:

| Response | Meaning |
|---|---|
| `200` | Pass completed. JSON: `status` (`ok` or `degraded`), `durationMs`, and `subsystems.<name>.{status,durationMs,error,result}`. `degraded` = a maintenance subsystem failed or some items failed and will be retried — look at `subsystems`. |
| `401` | Missing or wrong secret, or no secret configured on the server. |
| `409` | A previous run is still working in this server process. Harmless; the next tick continues. |
| `503` | A critical subsystem (production tasks, render or notifications) could not run at all (e.g. database unavailable). The other subsystems still ran. |
| `500` | Unexpected failure of the pass itself. Check the app logs. |

- Each run processes up to **20** render jobs (`?limit=` up to 50) within a
  270 s budget (the cron's curl gives up at 290 s), so a request is bounded.
- A job is claimed atomically under a database lease. Overlapping or repeated
  runs, even across processes, never render the same job twice. Abandoned
  leases are recovered automatically. Failed jobs retry with backoff, up to 3
  attempts.
- A `POST` from a signed-in admin session is also accepted, for manual runs.

---

### Clock synchronization (verify, do not assume)

Leases (checkout preparation, production/notification tasks, render jobs),
JWT validation (`PGRST303 JWT issued at future`), signed URLs, cron timing and
audit timestamps all assume the clocks agree. Measure on the machine that runs
`npm start` (Hostinger SSH), not on a laptop:

```sh
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/check-clock.mjs
```

It prints the offset against the database clock (ms precision), the Supabase
gateway `Date` header and Cloudflare, and exits 1 above 2 s. Once deployed,
`GET /api/admin/production/clock` (Bearer CRON_SECRET or admin session) reports
the same from inside the app, plus — for an admin session — the access token's
`iat`/`exp` against both clocks. Every worker pass records the offset in
`subsystems.lease_recovery.last_result.clock`, and the health check alerts
above 2 s. If the host is off: shared hosting clocks are managed by Hostinger —
open a support ticket with the measured offset; on a VPS enable NTP
(`timedatectl set-ntp true`, `chronyc tracking`). Keep the process in UTC
(`TZ` unset or `UTC`). A `supabase.jwt_issued_in_future` error event means
PGRST303 happened; it carries the measured skew (never the token).

---

## 6. Health check

`GET https://husnalogy.com/api/health` → `200 {"ok":true,"status":"healthy"}`.
It makes no database call and reveals no internals. Use it for uptime
monitoring.

---

## 7. Transactional email (Resend)

Every order commits two notification tasks: the customer's confirmation and
the admin's new-order alert. The worker sends them through Resend's HTTP API.

- Configure `RESEND_API_KEY`, `EMAIL_FROM` (on a domain verified in Resend),
  optionally `EMAIL_REPLY_TO` and `ORDER_NOTIFICATION_EMAIL`.
- Checkout success never depends on email: a provider outage leaves the order
  placed and the tasks pending; they are retried with backoff (up to 10
  attempts) and the provider receives the task id as `Idempotency-Key`, so a
  retry after a timeout does not send a duplicate. A replayed checkout creates
  no new tasks.
- Without `RESEND_API_KEY` the tasks wait without using up attempts and are
  sent once email is configured.
- Emails contain only the stored order: number, name, date, items and
  quantities, totals, delivery method/address, payment method and status,
  order status and support details. All customer text is HTML-escaped.
- The admin "Send test email" action still returns `501` (it predates this
  path); verify email with a real test order and the `notification_tasks`
  table (`status = 'sent'`).

Supabase's own auth emails (confirmation and password reset) are separate. For
production volume, configure custom SMTP in **Supabase → Authentication →
Emails**.

---

## 8. After each deployment, verify

1. `https://husnalogy.com/api/health` returns 200.
2. Homepage, `/products` and a product page load, and product images render.
3. Email/password login as a **customer** lands on the storefront; `/admin/dashboard` and `/designer` return 404.
4. Login as a **designer** lands on `/designer`; `/admin/dashboard` returns 404.
5. Login as an **admin** lands on `/admin/dashboard`.
6. Google sign-in completes and returns to `https://husnalogy.com`, not localhost.
7. Password reset email link opens `/reset-password` on the production domain.
8. Open a personalizable product, upload a photo, edit text, save, add to cart and place a test order. The terms checkbox starts unchecked; the order summary shows the server-quoted total.
9. The order appears in the admin dashboard with its design snapshot. In SQL: its `checkout_state` is `finalized`, `payment_status` `unpaid`, `status` `pending`, and the design's `product_customizations.status` is `ordered`.
9a. The ordered cart line is gone from the cart, and pressing Back/refresh on /checkout does not offer to place the order again.
9b. Server logs contain one `"event":"checkout.order_created"` line for the order and no `checkout.database_failed` lines.
9c. `select status from public.production_tasks where order_id = '<id>'` is `completed` after the next worker run; `select kind, status from public.notification_tasks where order_id = '<id>'` shows both `sent` (if email is configured); `select * from public.checkout_cart_claims where order_id = '<id>'` lists the consumed cart lines.
9d. `GET /api/admin/production/health` (Bearer CRON_SECRET) returns 200.
9e. A deliberately thrown test error (or the first real one) appears in Sentry.
10. Run the worker once by hand (curl command above). The response is 200 and the order's print PNG/PDF become available.
11. The same curl without the header returns 401.
12. Run the section 3 migration query. Every row is `true`.
13. `curl -sI https://www.husnalogy.com/` → permanent redirect to `https://husnalogy.com/`.
14. Signed in as admin, open `https://husnalogy.com/api/admin/production/client-ip`: `resolvedClientIp` is YOUR public IP (compare with any "what is my IP" page). If it shows a Hostinger/CDN address, `TRUSTED_PROXY_HOPS` is too low; if it shows `unknown` (the chain is shorter than the hop count — too high) or an address you typed into a forged `X-Forwarded-For`, it is wrong. Fix the variable and restart.
15. Shared-browser privacy check: customer A saves an address, phone and profile photo and signs out; customer B signs in on the same browser — B's account, checkout and orders show none of A's data, and a personalizable product opens without A's design. A signs back in and finds everything.
16. Upload a product video under 30 MB in the admin (or with the API) and confirm one over 30 MB is refused with a message that names the limit.

---

## 9. Known limitations (not blockers)

- **Rate limiting.**
  - *Scope.* Without `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
    the limiter is **in memory, per Node process**: each process counts on its
    own and a restart resets the counts. That is exact for ONE `npm start`
    process and is not a global/distributed limit. If Hostinger ever runs more
    than one process or instance, configure Upstash and set
    `REQUIRE_DISTRIBUTED_RATE_LIMIT=1`. Upstash has NOT been configured or
    tested against a live Redis in this repository's verification (the
    fail-open fallback and request shape are unit-tested only).
  - *Client address.* Anonymous limits key on the client IP derived from
    `X-Forwarded-For`, `TRUSTED_PROXY_HOPS` entries from the right; signed-in
    limits (checkout, uploads, saves, account) key on the account. The hop
    count depends on the hosting topology and is **not assumed verified**:
    check it with `GET /api/admin/production/client-ip` (admin session) after
    every deployment or proxy/CDN change — `resolvedClientIp` must equal your
    own public IP, and adding a fake `X-Forwarded-For: 1.2.3.4` header to the
    request must not change it.
- **Customer photos.** The stored original is re-encoded at full resolution
  (JPEG q95 / lossless PNG and WebP): EXIF/GPS metadata and any trailing
  (polyglot) bytes are removed. Editor and thumbnail derivatives are WebP.
  Only the owner, admins and explicitly assigned designers can read them.
- **Request body limits.** The app enforces per-route limits while streaming
  (checkout 64 KB, design saves 2 MB, product edits 5 MB, customer uploads
  15 MB, profile photos 8 MB). **Admin product media: 35 MB per request, 15 MB
  per image, 30 MB per video** — one set of numbers in
  `lib/uploads/admin-media.ts`, used by the route, its error messages, the
  product form and (for videos) the `product-videos` bucket. Uploads are
  buffered in the Node process, so the limit is kept small; larger videos would
  need a direct-to-Storage upload flow, which is not built. Hostinger's front
  proxy has its own upload cap; confirm it is at least 35 MB.
- **Content Security Policy (residual hardening item).** `script-src` still
  allows `'unsafe-inline'`: Next.js injects inline runtime scripts, and a strict
  policy needs per-request nonces, which force dynamic rendering of every page
  and the proxy on every HTML request (SRI hashes only cover external chunks).
  Not done in this release. All other protections are in place and pinned by
  `lib/security/__tests__/security-headers.test.ts`: `default-src 'self'`,
  scripts only from this origin, `object-src 'none'`, `frame-src 'none'`,
  `frame-ancestors 'none'`, `base-uri`/`form-action 'self'`,
  `upgrade-insecure-requests` (production), HSTS (2 years, subdomains),
  `nosniff`, `X-Frame-Options: DENY`, strict Referrer-Policy,
  Permissions-Policy and COOP.
- **Sign-in rate limiting** is performed by Supabase Auth (the browser talks to
  it directly). Review Authentication → Rate Limits in the Supabase dashboard.

---

## 10. Backups and disaster recovery

The admin dashboard's **"Export Catalogue Backup"** downloads settings and
products as JSON. It is a convenience copy, **not** a disaster-recovery backup:
it contains no orders, customers, designs, uploaded files, production files or
Storage objects. Disaster recovery is planned here:

| What | Where it lives | Backup |
|---|---|---|
| Database (orders, customers, profiles, addresses, designs, snapshots, settings) | Supabase Postgres | Supabase **daily backups** (Pro plan and above) and, recommended for a store, **Point-in-Time Recovery** (PITR). Confirm in Supabase → Database → Backups that backups exist and note the retention. Free-plan projects have no automatic backups: then schedule `pg_dump` (e.g. `supabase db dump`) to off-site storage. |
| Storage objects (customer uploads, avatars, production files, renders, asset library, product media) | Supabase Storage buckets | **Not covered by database backups.** Schedule a periodic copy of every bucket (`supabase storage` CLI, the S3-compatible API, or rclone) to separate storage. Private buckets: `customer-uploads`, `customer-avatars`, `customizer-renders`, `customizer-elements`, `order-production`, `admin-assets`; public: `product-images`, `product-mockups`, `product-videos`, `site-assets`. |
| Configuration | hPanel environment variables, Supabase Auth settings, Google OAuth client, Resend domain | Keep a private, access-controlled record (password manager / vault). Never in git. |
| Application | git repository | Tags per release; the build is reproducible from `package-lock.json`. |

A real restore must be **coordinated**: the database and Storage must come from
the same point in time (orders reference stored files), and the application
build must match the restored migrations (section 3).

Tooling (2026-10-09): `npm run backup:run` (encrypted database + Storage
backup with verification), `backup:check` (monitoring), `backup:reconcile`
(database ↔ Storage), `restore:db`, `restore:storage`, `restore:rewrite-urls`
(all restores refuse production). Strategy, costs and the decisions still
needed: [PRODUCTION_BACKUP_STRATEGY.md](PRODUCTION_BACKUP_STRATEGY.md).
Runbook: [HUSNALOGY_DISASTER_RECOVERY.md](HUSNALOGY_DISASTER_RECOVERY.md).
The procedure is drill-tested locally with synthetic data
([BACKUP_RESTORE_TEST_RESULTS.md](BACKUP_RESTORE_TEST_RESULTS.md)); a
production backup and a hosted restore are still **unverified**.
