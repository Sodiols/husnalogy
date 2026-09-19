# Husnalogy production launch checklist

Deployment steps, environment variables, migrations and cron: see
[`HOSTINGER_DEPLOYMENT.md`](../HOSTINGER_DEPLOYMENT.md).

Work top to bottom. Anything marked **BLOCKER** must be green before the site
takes a real customer order.

The status column records what is **verified in the repository today**, not what
is planned. Items marked _Not implemented_ are genuine gaps, listed so nobody
assumes otherwise.

---

## 1. Infrastructure

| Check | Status | Notes |
|---|---|---|
| Production Supabase project created | Manual | Separate from staging. |
| Migrations applied in order | Manual | `supabase/migrations/`, oldest first. Never edit an applied migration. |
| RLS enabled on every table | ✅ Verified | Enabled across `schema.sql` and `customizer_v2.sql`. |
| `site_settings` read restricted to admins | ✅ Verified | `20260917120000_restrict_site_settings_read.sql`. The row holds SMTP and payment secrets. |
| Storage buckets + policies applied | Manual | Customer uploads stay isolated per owner. |
| Service-role key absent from client bundles | ✅ Verified | Grep of `.next/static/chunks` finds none. |
| Domain + SSL configured | Manual | |
| `.env` complete | ✅ Documented | See `.env.example`; every required variable is described there. |

## 2. Roles and authorization — **BLOCKER**

| Check | Status | Notes |
|---|---|---|
| Three roles exist (`customer`, `designer`, `admin`) | ✅ | `profiles.role` check constraint. |
| Capability layer, not raw role checks | ✅ Verified | `lib/auth/roles.ts` is the only place a role becomes a permission. Enforced by test. |
| Every `/api/admin` route guarded | ✅ Verified | Structural test fails if an unguarded route is added. |
| Designer cannot publish, see orders, customers, revenue, settings, users, backups, permanent delete | ✅ Verified | 30 unit tests in `designer-authorization.test.ts`. |
| Designer cannot edit another designer's unassigned product | ✅ Verified | Ownership re-read server side in `requireProductEditor`. |
| Product ownership columns + workflow state | ✅ Migration | `20260918120000_designer_role_and_product_workflow.sql`. **Apply before creating designer accounts.** |
| Designer workspace UI | ❌ Not implemented | A designer has capabilities but no dedicated dashboard yet. |
| Admin review screen (approve / request revision) | ❌ Not implemented | Workflow states exist; the UI to drive them does not. |
| Designer-accessible product/design API routes wired | ❌ Not implemented | Authoring routes still require admin. |

> **A designer account cannot complete the authoring workflow yet.** The
> security boundary is in place and proven; the workspace that uses it is not
> built. Do not create designer accounts on production until it is.

## 3. Published design isolation — **BLOCKER**

| Check | Status | Notes |
|---|---|---|
| Customers receive only immutable published versions | ✅ Verified | `/personalize` resolves `getPublicCustomizerTemplate`; the working draft is stripped from the client payload. |
| Draft edits never reach the public | ✅ Verified | 13 unit tests + production HTML check (`customizerTemplate` appears 0 times). |
| In-progress customizations stay pinned to their version | ✅ Verified | Pin is read server side and ownership-checked. |
| Orders keep their exact design version | ✅ | `getTrustedTemplateForCustomization` resolves the snapshot for validation and render. |
| Publishing creates an immutable version | ✅ | DB trigger rejects UPDATE/DELETE on `customizer_template_versions`. |
| Product detail gates on a PUBLISHED version | ✅ Verified | `hasPublishedCustomizer`, not the draft's `enabled` flag. |

**Before launch, confirm every publicly active product has at least one
published customizer version** — otherwise its Personalize button disappears.
Query: `select p.slug from products p left join customizer_template_versions v
on v.product_id = p.id where p.status = 'active' group by p.slug having
count(v.id) = 0;`

## 4. Orders and fulfilment

| Check | Status | Notes |
|---|---|---|
| Server recalculates prices | ✅ | Browser-submitted prices are never trusted. |
| Order idempotency | ✅ | `20260824090000_checkout_idempotency.sql`. |
| Design snapshots stored per order | ✅ | `order_design_snapshots`. |
| Render worker scheduled | Manual | Hostinger cron every 5 minutes calling `/api/admin/customizer/render/process` with `Authorization: Bearer $CRON_SECRET`. See `HOSTINGER_DEPLOYMENT.md` §5. |
| Transactional order emails | ❌ Not implemented | Neither customer confirmation nor admin notification is sent. |
| Admin notification recipients configurable | ❌ Not implemented | |

> **No order email is sent today.** Staff must watch the admin orders screen.

## 5. Operations

| Check | Status | Notes |
|---|---|---|
| Distributed rate limiting | ⚠️ Configure | Code supports Upstash; set `UPSTASH_REDIS_REST_URL` + `_TOKEN` in production or limits are per-instance only. |
| Error monitoring | ❌ Not implemented | No Sentry/equivalent. Failures surface only in platform logs. |
| Analytics | ❌ Not implemented | |
| Health endpoint | ✅ | `/api/health`, deliberately minimal. |
| Server failures produce actionable logs | ✅ | `lib/core/server-errors.ts` — never logs an opaque `{}`. |
| Database backups / PITR | Manual | Configure in Supabase. The in-app export is **not** a database backup. |
| "Export Full Backup" naming accurate | ⚠️ Review | Verify it exports what its label claims. |

## 6. Public site

| Check | Status | Notes |
|---|---|---|
| Only published products are publicly listed | ✅ | `status = 'active'` + visibility filter. |
| Personalize pages are `noindex` | ✅ | `robots: { index: false }`. |
| Sitemap contains only public content | ⚠️ Verify | |
| Storefront does not load the customizer bundle | ✅ Verified | Konva is a 327 KB lazy chunk, absent from `/`, `/products`, `/cart`, `/checkout`. |
| Product detail is a single query | ✅ Verified | `getProductBySlug` no longer loads the whole catalogue. |

## 7. Final manual sign-off

- [ ] Real desktop order completed end to end
- [ ] Real mobile order completed end to end
- [ ] Print render inspected at full resolution
- [ ] Admin can publish a design version and a product
- [ ] Customer who started before a re-publish still sees their original design
- [ ] Order confirmation reaches the customer (**blocked until email ships**)

---

## Validation commands

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
npx playwright test --project=chromium
```
