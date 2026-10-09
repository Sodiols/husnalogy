# API and authentication implementation inventory

Read-only audit completed 2026-10-08, before this upgrade's application edits. Source: every `app/**/route.ts`, `proxy.js`, `lib/security`, `app/lib/auth.ts`, `app/lib/customer-lists.ts`. There are **78 `/api` route files and one `/auth/callback` route**. No Next Server Action (`use server`) entrypoints were found. The installed Next 16.3.8 route-handler and proxy guides were read before implementation.

This is the **before-change inventory**; the deployment report records implemented changes and verified results. All limits below are existing limits. M = process-local memory; D = Upstash shared limiter when both server credentials exist, otherwise memory fallback. `/10m` means ten minutes. An account key is the authenticated Supabase ID, never an ID accepted from request JSON. Expected volume is a behavioral classification, not measured production traffic.

## Customer and public APIs

| Endpoint | Methods | Access and purpose | Risk / expected volume | Existing controls | Proposed work |
|---|---|---|---|---|---|
| `/api/account/addresses` | GET, POST | Authenticated; own addresses | Account mutation / low | Session + owner filter; POST M 60/10m/account, origin/body validation | Shared account limiter |
| `/api/account/addresses/[id]` | PATCH, DELETE | Authenticated; own address | Account mutation / low | Session + owner filter; M 60/10m/account, origin/body validation | Shared account limiter |
| `/api/account/avatar` | POST, DELETE | Authenticated; own avatar | Image upload / low, costly | D 20/10m/account; bounded/re-encoded image, ownership | Preserve |
| `/api/account/profile` | GET, PATCH | Authenticated; own profile | Account mutation / low | PATCH M 30/10m/account; field validation and session | Shared account limiter |
| `/api/ask-logy` | POST | Public assistant | Public form / moderate, external cost | D 30/min/IP, body bounds, validation, server provider key | Preserve; independent edge budget if plan permits |
| `/api/checkout/quote` | POST | Authenticated; trusted current pricing | Checkout read / moderate | D 120/10m/IP; origin, schema, server product prices | Key by authenticated account; protect shared networks |
| `/api/contact` | POST | Public enquiry, own server persistence/provider path | Contact submission / low, spam | D 6/10m/IP; origin/body/input validation | Trusted Turnstile verification, explicit success/retry behavior |
| `/api/customizations` | GET, POST | Authenticated; own designs | Autosave/create / high while editing | POST M 600/5m/account; private responses, session, explicit ownership, published version validation, body bounds | Shared account limiter; retain generous autosave cadence |
| `/api/customizations/[id]` | GET, PATCH, DELETE | Authenticated; own design | Autosave / high; delete / low | PATCH M 600/5m/account; session, owner filter, ordered-design locks, revisions, origin/body checks; GET/DELETE no explicit limiter | Shared account limiter; bounded reads/deletes |
| `/api/customizer/assets/[id]` | GET | Customer-available library asset; original needs studio role | Asset signing/display / high bursts | M 240/10m/IP; UUID/variant validation, customer visibility, private no-store redirect | Shared limiter; preserve asset access rules |
| `/api/customizer/assets/resolve` | POST | Authenticated; authorized private references | Asset signing / moderate-high bursts | M 80/10m/IP; up to 50 references; reference ownership; body/origin checks | Shared account limiter |
| `/api/customizer/assets/sign` | POST | Public customer derivatives or studio originals | Asset signing / high bursts | M 600/10m/IP; max 100 assets, published/customer availability checks; original restriction; no-store | Shared limiter, account key for signed-in users |
| `/api/customizer/elements` | GET | Public customer-available library | Public read/search + signing / moderate | M 120/10m/IP; active/ready/customer filters, pagination bounds | Shared limiter; no browser challenge |
| `/api/customizer/fonts` | GET | Public sanitized font catalogue | Public read / low-moderate | M 120/10m/IP; server-only API key, bounded query, cached upstream catalogue | Preserve moderate public read policy |
| `/api/customizer/fonts/favourites` | GET | Public list plus viewer capability | Public read / low-moderate | M 120/10m/IP, private no-store | Preserve |
| `/api/customizer/iconify/import` | POST | Authenticated; licensed graphic import | Image processing/storage / low, expensive | D 30/10m/IP; origin, identity validation, safe SVG processing, licence rules, reuse | Key by account |
| `/api/customizer/iconify/preview` | GET | Public graphic preview | Public read / high bursts | M 300/5m/IP; bounded identity/verified provider | Preserve public read policy |
| `/api/customizer/iconify/search` | GET | Public graphic search | Search / moderate | M 120/5m/IP; bounded queries/provider controls | Preserve public read policy |
| `/api/customizer/library` | GET | Authenticated; own uploads | Private read/signing / moderate | M 120/10m/account, owner filter | Shared account limiter |
| `/api/customizer/library/[id]` | DELETE | Authenticated; own upload | Asset deletion / low | M 60/10m/account; ownership/origin | Shared account limiter |
| `/api/customizer/preflight` | POST | Authenticated; own customization | Font/image validation / moderate, expensive | M 60/10m/IP; owner filter, trusted template, bounded JSON | Shared account limiter |
| `/api/customizer/render` | POST | Authenticated; own customization; print restricted to admin | Render creation / low-moderate, expensive | D 20/10m/IP; own customization, admin print gate, body/origin checks, job reuse | Account key so customers on same IP do not share render budget |
| `/api/customizer/render/[jobId]` | GET, DELETE | Authenticated; own job | Polling / high; cancellation / low | M GET 90/10m/IP; DELETE 30/10m/IP; own customization; placed-order cancellation forbidden | Shared account keys; raise polling budget to support normal cadence |
| `/api/customizer/upload` | POST | Authenticated; own upload | Image upload / moderate, expensive | D 40/10m/account; body/pixel limits, image re-encoding, ownership | Preserve |
| `/api/health` | GET | Public shallow health | Public read / low automated | Intentionally minimal response; no secrets | Preserve; do not challenge health protocol |
| `/api/newsletter` | POST | Public, currently disabled by launch flag | Newsletter / low, spam | M 10/10m/IP; launch/settings gates; body/input validation | Shared limiter; protected token before enabling |
| `/api/order-requests` | GET, POST | Authenticated; own finalized orders | Order creation / low, high value | POST D 30/10m/IP then 12/10m/account; origin/schema/trusted pricing/ownership/idempotency; no-store | Retain account budget; increase coarse IP ceiling for shared networks |
| `/api/products/[slug]/reviews` | GET, POST | GET anonymous-safe eligibility state; POST authenticated delivered-order customer | Review / low, spam | POST M 8/10m/IP; delivered own order, validation, settings gate | Shared account limiter |
| `/api/settings` | GET | Public whitelisted storefront settings | Public read / low-moderate | Public settings projection | Preserve |

## Admin and designer APIs

All these routes pass the `/api/admin` proxy gate. Authenticated mutations except logout have **D 1500/10m/account** in the proxy. Each mutation uses `withAdminMutation` for method, bounded body, same-origin and role checks, then route-specific capability/ownership checks. Studio access is an explicit proxy allowlist; publishing and permanent deletion remain admin-only. Read-only requests do not consume the mutation limit. WAF must return an API-compatible response rather than an interactive challenge. Proposed baseline: preserve guards, shared limiter and existing permissions; no engine or saved-design changes.

| Endpoint | Methods | Route-level access | Risk / expected volume | Extra control / proposal |
|---|---|---|---|---|
| `/api/admin/categories` | GET, POST | Admin | Catalogue / low | Existing admin mutation baseline |
| `/api/admin/categories/[id]` | PUT, DELETE | Admin | Catalogue / low | Existing admin mutation baseline |
| `/api/admin/collections` | GET, POST, PATCH, DELETE | GET studio; writes admin | Catalogue / low | Existing admin mutation baseline |
| `/api/admin/contact-messages` | GET | Admin | Private enquiries / low | No public cache |
| `/api/admin/contact-messages/[id]` | PUT, DELETE | Admin | Private enquiries / low | Existing admin mutation baseline |
| `/api/admin/customizer/asset-categories` | GET, POST | Studio | Library / moderate | Existing studio guard |
| `/api/admin/customizer/asset-folders` | GET, POST | Admin | Library / moderate | Existing admin guard |
| `/api/admin/customizer/asset-folders/[id]` | PATCH, DELETE | Admin | Library / low | Existing admin guard |
| `/api/admin/customizer/assets` | GET, POST | Studio | Library image upload / moderate, expensive | Safe asset ingest; add specific per-account ingest budget |
| `/api/admin/customizer/assets/[id]` | GET, PATCH, DELETE | Admin | Private library / low | Existing admin guard |
| `/api/admin/customizer/feature-flags/[productId]` | GET, PUT | Product editor | Designer mutation / moderate | Product ownership/capability and payload bounds |
| `/api/admin/customizer/fonts/favourites` | PUT | Admin font capability | Admin mutation / low | Capability guard; proxy admin default |
| `/api/admin/customizer/mockups/[productId]` | GET, PUT | Product editor | Designer save / high while editing | Product ownership and payload bounds; preserve cadence |
| `/api/admin/customizer/mockups/[productId]/import` | POST | Product editor | Designer import / low, expensive | Payload bounds and product ownership |
| `/api/admin/customizer/mockups/[productId]/publish` | POST | Admin | Publishing / low, high impact | Existing admin guard |
| `/api/admin/customizer/orders/[orderId]/snapshots` | GET | Admin | Private order snapshots / low | Existing admin guard, no public caching |
| `/api/admin/customizer/render/process` | GET, POST | Admin or valid worker secret | Worker/cron / scheduled, expensive | Timing-safe header secret; bounded job batches; exclude interactive WAF challenges |
| `/api/admin/customizer/render/retry` | POST | Admin wrapper and production command guard | Render retry / low | Existing command authorization; specific expensive-operation limit |
| `/api/admin/customizer/templates/[productId]/publish` | POST | Admin | Publishing / low, high impact | Existing version/publish guards |
| `/api/admin/customizer/templates/[productId]/versions` | GET | Product editor | Private version read / moderate | Product ownership/capability |
| `/api/admin/designers` | GET | Admin | Private staff read / low | Existing admin guard |
| `/api/admin/hero-collections` | GET, POST, PATCH, DELETE | Admin | Storefront content / low | Existing admin mutation baseline |
| `/api/admin/hero-collections/resolve` | GET | Admin | Catalogue lookup / moderate | Existing admin guard |
| `/api/admin/logout` | POST | Logout exempt from live role/session requirement | Logout / low | Exact-path exemption; same-origin/method/body remain; avoid breaking expired sessions |
| `/api/admin/newsletter` | GET | Admin | Private subscribers / low | Existing admin guard |
| `/api/admin/newsletter/[id]` | DELETE | Admin | Subscriber removal / low | Existing admin mutation baseline |
| `/api/admin/newsletter/campaigns` | GET, POST | Admin | Campaign / low, external cost | Existing launch gates and admin baseline |
| `/api/admin/newsletter/campaigns/[id]` | PATCH | Admin | Campaign / low | Existing launch gates and admin baseline |
| `/api/admin/order-requests` | GET | Admin | Private orders / moderate | Existing admin guard |
| `/api/admin/order-requests/[id]` | PUT, DELETE | Admin | Orders / low, high impact | Existing command/ownership rules preserved |
| `/api/admin/products` | GET, POST | Studio list; create capability | Designer catalogue / moderate | Existing capability guards |
| `/api/admin/products/[id]` | PUT, DELETE | PUT product editor; DELETE admin | Designer save / high; deletion / low | Product ownership; no generic aggressive limit |
| `/api/admin/products/[id]/permanent-delete` | POST | Admin | Destructive catalogue / very low | Existing protections; no test writes |
| `/api/admin/products/[id]/restore` | POST | Admin | Catalogue recovery / low | Existing admin guard |
| `/api/admin/products/[id]/reviews` | POST | Admin | Review moderation / low | Existing admin guard |
| `/api/admin/products/[id]/reviews/[reviewId]` | DELETE | Admin | Review moderation / low | Existing admin guard |
| `/api/admin/products/[id]/workflow` | POST, PUT | Current actor and product workflow capabilities | Designer submission/admin review / moderate | Ownership and workflow transition checks |
| `/api/admin/products/deleted` | GET | Admin | Deleted catalogue / low | Existing admin guard |
| `/api/admin/production/assets` | GET | Admin | Private production assets / low | Preserve private signed access |
| `/api/admin/production/client-ip` | GET | Admin | Topology diagnostic / very low | No-store; operator verifies trusted proxy chain |
| `/api/admin/production/clock` | GET | Admin | Clock diagnostic / very low | Existing admin guard |
| `/api/admin/production/health` | GET | Admin or valid worker secret | Worker health / scheduled | No public data; exclude interactive WAF challenge |
| `/api/admin/production/manual-complete` | POST | Admin wrapper and production command guard | Production finalization / very low | Snapshot/order state rules preserved |
| `/api/admin/production/notification-delivery` | POST | Admin wrapper and production command guard | External delivery retry / low | Established authorization/idempotency |
| `/api/admin/production/retry` | POST | Admin wrapper and production command guard | Production render retry / low, expensive | Specific per-account expensive-operation budget |
| `/api/admin/production/storage-cleanup` | GET, POST | Admin | Storage maintenance / very low | Dry-run/state-aware cleanup; no destructive tests |
| `/api/admin/settings` | GET, PUT | Admin | Security/business settings / very low | Existing admin mutation baseline |
| `/api/admin/settings/test-email` | POST | Admin | Email send / low, external cost | Specific per-account send budget |
| `/api/admin/uploads` | POST | Studio | Image/video upload / moderate, expensive | Safe validated/re-encoded media; specific per-account upload budget |

## Non-API route and direct Supabase flows

| Surface | Actual destination | Existing trust boundary | Required deployment protection |
|---|---|---|---|
| `/auth/callback` GET | Husnalogy, then Supabase code/OTP exchange | Safe return path, Supabase verification/session cookies | Do not challenge callback; correct approved HTTPS redirect list |
| Email/password login | Browser to Supabase `/auth/v1/token?grant_type=password` | Supabase Auth | Supabase Turnstile integration + project auth limits; Husnalogy WAF does not cover it |
| Signup | Browser to Supabase `/auth/v1/signup` | Supabase Auth + profile creation/RLS | Supabase Turnstile integration + signup/email limits |
| Password reset | Browser to Supabase `/auth/v1/recover` | Supabase Auth | Supabase Turnstile integration + recovery/email limits |
| OTP/email verification | Browser `/auth/v1/verify` and server callback verifyOtp | Supabase Auth token verification | Review provider verification limits; preserve callback/verification behavior |
| Google OAuth | Supabase OAuth authorize flow then Google then callback | Supabase/Google code flow | Preserve provider callback and session establishment; no CAPTCHA on background OAuth callback |
| Refresh/session persistence | Supabase Auth refresh/token/getUser | Supabase-issued session | Preserve refresh; do not require CAPTCHA for background refresh |
| Password update/logout | Browser Supabase auth updateUser/signOut | Authenticated Supabase session | Preserve token/session validation and provider limits |
| Cart | Browser Supabase `cart_items` select/upsert/update/delete | User-scoped RLS, database checkout integrity | Husnalogy API/WAF does not cover direct PostgREST traffic; review Supabase gateway/database policies |
| Wishlist | Browser Supabase `wishlist_items` select/upsert/delete | User-scoped RLS | Same direct Supabase boundary as cart |

No dedicated checkout payment callback, webhook route, OTP-send/resend route, custom quote-request route, or storefront search API exists. `/api/checkout/quote` is a price calculation endpoint, not a lead-generation enquiry. Search uses catalogue rendering/client logic and the listed customizer search endpoints. Newsletter is intentionally off at launch; do not enable it as a side effect.

## Limiter and infrastructure findings

1. Existing D uses a non-transactional Redis pipeline with INCR + EXPIRE NX. It validates only INCR, and returns a full-window Retry-After instead of the remaining TTL. Proposed atomic Redis script returns count + remaining TTL; reject malformed/error responses and retain bounded local fallback.
2. Existing M buckets are one Node process only. Startup can require Upstash with `REQUIRE_DISTRIBUTED_RATE_LIMIT=1`; no dashboard/backend connectivity has yet been verified. Switching critical customer mutations to D retains memory protection on a single process and makes deployment scaling explicit.
3. Shared-IP limits on rendering, polling, private asset resolution, reviews and checkout quotes can penalize independent customers on mobile/office networks. Authenticate first and use verified account IDs for those budgets. Keep coarse IP protection where justified, with enough room for many accounts.
4. Autosave already uses an account key and 600 writes/5m, above the one-write/second queue cadence plus retries. Preserve this number and queue/engine implementation.
5. `getClientIp` reads only the configured rightmost trusted `X-Forwarded-For` hop; `CF-Connecting-IP` and `X-Real-IP` are ignored. Default one hop is an assumption, not verified Hostinger topology. A short/invalid chain becomes `unknown`. Do not change this trust model without a verified proxy/blocked-origin boundary.
6. Cloudflare zone/plan, WAF rules, SSL mode, direct-origin firewall and live Upstash are not accessible or verified by this source audit. No external settings have been changed. A deployment checklist must distinguish these manual gates from local tests.
7. Preserve timing-safe worker headers, worker protocol responses, origin controls, private Cache-Control and RLS. No interactive challenge on JSON clients, OAuth callbacks, workers, or social/public asset crawlers. No engine, Effects, Remove BG, or saved-data changes are proposed.
