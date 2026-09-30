# Husnalogy — Hostinger production deployment

Husnalogy is a normal Node.js Next.js **server** application (server routes,
Supabase SSR auth, admin/designer workspaces, checkout, the render worker).
It must run with `next start`. Do **not** use static export.

No secrets belong in this file, in git, or in any `NEXT_PUBLIC_` variable.

---

## 1. Runtime

| Setting | Value |
|---|---|
| Node.js version | **22.x (LTS)**. Pinned in `package.json` `engines` and `.nvmrc`. |
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
| `TRUSTED_PROXY_HOPS` | optional | server | Number of reverse proxies in front of Node that append to `X-Forwarded-For` (default **1** = Hostinger's proxy). Rate limits use the address that many entries from the RIGHT; the client-supplied leftmost entry is never trusted. Set to 2 if a CDN is added in front. |
| `OPENAI_API_KEY` | optional | **secret** | Ask Logy. Falls back to local answers when absent. |
| `OPENAI_MODEL`, `LOGY_USE_OPENAI` | optional | server | Ask Logy tuning. |
| `ICONIFY_API_BASE_URL` | optional | server | Defaults to the public Iconify API. No key. |
| `DELETE_ADMIN_EMAIL`, `DELETE_ADMIN_PASSWORD` | optional | **secret** | Enables permanent product deletion only. Leave unset to keep it disabled. |
| `ENABLE_CUSTOMIZER_E2E_FIXTURE` | **must be unset** | server | Test fixture pages. Never set on the live site. |

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

Run this query in the SQL editor. **Every row must be `true`:**

```sql
select * from (values
  ('customizer_v2',                 to_regclass('public.customizer_render_jobs') is not null),
  ('customizer_v2_completion',      exists (select 1 from information_schema.columns where table_schema='public' and table_name='customizer_render_jobs' and column_name='render_engine_version')),
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
                                    and not has_table_privilege('authenticated', 'public.production_tasks', 'insert'))
) as checks(migration, applied);
```

Also check:

- **RLS is enabled on every public table.** This query must return no rows:
  `select tablename from pg_tables where schemaname='public' and not rowsecurity;`
- **Storage buckets.** `customer-uploads`, `customizer-renders`,
  `customizer-elements` and `admin-assets` are **private**. `product-images`, `product-mockups`,
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

### If a migration fails or must be backed out

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

**Each run:** records a heartbeat → recovers any finalized snapshot that never
got production work (older than 10 minutes) → drains due production tasks and
notification tasks (with leases, retry and exponential backoff) → processes
render jobs. Tasks are also attempted immediately after checkout; the cron is
what guarantees completion after a crash, a failed render enqueue or a failed
email.

### Verify the cron actually runs (do not assume)

`GET https://husnalogy.com/api/admin/production/health` with the same
`Authorization: Bearer <CRON_SECRET>` header (or as a signed-in admin) returns:

- `200 {"ok":true}` — the worker finished a run within 15 minutes and nothing is stuck;
- `503 {"ok":false,"problems":[…]}` — e.g. "The production worker has never
  completed a run (is the Hostinger cron configured?)", a task waiting more
  than 30 minutes, permanently failed tasks/jobs, unscheduled ordered designs,
  or emails waiting more than an hour.

Point an uptime monitor (e.g. UptimeRobot/Better Stack keyword or status
check, every 5–15 minutes, with the Bearer header) at this URL so the team is
alerted when production work stops. The JSON also contains pending/failed
counts and the oldest pending timestamps for render jobs, production tasks and
notifications, and the last worker run.

Behaviour:

| Response | Meaning |
|---|---|
| `200` | Run finished. JSON has `processed`, `failures`, `recovered`, `remaining`, `stoppedReason`. |
| `401` | Missing or wrong secret, or no secret configured on the server. |
| `409` | A previous run is still working in this server process. Harmless; the next tick continues. |
| `500` | The run itself failed. Check the app logs. |

- Each run processes up to **20** jobs (`?limit=` up to 50) and stops claiming
  new jobs after **4 minutes**, so a request is always bounded.
- A job is claimed atomically under a database lease. Overlapping or repeated
  runs, even across processes, never render the same job twice. Abandoned
  leases are recovered automatically. Failed jobs retry with backoff, up to 3
  attempts.
- A `POST` from a signed-in admin session is also accepted, for manual runs.

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

---

## 9. Known limitations (not blockers)

- **Rate limiting.** Without Upstash, limits are per process (fine for one
  `npm start` process). Client IPs come from `x-forwarded-for`, read
  `TRUSTED_PROXY_HOPS` entries from the right. Checkout, uploads and
  customization saves are additionally limited per account.
- **Customer photos.** The stored original is re-encoded at full resolution
  (JPEG q95 / lossless PNG and WebP): EXIF/GPS metadata and any trailing
  (polyglot) bytes are removed. Editor and thumbnail derivatives are WebP.
  Only the owner, admins and explicitly assigned designers can read them.
- **Request body limits.** The app enforces per-route limits while streaming
  (checkout 64 KB, design saves 2 MB, product edits 5 MB, customer uploads
  15 MB, admin media 150 MB per request). Hostinger's front proxy has its own
  upload cap; if admins must upload 120 MB videos, confirm the plan's limit
  allows it.
- **Sign-in rate limiting** is performed by Supabase Auth (the browser talks to
  it directly). Review Authentication → Rate Limits in the Supabase dashboard.
