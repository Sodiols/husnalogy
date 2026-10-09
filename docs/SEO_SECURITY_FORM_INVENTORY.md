# Forms and authentication inventory (before implementation)

Audit date: 2026-10-08. Source: current Next.js 16.3.8 App Router checkout. This inventory was prepared before application edits. Existing uncommitted Customizer work is outside this change.

| Surface | Submission path/provider | Existing protection and success experience | Planned change |
| --- | --- | --- | --- |
| Contact / custom design / order enquiry (`/contact`) | `POST /api/contact` → `lib/messages` → Supabase `contact_messages` using the server service role | Same-origin guard, bounded 24 KiB JSON, distributed-capable 6 requests / 10 minutes by IP, field validation; inline confirmation after database insert. No email-delivery provider is used for this form. | Server-verified Turnstile, retry-safe insert, generic response without contact PII, verified-success redirect to noindex `/thank-you`. |
| Newsletter (shared home/about/weddings component, contact and support) | `POST /api/newsletter` → Supabase `newsletter_subscribers` | Globally disabled by `LAUNCH_FEATURES.marketingEmail=false`; also gated by store setting; bounded 4 KiB JSON, same-origin, process-local 10 / 10 minutes; inline success. | Keep disabled. Upgrade rate limit to distributed-capable. Require deliberate protected activation before marketing is enabled. |
| Email/password login, including modal | Browser Supabase `signInWithPassword` → project `/auth/v1/token?grant_type=password` | Supabase service protections; no own login API. Role-based routing after login; account-existence details can appear in provider errors. | Pass dedicated auth widget `captchaToken` to Supabase when configured; generic account errors. Supabase CAPTCHA enforcement/rate settings require dashboard verification. |
| Email/password signup, including modal | Browser Supabase `signUp` → project `/auth/v1/signup`; then `profiles` upsert through PostgREST/RLS | Existing password/name/email validation, email confirmation state when no session; otherwise existing redirect. | Same dedicated auth CAPTCHA integration; preserve verification flow. |
| Forgotten password, including modal | Browser Supabase `resetPasswordForEmail` → project `/auth/v1/recover` | Generic success message; origin-bound callback target. | Pass auth `captchaToken`; preserve recovery callback. |
| Set replacement password (`/reset-password`) | Browser Supabase `updateUser` | Requires recovery session; checks hash/token/session; redirects to account on success. | Preserve session-bound flow; no redundant CAPTCHA. |
| Google OAuth | Browser Supabase `signInWithOAuth` → Supabase → Google → `/auth/callback` | Existing PKCE/full-page redirects and role resolver | Preserve; no CAPTCHA on Google callback or session refresh. |
| Email confirmation / recovery callback | `/auth/callback` server `verifyOtp` or `exchangeCodeForSession`; `/auth/callback/finish` for implicit URL hashes; reset page can also `verifyOtp` | Existing safe redirects, role and recovery handling | Preserve. Domain WAF must not challenge callback protocols. |
| Logout / session refresh | Browser Supabase `signOut` / SDK session maintenance; admin logout uses `POST /api/admin/logout` | Supabase session/RLS, existing admin logout | Preserve. |
| Header desktop/mobile search, support search | Local navigation / filtering, no public mutation provider | Existing form UX | Preserve; no CAPTCHA. |
| Ask Logy chat | `POST /api/ask-logy`, existing first-party handler / optional model provider | Existing bounded input/rate controls, inline reply | Preserve; include in API policy inventory. |
| Product verified review | `POST /api/products/[slug]/reviews` | Authenticated verified-order eligibility; inline saved-review confirmation | Preserve transaction/eligibility protections; no generic thank-you. |
| Product purchase/options form | Browser Supabase `customer_product_options`, `cart_items`, `wishlist_items`; upload uses `/api/customizer/upload` | Account-bound RLS; local option persistence and own upload route | Preserve, document direct-provider boundary. |
| Account profile / address | `/api/account/profile`, `/api/account/addresses`, `/api/account/addresses/[id]`, profile upload route | Existing authenticated ownership validation, inline updates | Preserve. |
| Checkout | `/api/checkout/quote`, `POST /api/order-requests` | Existing authenticated trusted pricing, stable idempotency, verified order success context | Preserve all transaction confirmation logic. |
| Admin forms (products, collections, order status, message status, settings, campaign drafts, uploads) | First-party `/api/admin/*` routes | Existing role guards, validation and route-specific rates | Preserve; API inventory covers endpoint details. |
| Customer and Admin Customizer controls / autosave / rendering | Existing customizer APIs and engines | Existing ownership, autosave, mutation/rate controls | No CAPTCHA added; no engine or saved-data changes. |

## Trust boundaries and rollout blockers

- Login, signup, recovery, browser cart/wishlist/options and profile initialization requests go directly to the configured Supabase project. A Cloudflare zone protecting `husnalogy.com` does **not** rate-limit those requests. Client-side rate limits cannot secure them.
- Existing migration `supabase/migrations/20261007150000_rls_public_surface_hardening.sql` revokes direct anon/authenticated inserts to `contact_messages` and `newsletter_subscribers`. Applying and verifying this migration is required: `supabase/schema.sql` still contains historical public-insert policy definitions, so an un-migrated database could bypass own-route protection.
- No separate quote/lead platform, Web3Forms, Formspree, or contact email sender was found. Contact is durable database intake; Resend is used elsewhere for order emails, not contact delivery.
- No analytics/conversion SDK was found. A PII-free success event may be emitted by the contact client only after a confirmed server success; a visit to `/thank-you` must never count by itself.
- Current CSP disallows third-party scripts and all iframes. Turnstile requires a narrow `https://challenges.cloudflare.com` allowlist in script/frame/connect directives. Preserve other security headers.
- Cloudflare/Supabase dashboard configuration and production token validation are not verified by source inspection.

## Planned implementation and environment contract

- Shared explicitly rendered, accessible Turnstile widget with expired/error callbacks, automatic token refresh, retry control and cleanup on unmount.
- Contact Siteverify validates every token server-side, its expected `contact` action and configured allowed hostname; rejects missing/invalid/expired/replayed tokens, uses bounded network timeout and omits sensitive values from logs.
- Contact client keeps one submission UUID across network retries; the server derives a stable database primary key and deduplicates only matching normalized content, after a fresh valid challenge. No automatic mutation retries.
- The thank-you page requires a short-lived signed HttpOnly success receipt, contains no PII, uses existing typography and links, and is noindex. Failed saves never set a receipt or redirect.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: public contact widget key, inlined at build time.
- `TURNSTILE_SECRET_KEY`: server-only contact Siteverify key (also signs short-lived, domain-separated receipt values).
- `TURNSTILE_ALLOWED_HOSTNAMES`: optional comma-separated explicit allowed hostnames; defaults to the configured site hostname.
- `NEXT_PUBLIC_SUPABASE_TURNSTILE_SITE_KEY`: separate public auth widget key, enabled deliberately together with Supabase CAPTCHA configuration; its secret belongs in the Supabase dashboard, never browser code.
- Missing contact verification configuration must fail closed. Auth CAPTCHA remains gated by its dedicated public key to support a coordinated dashboard rollout without silently breaking existing authentication.

## Documentation reviewed

Installed Next documentation: Route Handlers, third-party scripts, asynchronous cookies API. Primary provider documentation: [Cloudflare Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [widget lifecycle](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/), [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha). Installed Supabase Auth SDK confirms `options.captchaToken` support for signup, password login and recovery.
