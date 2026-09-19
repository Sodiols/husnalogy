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
| Build command | `npm run build` |
| Start command | `npm start` (runs `next start`; it honours Hostinger's `PORT`) |
| Application root | the repository root (the folder containing `package.json`) |

`npm run build` needs the `NEXT_PUBLIC_*` variables **at build time**, because
they are inlined into the bundle. `NEXT_PUBLIC_SUPABASE_URL` also decides which
Supabase host may serve images. A production build stops with a clear error
when it is missing, or when `NEXT_PUBLIC_SITE_URL` is not an `https://` public
origin. **Changing a `NEXT_PUBLIC_` value in hPanel needs a rebuild to take
effect.**

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
  ('no direct order inserts',       not exists (select 1 from pg_policies where schemaname='public' and tablename='orders' and policyname='orders_customer_insert_own'))
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
- **Every active product has a published customizer version**, if it offers
  personalization. See `docs/LAUNCH_CHECKLIST.md` §3.
- Create the first admin with the SQL editor, which runs as a database owner:
  `update public.profiles set role = 'admin' where email = '<owner email>';`
  The role trigger allows this there and refuses it through the public API.

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

Paid orders queue print PNG/PDF render jobs. Nothing processes that queue on
its own, so schedule the worker as a Hostinger cron job:

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

## 7. Transactional email: not configured

No email provider is connected. Order confirmation and admin notification
emails are **not sent**.

- Checkout and order creation do not depend on email. Orders are written to the
  database and appear in the admin dashboard.
- The admin "Send test email" action returns `501 Not Implemented` and says no
  email was sent. It never reports a fake success.
- Staff must watch **Admin → Orders** for new orders.

To add email later, connect a provider such as Resend, Postmark or SMTP in
server code and add its credentials as **secret** variables (e.g.
`RESEND_API_KEY` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`).
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
8. Open a personalizable product, upload a photo, edit text, save, add to cart and place a test order.
9. The order appears in the admin dashboard with its design snapshot.
10. Run the worker once by hand (curl command above). The response is 200 and the order's print PNG/PDF become available.
11. The same curl without the header returns 401.
12. Run the section 3 migration query. Every row is `true`.

---

## 9. Known limitations (not blockers)

- **Rate limiting.** Without Upstash, limits are per process. Client IPs come
  from `x-forwarded-for` as delivered by Hostinger's proxy.
- **Original customer photos** are stored unmodified in the private
  `customer-uploads` bucket for print fidelity. The editor and thumbnail
  derivatives are EXIF-stripped. Only the owner and admins can read originals.
