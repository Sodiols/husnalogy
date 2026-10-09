# SEO, sharing, crawl and form-confirmation implementation

Implemented 2026-10-09 on Next.js 16.3.8 (App Router). Scope: metadata, sharing previews, image alt text, sitemap, robots, HTTPS/canonical verification and the contact thank-you page. Cloudflare, Turnstile, WAF and rate limiting are **out of scope** and unchanged; existing rate limits, CSRF guards, auth, RLS and storage rules are untouched.

> The earlier inventories `SEO_SECURITY_API_INVENTORY.md` and `SEO_SECURITY_FORM_INVENTORY.md` came from a previous attempt and propose Turnstile and rate-limit changes. Those proposals were **not** implemented; this document supersedes them for SEO.

## Where things live

| Concern | File |
| --- | --- |
| Metadata builder (title, description, canonical, robots, Open Graph, X card) | `lib/seo/metadata.ts` |
| Registry of public static pages (copy + sitemap source) | `lib/seo/pages.ts` |
| Product / collection metadata | `lib/seo/catalogue.ts` |
| Which images may be shared (durable public only) | `lib/seo/share-image.ts` |
| Product image alt text | `lib/seo/image-alt.ts` |
| Sitemap URL list (pure) | `lib/seo/sitemap.ts`, served by `app/sitemap.ts` |
| robots.txt exclusions | `lib/seo/robots.ts`, served by `app/robots.ts` |
| Default sharing image (1200 x 630) | `public/og/husnalogy-share.png`, made by `scripts/generate-social-image.mjs` |
| Contact confirmation | `app/thank-you/page.tsx`, `app/contact/contact-client.tsx` |

Next merges metadata **shallowly**, so every public page gets a complete set from `publicPageMetadata()`; the root layout carries only page-neutral defaults (no canonical, no `og:url`). Before this change the root layout's `canonical: "/"` was inherited by every page without its own, so production `/about`, `/contact` and others declared the homepage as canonical.

## Route inventory

**Public and indexable** — `/`, `/products`, `/collections`, `/weddings`, `/save-the-dates`, `/cards`, `/stationery`, `/gifts`, `/about`, `/our-style`, `/husnalogy-studio`, `/contact`, `/support` (FAQ, delivery, returns), `/privacy`, `/terms` (shipping, refunds); `/products/[slug]` when active + public; `/collections/[slug]` when it is an admin collection or built-in filter with at least one public product.

There is no standalone FAQ, shipping, refund, nikah, holud or business-card page; none was invented. `/collections/{gifts,cards,stationery,save-the-dates}` render the same listing as the landing page and canonicalize to it.

**Public but noindex** (crawlable so the directive is seen) — `/search`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/thank-you`, direct-link products (`visibility = direct`), unknown or empty collections, 404s.

**Private / authenticated** (noindex, nofollow; proxy-gated) — `/account`, `/profile`, `/orders`, `/saved-addresses`, `/favorites`, `/cart`, `/checkout` (order confirmation stays inside checkout), `/products/[slug]/personalize`, `/auth/callback/finish`.

**Admin / designer** (noindex, nofollow; role-gated) — `/admin/*`, `/designer`, `/upload-from-phone`, `/__e2e/*` fixtures (404 in production).

**API / non-HTML** — `/api/*` and `/auth/callback` (route handler): `X-Robots-Tag: noindex, nofollow`, disallowed in robots.txt, never in the sitemap.

Draft, hidden and deleted products now return a real **404** (previously a 200 "Product not found" page).

## Sitemap

`/sitemap.xml` is generated per request from `getActiveProducts()` and `getPublicCollectionEntries()` (service-role, server-only). Publishing, unpublishing or deleting a product changes it immediately. A catalogue read failure returns an error rather than a shorter sitemap. `lastmod` comes only from stored `updated_at` values; pages without one carry no date. No `changefreq`/`priority`.

Scaling: the per-file limit is 50,000 URLs (`SITEMAP_URL_LIMIT`). Before reaching it, move products into `app/products/sitemap.ts` with `generateSitemaps()` and list each file in `app/robots.ts`. Note that the shared catalogue loader (`getProductRows`) does not paginate, so it is bounded by the PostgREST max-rows setting (default 1,000) for the whole storefront, not just the sitemap.

## Sharing images

Only these may appear in `og:image`, `twitter:image` and sitemap images: files under `/images/`, `/og/`, `/Brand Kit/`, `/icons/`, and this Supabase project's public catalogue buckets (`product-images`, `product-mockups`, `site-assets`) without a query string. Signed URLs, private buckets (customer uploads, renders, production files), other hosts and API routes fall back to the branded default. Customer uploads and customization data are never read.

The default image uses the approved wordmark (`Logo-5.png`), `#F4ECEC`, `#303839`, a `#D4AF37` hairline and Cormorant Garamond. Gotham is not shipped with the site, so the small domain line uses the site's body face (Inter). Regenerate with `node scripts/generate-social-image.mjs`.

## Alt text

Product images use author alt text from `product.imageAltText[i]` (stored per `product.images[i]`) when present, otherwise the product title; extra gallery views are numbered. The admin product form does not yet expose an alt-text field, so today every product uses the title fallback. Homepage category and gifting photographs have alt text written from the actual images. Decorative images (wedding hero background, ornamental logo, duplicate thumbnails inside labelled controls) keep `alt=""`.

## HTTPS and canonical domain (verified live 2026-10-09, read-only)

- `https://husnalogy.com` 200; Let's Encrypt certificate covering `husnalogy.com` and `www.husnalogy.com`, valid 2026-10-02 to 2026-12-31.
- `http://husnalogy.com/*` → 301 → `https://husnalogy.com/*` (Hostinger).
- `https://www.husnalogy.com/*` → 308 → `https://husnalogy.com/*` (the app's `canonicalHostRedirects`).
- `http://www.husnalogy.com/*` → 301 → `https://www.husnalogy.com/*` → 308 → apex: two hops, no loop.
- No `http://` resources found in the home, products, about or contact HTML.
- Security headers present and unchanged. HSTS is `max-age=63072000; includeSubDomains` without `preload` (pre-existing). `includeSubDomains` forces HTTPS on every subdomain; confirm all subdomains (e.g. mail or staging hosts) serve valid HTTPS before ever adding `preload`.

Canonical, `og:url`, sitemap and robots all derive from `NEXT_PUBLIC_SITE_URL`, which the production build requires to be `https://husnalogy.com`.

### Optional Hostinger action (not performed)

Make `http://www.husnalogy.com` redirect straight to `https://husnalogy.com` to save one hop. This is a hosting-panel redirect change and needs the owner's approval; the current chain is already correct.

## Contact form

The form navigates to `/thank-you` only when `/api/contact` answers 2xx with `{ ok: true }` (the message was saved). Validation errors, 429, 5xx, non-JSON error pages and network failures keep the visitor on the form with their text, show a specific message and allow retry; a ref guard prevents double submissions. The thank-you page shows no personal data, takes nothing from the URL, is noindex and is not in the sitemap. There is no analytics or conversion tracking in the codebase, so nothing counts a visit to `/thank-you`.

Unchanged: newsletter (disabled by `LAUNCH_FEATURES.marketingEmail`, inline confirmation), sign-up verification, login, Google OAuth, password reset, product reviews (inline), checkout order confirmation.

## After deploying

1. Fetch `https://husnalogy.com/robots.txt` and `/sitemap.xml`; submit the sitemap in Google Search Console and Bing Webmaster Tools.
2. Re-scrape a few URLs in the Facebook Sharing Debugger and LinkedIn Post Inspector; their caches still hold the old `heroIMG.png` preview.
3. Use URL Inspection on `/about` and `/contact` to confirm Google now sees their own canonical.
