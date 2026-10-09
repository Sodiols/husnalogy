# SEO page inventory before implementation

Audited 2026-10-08 from the current working checkout, including its existing unrelated Customizer changes. Framework: Next.js 16.3.8 App Router / React 19.2.8. Relevant installed metadata, robots and sitemap guides were read before implementation. No code changes preceded this inventory.

## Every existing page

| Route | Intended classification | Existing finding |
| --- | --- | --- |
| `/` | PUBLIC AND INDEXABLE | Root title/description; home canonical |
| `/products` | PUBLIC AND INDEXABLE | Description/canonical present; inherited home sharing metadata |
| `/products/[slug]` | PUBLIC AND INDEXABLE for active/public; PUBLIC BUT NOINDEX for active/direct | Dynamic metadata exists; unrestricted image URL; missing product produces soft 200; direct-link visibility incorrectly indexable |
| `/collections` | PUBLIC AND INDEXABLE | Description; inherited home canonical/sharing |
| `/collections/[slug]` | PUBLIC AND INDEXABLE for catalogue-backed collections; PUBLIC BUT NOINDEX for empty/unknown filters | Database collections plus 57 built-in definitions; arbitrary slugs receive fallback content; no canonical/social override |
| `/weddings` | PUBLIC AND INDEXABLE | Unique description; inherited home canonical/sharing |
| `/save-the-dates` | PUBLIC AND INDEXABLE | Brief unique description; inherited home canonical/sharing |
| `/gifts` | PUBLIC AND INDEXABLE | Unique description; inherited home canonical/sharing |
| `/stationery` | PUBLIC AND INDEXABLE | Unique description; inherited home canonical/sharing |
| `/cards` | PUBLIC AND INDEXABLE | Unique description; inherited home canonical/sharing |
| `/about` | PUBLIC AND INDEXABLE | Unique description; FAQ content within page; inherited home canonical/sharing |
| `/contact` | PUBLIC AND INDEXABLE | Title only; inherited home description/canonical/sharing |
| `/our-style` | PUBLIC AND INDEXABLE | Unique description; inherited home canonical/sharing |
| `/husnalogy-studio` | PUBLIC AND INDEXABLE | Public studio information, not the designer workspace |
| `/support` | PUBLIC AND INDEXABLE | Description/canonical; support, delivery and returns content |
| `/privacy` | PUBLIC AND INDEXABLE | Unique description; inherited home canonical/sharing |
| `/terms` | PUBLIC AND INDEXABLE | Unique description; shipping/refund terms within page |
| `/search` | PUBLIC BUT NOINDEX | Search content currently inherits index and home canonical |
| `/login` | PUBLIC BUT NOINDEX | Title only; currently inherits index |
| `/signup` | PUBLIC BUT NOINDEX | Title only; currently inherits index |
| `/forgot-password` | PUBLIC BUT NOINDEX | Title only; currently inherits index |
| `/reset-password` | PUBLIC BUT NOINDEX | Title only; currently inherits index |
| `/auth/callback/finish` | PUBLIC BUT NOINDEX | Client-only callback completion; no metadata boundary |
| `/account` | PRIVATE / AUTHENTICATED | Proxy gate; lacks noindex |
| `/profile` | PRIVATE / AUTHENTICATED | Proxy gate; lacks noindex |
| `/orders` | PRIVATE / AUTHENTICATED | Proxy gate; lacks noindex |
| `/saved-addresses` | PRIVATE / AUTHENTICATED | Proxy gate; lacks noindex |
| `/favorites` | PRIVATE / AUTHENTICATED | Proxy gate; lacks noindex |
| `/cart` | PRIVATE / AUTHENTICATED | Proxy gate; lacks noindex |
| `/checkout` | PRIVATE / AUTHENTICATED | Proxy gate; lacks noindex; verified order confirmation remains in checkout flow |
| `/products/[slug]/personalize` | PRIVATE / AUTHENTICATED | Existing page auth and noindex; metadata must remain generic and non-personal |
| `/admin/dashboard` | ADMIN / DESIGNER ONLY (admin dashboard) | Role/proxy gate; lacks noindex |
| `/admin/review` | ADMIN / DESIGNER ONLY (admin review) | Existing role checks and noindex |
| `/admin/login` | ADMIN / DESIGNER ONLY | Intentionally returns 404 through proxy; add noindex defensively |
| `/designer` | ADMIN / DESIGNER ONLY | Existing role checks and noindex |
| `/upload-from-phone` | ADMIN / DESIGNER ONLY | Login + studio capability gates; existing noindex |
| `/__e2e/admin-canvas` | ADMIN / DESIGNER ONLY; test fixture | Disk `%5F%5Fe2e/admin-canvas`; gated fixture and noindex |
| `/__e2e/admin-dashboard` | ADMIN / DESIGNER ONLY; test fixture | Disk `%5F%5Fe2e/admin-dashboard`; gated fixture and noindex |
| `/__e2e/customizer` | PRIVATE / AUTHENTICATED; test fixture | Disk `%5F%5Fe2e/customizer`; gated fixture and noindex |
| `/__e2e/product-options` | PUBLIC BUT NOINDEX; test fixture | Disk `%5F%5Fe2e/product-options`; gated fixture and noindex |
| `/__e2e/render-parity` | ADMIN / DESIGNER ONLY; test fixture | Disk `%5F%5Fe2e/render-parity`; pre-existing untracked fixture, noindex |

There are 41 page files. `/admin` is handled by the proxy, without a page file. `/auth/callback` is a non-HTML route handler. `/robots.txt` and `/sitemap.xml` are metadata endpoints. All API route handlers are inventoried separately in the security audit. The existing not-found boundary is nonindexable error content, not an indexable page.

No standalone `/faq`, shipping, refunds, wedding-cards, nikah, holud or business-card page exists. Do not invent unsupported offerings/routes: existing FAQ/help/legal content and actual published product/collection data determine coverage. Three existing redirects are `/best-seller`, `/personalizations`, `/homeandliving` to `/products`.

## Publication and private-data boundaries

- `lib/products/index.ts`: `getActiveProducts` filters `status === active` and `visibility === public`; `getProductBySlug` also permits active/direct links intentionally. Product data is read with a server-only service-role client. `updated_at` is preserved as `updatedAt` by `productFromRow`.
- `lib/collections/store.ts`: database `product_collections` has no independent publication field; public eligibility must derive from associated active/public products (including matching child collections). `lib/collections/index.ts` supplies 57 built-in catalogue filters; do not index empty filters.
- Catalogue media buckets `product-images`, `product-mockups`, `site-assets` use public durable storage URLs. Other folders can be private and signed. Social previews must accept only known local public imagery or the configured Supabase project's public catalogue buckets, without query strings, credentials or signatures.
- Do not derive metadata from customization sessions, uploaded customer images, private template layers or account fields. No engine or saved design change is needed.

## Metadata and sitemap implementation plan

1. Shared public metadata builder with unique title/description, per-page canonical, OG URL/type/image and Twitter card; explicit noindex for private, auth, search, thank-you and tool pages. Root no longer supplies a home canonical to every child.
2. Product descriptions from trusted catalogue fields, title-aware fallback, durable preview validation and branded fallback; preserve direct-link access with noindex. Missing products use the normal not-found boundary.
3. Minimal 1200 x 630 branded sharing PNG using existing artwork and local Cormorant. No Gotham font file is present; retain current legal font assets and document that limitation without changing site typography.
4. Current sitemap omits collections, uses request-time timestamps and loads the whole joined catalogue. Replace with paginated minimal active/public record selection, stable database timestamps, public collection membership and partition support above protocol limits. Preserve `/sitemap.xml` as the crawler entrypoint and fail closed on catalogue failures instead of publishing a silently incomplete result.
5. Robots allow public content/images, advertise the canonical sitemap and exclude private/API/tool routes. Noindex and authentication remain independent controls; publicly accessible auth/search/thank-you pages remain crawlable so noindex is seen.

## Public-image audit

- Product model already stores `imageAltText` in JSONB; gallery, thumbnails and cards do not use it. Introduce a shared image-source-aware alt resolver using stored alt text, then neutral product-title context; never infer material, colour or people from a product title.
- Homepage category/gifting images have empty alt values despite conveying the product examples. Review the actual packaged images before describing them. Hero main image uses collection title; thumbnail links are named but have empty imagery.
- Product gallery repeats title for every image; thumbnail controls lack distinct labels. Use stored alt plus numbered control labels. Decorative duplicate thumbnails inside an already named control may retain empty alt.
- Collection tiles/trending imagery use empty or collection-name alt. Product-backed tiles can use the same safe product alt resolver.
- About story/design images already have descriptive alt; verify against source imagery. About hero brand image uses generic `logo`, which should identify Husnalogy.
- Wedding hero is an explicitly `aria-hidden` background and should stay decorative. Navbar duplicated promotional links and ornamental logos may retain empty alt where text/control names fully cover their purpose.
- Admin/private/customizer images are outside public SEO scope. Preserve all existing Customizer work.

## Verification gates

Automated metadata/image trust/publication/noindex tests; sitemap XML and partition tests; actual HTML and asset HTTP checks with social-crawler user agents; image-alt accessibility and manual imagery review. Live published catalogue, social inspector caches, Cloudflare rules and origin settings require separate externally verified evidence. No dashboard settings were changed during this audit.
