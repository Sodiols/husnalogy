# Husnalogy production launch checklist

Deployment steps, environment variables, migrations, cron and staging:
[`HOSTINGER_DEPLOYMENT.md`](../HOSTINGER_DEPLOYMENT.md) and
[`docs/E2E_STAGING.md`](E2E_STAGING.md).

Statuses describe what is TRUE TODAY, re-checked against the code on
2026-10-07 (production stabilization pass):

| Status | Meaning |
|---|---|
| **IMPLEMENTED** | In the code and covered by automated tests run locally (unit, PGlite, or real PostgreSQL 17). |
| **PRODUCTION CONFIGURATION REQUIRED** | Implemented; works only once the listed production setting/secret is configured. |
| **VERIFIED IN STAGING** | Exercised against a real staging Supabase project and staging deployment. |
| **VERIFIED IN PRODUCTION** | Confirmed on the live site. |
| **NOT IMPLEMENTED** | Genuinely missing. |
| **BLOCKED** | Cannot be completed until the stated external access exists. |
| **NOT FULLY VERIFIED** | Implemented, but a required verification layer has not run yet. |

Nothing is marked VERIFIED IN STAGING or VERIFIED IN PRODUCTION yet: no
dedicated staging project exists (see §8).

---

## 1. Infrastructure

| Check | Status | Notes |
|---|---|---|
| Node.js 22 runtime | IMPLEMENTED · PRODUCTION CONFIGURATION REQUIRED | `package.json` `engines: 22.x`, `.nvmrc` = 22. Full validation ran on Node v22.23.3 (see §8). Select **Node.js 22.x** in hPanel. |
| Production Supabase project | PRODUCTION CONFIGURATION REQUIRED | Must be separate from staging. |
| Dedicated staging Supabase project | BLOCKED | Needs a disposable project in `.env.staging` (template: `.env.staging.example`). Tooling is implemented: `npm run staging:migrate`, `staging:seed`, `test:staging`, `test:e2e:staging`. |
| Migrations applied in order | IMPLEMENTED · PRODUCTION CONFIGURATION REQUIRED | Order: `schema.sql` → `hero_collections.sql` → timestamped files. All apply cleanly on real PostgreSQL 17 (`staging-tooling.test.ts`); not yet on Supabase. Never edit an applied migration. |
| RLS on every public table | IMPLEMENTED · NOT FULLY VERIFIED | Asserted on real PostgreSQL 17; staging Supabase check pending. |
| `site_settings` readable by admins only | IMPLEMENTED | `20260917120000_restrict_site_settings_read.sql`. |
| Storage buckets + policies | IMPLEMENTED · NOT FULLY VERIFIED | Private: `customer-uploads`, `customer-avatars`, `customizer-renders`, `customizer-elements`, `order-production`, `admin-assets`. Supabase Storage behaviour (policies, signed URLs) is covered by `test:staging`, which has not run. |
| Canonical host (www → apex) | IMPLEMENTED · PRODUCTION CONFIGURATION REQUIRED | Permanent redirect from the twin of `NEXT_PUBLIC_SITE_URL` (`canonicalHostRedirects`, tested with Next's config evaluator). Attach both hostnames + TLS in hPanel. HOSTINGER_DEPLOYMENT.md §4. |
| Sharp ≥ 0.35.5 (GHSA-wq5f-xc86-pv6w) | IMPLEMENTED | Installed 0.35.5; lockfile and runtime version enforced by `sharp-upload-pipeline.test.ts`. Confirm the Hostinger build installs the linux-x64 0.35.5 binary (`npm ls sharp` on the host). |
| Service-role key and worker secrets absent from client bundles | IMPLEMENTED | Build output scanned (no secret value in `.next/static`; no source maps shipped). |
| Domain + SSL | PRODUCTION CONFIGURATION REQUIRED | |
| Server clock synchronized | PRODUCTION CONFIGURATION REQUIRED | `npm run check:clock` on the Hostinger host must show < 2 s. A local dev machine was measured +14 s fast. |
| Environment variables complete | IMPLEMENTED · PRODUCTION CONFIGURATION REQUIRED | `.env.example`; startup refuses missing required values. List in HOSTINGER_DEPLOYMENT.md §2. |

## 2. Roles and authorization — **BLOCKER**

| Check | Status | Notes |
|---|---|---|
| Roles `customer`, `designer`, `admin` | IMPLEMENTED | `profiles.role` constraint; role changes blocked through the public API. |
| Capability layer, not raw role checks | IMPLEMENTED | `lib/auth/roles.ts`; enforced by test. |
| Every `/api/admin` route guarded | IMPLEMENTED | Structural test fails on an unguarded route. Admin mutations use `withAdminMutation` (same origin, role, bounded body). |
| Designer workspace UI | IMPLEMENTED · NOT FULLY VERIFIED | `/designer` (`app/designer`). Unit-tested; no browser test yet. |
| Admin review screen (approve / request revision) | IMPLEMENTED · NOT FULLY VERIFIED | `/admin/review`. Unit-tested workflow; no browser test yet. |
| Designer-accessible authoring APIs | IMPLEMENTED | Nine admin API routes accept the `studio` capability for designers; ownership re-read server side. |
| Designer cannot publish or see orders, customers, revenue, settings | IMPLEMENTED | `designer-authorization.test.ts`. |

## 2a. Customer account privacy (shared browser) — **BLOCKER**

| Check | Status | Notes |
|---|---|---|
| Customizer local recovery scoped to the account (or guest session) | IMPLEMENTED | Owner in the key AND stamped in the snapshot; legacy unscoped copies purged; signed URLs never stored. `recovery-isolation.test.ts`, `e2e/customer-recovery-isolation.spec.ts` (full reload + in-page switch + guest handoff). |
| Saves refused when the session changed under an open editor | IMPLEMENTED | `expectedUserId` precondition → 409 `account-changed` (`customization-account-precondition.test.ts`). |
| Saved addresses on the account (RLS owner-only) | IMPLEMENTED · NOT FULLY VERIFIED | `customer_addresses` + `/api/account/addresses`. PGlite RLS + route tests; stub browser test. Staging spec `e2e/staging-shared-browser-privacy.spec.ts` pending staging. |
| Profile name/phone/photo on the account | IMPLEMENTED · NOT FULLY VERIFIED | `/api/account/profile`, `/api/account/avatar` (private bucket, re-encoded WebP). Same verification layers as addresses. |
| No account data in global browser keys | IMPLEMENTED | Legacy `husnalogy_saved_addresses`, `husnalogy_profile`, `husnalogy_orders` are deleted, never shown. |
| Design Studio recovery scoped to the studio account | IMPLEMENTED | `studio-recovery.test.ts`, `e2e/admin-studio-recovery.spec.ts`. |

## 3. Published design isolation — **BLOCKER**

| Check | Status | Notes |
|---|---|---|
| Customers receive only immutable published versions | IMPLEMENTED | Working drafts are stripped from the client payload. |
| Publishing creates an immutable version | IMPLEMENTED | Database trigger. |
| Publishing refuses print sizes production cannot render | IMPLEMENTED | Automatic rendering: ≤ 36 MP per page incl. bleed, ≤ 8,000 px per side, ≤ 150 MP per design, ≤ 32 pages, 72–600 dpi (e.g. 24×36 in at 200 dpi). 24×36 in at 300 dpi is NOT supported. |
| A saved design opens ONLY on its exact template version | IMPLEMENTED | Unavailable version → blocked with a safe message, never the latest/draft, never autosaved. `template-version-pinning*.test.ts` (incl. real schema + publish RPC), `e2e/customizer-version-pinning.spec.ts`. |
| Unreviewed drafts not readable with the public key | IMPLEMENTED | Migration `20261007150000`; `rls-authorization-matrix.test.ts`. |
| Every active personalizable product has a published version | PRODUCTION CONFIGURATION REQUIRED | `select p.slug from products p left join customizer_template_versions v on v.product_id = p.id where p.status = 'active' group by p.slug having count(v.id) = 0;` |

## 4. Orders and fulfilment

| Check | Status | Notes |
|---|---|---|
| Server-trusted prices, surcharges, delivery, currency | IMPLEMENTED | `lib/orders/pricing-resolver.ts`; client prices are never trusted. |
| Atomic order transaction, cart claims, idempotency, cross-tab single order | IMPLEMENTED · NOT FULLY VERIFIED | Real PostgreSQL concurrency tests pass; Supabase/PostgREST concurrency and real multi-tab browser test pending staging. |
| Checkout preparation leases + aggregate asset limits | IMPLEMENTED | `docs/CHECKOUT_ARCHITECTURE.md`. |
| Immutable design snapshots + snapshot-based rendering | IMPLEMENTED | Re-rendering ignores live customization, template, product and temporary uploads. |
| Production worker cron | PRODUCTION CONFIGURATION REQUIRED | Hostinger cron every 5 min, `Authorization: Bearer $CRON_SECRET`. HOSTINGER_DEPLOYMENT.md §5. |
| Worker fault isolation + health | IMPLEMENTED | Critical subsystem failed/degraded/skipped → health 503; maintenance → 200 "degraded". |
| Transactional order emails (customer + admin) | IMPLEMENTED · PRODUCTION CONFIGURATION REQUIRED | Durable notification outbox via Resend. Requires `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain. Without them, emails wait (never lost). |
| Admin notification recipient configurable | IMPLEMENTED · PRODUCTION CONFIGURATION REQUIRED | `ORDER_NOTIFICATION_EMAIL`, else the store email in Admin → Settings. |

## 5. Operations

| Check | Status | Notes |
|---|---|---|
| Distributed rate limiting | PRODUCTION CONFIGURATION REQUIRED (only with > 1 process) · NOT VERIFIED EXTERNALLY | Without Upstash the limiter is in memory, per Node process (not global). Upstash has not been exercised against a live Redis. |
| `TRUSTED_PROXY_HOPS` matches the real proxy topology | PRODUCTION CONFIGURATION REQUIRED · NOT VERIFIED EXTERNALLY | Default 1 is an assumption. Verify with `GET /api/admin/production/client-ip` after deploy (HOSTINGER_DEPLOYMENT.md §9). |
| Admin media upload limits consistent | IMPLEMENTED | 35 MB/request, 15 MB/image, 30 MB/video everywhere (route, messages, form, bucket); content-verified media. |
| Strict CSP (no `'unsafe-inline'` scripts) | NOT IMPLEMENTED (residual hardening item) | Needs nonces + dynamic rendering. All other headers pinned by `security-headers.test.ts`. |
| Error monitoring | IMPLEMENTED · PRODUCTION CONFIGURATION REQUIRED | Sentry-protocol reporting without extra dependencies; set `SENTRY_DSN`. Without it errors are only in the app log. |
| Uptime / production health monitoring | IMPLEMENTED · PRODUCTION CONFIGURATION REQUIRED | `/api/health` (public liveness) and `/api/admin/production/health` (Bearer `CRON_SECRET`) — point an uptime monitor at both. |
| Analytics | NOT IMPLEMENTED | No analytics integration. |
| Database backups / PITR | PRODUCTION CONFIGURATION REQUIRED · NOT VERIFIED | Supabase daily backups / PITR, plus a separate Storage backup (not covered by DB backups). HOSTINGER_DEPLOYMENT.md §10. A test restore has not been performed. |
| "Export Catalogue Backup" (admin, formerly "Export Full Backup") | IMPLEMENTED | Settings + products only; labelled as such, with an in-app note that it is not disaster recovery. |
| Actionable server logs | IMPLEMENTED | Structured JSON lines; secrets redacted. |

## 6. Public site

| Check | Status | Notes |
|---|---|---|
| Only published, publicly listed products appear | IMPLEMENTED | `isPubliclyListed`. |
| Sitemap contains only public content | IMPLEMENTED | Built from `getActiveProducts` (publicly listed only). |
| Personalize and E2E fixture pages are `noindex` | IMPLEMENTED | Fixture pages also return 404 in production unless `ENABLE_CUSTOMIZER_E2E_FIXTURE=1` (staging only). |
| Product option choices persist (incl. Paper Style) | IMPLEMENTED | Canonical option state + flush-on-leave autosave; browser-tested on the fixture page. |
| Image optimizer restricted | IMPLEMENTED | Only this project's public catalogue buckets; no query strings, redirects or SVG. |

## 7. Final manual sign-off (production)

- [ ] Real desktop order completed end to end
- [ ] Real mobile order completed end to end
- [ ] Print render inspected at full resolution
- [ ] Admin can publish a design version and a product
- [ ] Customer who started before a re-publish still sees their original design
- [ ] Order confirmation email reaches the customer, new-order alert reaches staff
- [ ] `GET /api/admin/production/health` → 200 `healthy` after the first cron runs
- [ ] `npm run check:clock` on the host shows < 2 s offset

## 8. Verification status

| Layer | Status | How |
|---|---|---|
| Unit + PGlite integration (`npm test`) | IMPLEMENTED (passes on Node 22) | Includes worker isolation, checkout preparation, render limits, option persistence. |
| Real PostgreSQL 17 concurrency + migration tooling | IMPLEMENTED (passes locally) | `postgres-concurrency.test.ts`, `staging-tooling.test.ts`. |
| Real Supabase staging integration (`npm run test:staging`) | BLOCKED · NOT FULLY VERIFIED | PostgREST, Auth, Storage, RLS, RPC, concurrency, rollback, worker leases. Needs `.env.staging`. |
| Playwright — public, security and fixture specs | IMPLEMENTED (pass locally) | No seeded data needed. Signed-in specs run against an isolated stub (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399`, `NEXT_DIST_DIR=.next/e2e-stub`) and can never reach a real project. |
| Playwright — complete seeded suite incl. real multi-tab checkout (`npm run test:e2e:staging`) | BLOCKED · NOT FULLY VERIFIED | Needs the staging project, seeded with `npm run staging:seed`. |
| Controlled staging order (docs/E2E_STAGING.md §5) | BLOCKED | Needs staging. |

## Validation commands (Node 22)

```bash
node --version
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e:public
npm audit
npm run staging:migrate
npm run staging:seed
npm run test:staging
npm run test:e2e:staging
```
