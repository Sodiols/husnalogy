# Husnalogy Customizer V2 — Technical Documentation

This document describes the architecture of the Husnalogy Customizer V2: the
normalized document model, permissions, template publishing, rendering
pipeline, storage, database schema, and operational procedures.

---

## 1. Architecture overview

```
┌──────────────────────┐     ┌──────────────────────┐
│  Admin Design Studio │     │  Customer Editor     │
│  (design-builder/*)  │     │  (personalize/*)     │
└──────────┬───────────┘     └──────────┬───────────┘
           │  template (V1 flat draft)   │  values + editorState
           ▼                             ▼
┌─────────────────────────────────────────────────────┐
│  Shared engine (lib/customizer + lib/customizer/v2) │
│  masks · text layout · fonts · document · preflight │
└──────────┬──────────────────────────────┬───────────┘
           │                              │
           ▼                              ▼
┌──────────────────────┐     ┌───────────────────────────┐
│  CustomizerPreview   │     │  Server SVG (v2/svg.ts)   │
│  (browser SVG)       │     │  → resvg → PNG → pdf-lib  │
└──────────────────────┘     └───────────────────────────┘
```

Design principles:

- **One source of truth.** The normalized document (flat V1 template in
  `product_customizer_templates`, V2 `CustomizerDocument` in version/order
  snapshots) is canonical. Scenes are always derived, never stored.
- **One implementation per concern.** Mask paths
  (`lib/customizer/v2/masks.ts`), text layout
  (`lib/customizer/v2/text-layout.ts`), and layer resolution
  (`app/components/customizer/customizer-utils.ts`) are each implemented once
  and shared by the interactive canvas, thumbnails, review, server preview,
  and print rendering. This is what makes browser preview and print output
  identical.
- **The server never trusts the client.** Prices, permissions, storage paths,
  fonts, and options are re-validated server-side on every save, order, and
  render.

## 2. Normalized document schema (V2)

Defined in `lib/customizer/v2/types.ts`.

- `CustomizerDocument` — schemaVersion (3), templateId, templateVersion,
  engineVersion, canvas, pages, fields, layers, settings, assets.
- `CustomizerPage` — id, name, enabled, widthPx/heightPx, widthIn/heightIn,
  dpi, backgroundColor, backgroundAssetId, safeArea, bleed, allowCustomerText,
  allowCustomerUploads.
- Discriminated layer types: `text`, `image`, `shape`, `frame`, `grid`,
  `group`, `element`, `background`. All share id, name, pageId, x/y (centre),
  width/height, scale, rotation, opacity, hidden, zIndex, locked,
  adminEditable, customerEditable, customerPermissions, groupId, fieldId,
  metadata.
- `ImageTransform` — crop data kept separate from frame geometry: assetId,
  cropX/Y/Width/Height, zoom, offsetX/Y, rotation, flipX/Y, fitMode.
- `MaskShape` — rectangle, rounded, circle, oval, arch, arch-top,
  arch-bottom, polygon (normalized points), path (custom SVG path + viewBox).

**Schema versions.** Version 1 is the legacy flat template stored in
`product_customizer_templates` (kept as the live draft format for backward
compatibility). Version 2 is the first typed document; version 3 adds
persistent guides, photo-grid slot overrides, groups, and mockup configuration.
Both old formats migrate through
`migrateCustomizerDocument(document, 1 | 2, 3)` / `templateToDocument()` in
`lib/customizer/v2/document.ts` and persisted in
`customizer_template_versions.document` and `order_design_snapshots.snapshot`.

**Adapters** (`lib/customizer/v2/document.ts`):
`documentToScene`, `sceneToDocument`, `resolveCustomerDocument`,
`documentToRenderPayload`; `documentToSvg` is `buildPageSvg` in
`lib/customizer/v2/svg.ts`.

## 3. Customer permissions

`CustomerPermissions` (spec §18) remains a per-layer enforcement object with:
select, editContent, editStyle, changeFont, changeFontSize, changeColor,
changeAlignment, changeLetterSpacing, changeLineHeight, move, resize, rotate,
duplicate, delete, replaceImage, cropImage, zoomImage, repositionImage,
flipImage, changeOpacity, changeLayerOrder.

The admin exposes one **Customer editable** checkbox. When checked, every
permission is enabled automatically; when unchecked, every permission is
disabled. `customerEditablePermissionBundle()` in `lib/customizer/index.ts`
keeps the stored permission object, customer UI, V2 document, and server
validation synchronized without separate per-action checkboxes. Photo grids
also support the deliberate advanced exception required by fixed layouts: the
grid container can stay fixed while individual slots remain replaceable and
croppable.

**Server enforcement** happens in `lib/customizer/v2/validate.ts`
(`validateCustomerState`), called by `lib/customizer/save-validation.ts` from
both customization API routes. Forged changes (e.g. editing a layer whose
checkbox is off, using an unavailable font) return HTTP 422 with typed violations; the
persisted state is always the sanitized subset.

## 4. Template publishing and versioning

- The `product_customizer_templates` row is the **working draft** the admin
  builder autosaves.
- Publishing (`POST /api/admin/customizer/templates/[productId]/publish`)
  validates the draft, converts it to a V2 document, collects font
  dependencies, and inserts an **immutable** row in
  `customizer_template_versions`. The draft row's `version` is bumped to
  match.
- New customizations record `template_version`; saved designs, cart items,
  and orders are validated/rendered against their exact version snapshot via
  `getTrustedTemplateForCustomization()` in `lib/customizer/versions.ts`
  (falls back to the live template for pre-versioning rows).

## 5. Customer save flow

1. Customer edits → `values` (field content) + `editorState`
   (`layerOverrides` keyed by template layer id, `userLayers` for
   customer-added text/elements).
2. Debounced autosave POST/PATCH `/api/customizations` (guest drafts go to
   localStorage, migrated on sign-in).
3. Server: `validateCustomizationSave()` loads the trusted template, runs
   `validateCustomerState()`, rejects hard violations, persists the sanitized
   state.
4. Undo/redo history is snapshot-based, drag gestures merge into single
   entries, autosave never clears history.

## 6. Cart and order flow

- Add to cart stores customizationId + templateVersion + selectedOptions and a
  permanent server-output reference. It never stores browser data URLs or
  expiring signed URLs. Cart, checkout, review, account, and order views ask a
  protected endpoint for a fresh signed WebP mockup and retain the product
  image as a graceful fallback.
- Order creation (`lib/orders/index.ts` → `createOrderRequest`):
  1. `applyTrustedPricing()` recalculates every line item server-side via
     `calculateCustomizationPrice()` (`lib/customizer/v2/pricing.ts`) — the
     client price is never persisted when the product resolves.
  2. `insertSupabaseOrder()` inserts order + items, marks customizations
     `ordered`.
  3. `createOrderDesignSnapshots()` (`lib/customizer/order-snapshots.ts`)
     writes one immutable `order_design_snapshots` row per customized item:
     resolved V2 document, values, editorState, pricing, preflight result,
     canvas/DPI/bleed/safe-area, SHA-256 integrity hash.
  4. Print render jobs (`print_png`, `print_pdf`) are queued.

## 7. Render pipeline

`lib/customizer/v2/server/render.ts` + `lib/customizer/render-jobs.ts`.

1. Load customization + trusted template version.
2. `buildPageSvg()` produces deterministic SVG using the shared mask
   generator and text layout (server measurement via opentype.js on the same
   TTFs the browser loads).
3. Every image is inlined as a data URI first — only our own Supabase storage
   hosts, site-relative public files, and data URIs are accepted
   (spec §33: no arbitrary remote loading).
4. `@resvg/resvg-js` renders PNG with `loadSystemFonts: false` and ONLY the
   registry font files. Print mode fails with `font-unavailable` if a design
   depends on a non-registry font — no silent substitution.
5. Print PNGs render at native canvas resolution plus configured bleed;
   `buildPrintPdf()` (pdf-lib) embeds them at the exact physical size
   (trim + bleed, 72pt/in). Outputs are RGB; no false CMYK labelling.
6. Outputs upload to the private `customizer-renders` bucket and are downloaded
   once by the worker for byte-length/SHA-256 verification before a ready
   `customizer_render_outputs` row is written. Rows record output type, MIME,
   input hash, template/mockup versions, dimensions, DPI, size, checksum, and
   verification time.
   Access is via short-lived signed URLs from protected endpoints only.

**Job queue.** `customizer_render_jobs` uses queued/retrying/processing/
completed/failed/cancelled states. Atomic database claims issue a worker id,
lock token, three-minute lease, and heartbeat. Expired leases are recovered,
failures use bounded exponential backoff for at most three attempts, and
customers can cancel their own jobs. The stable input hash includes permanent
asset references (never signed tokens), resolved document state, template and
mockup versions, font-registry version, and renderer version. Workers:

- Inline: preview/thumbnail jobs process synchronously in
  `POST /api/customizer/render`.
- Batch: `POST /api/admin/customizer/render/process` (admin session or
  `x-render-secret: $RENDER_WORKER_SECRET` header) processes queued jobs by
  priority. Point a scheduler (cron, Supabase scheduled function, GitHub
  Action) at this endpoint to run the worker.
- Retry: `POST /api/admin/customizer/render/retry` with `{jobId}` or
  `{snapshotId}` (audit-logged).
- Status/cancel: `GET` or `DELETE /api/customizer/render/[jobId]` after an
  ownership check.

## 8. Fonts

Registry: `lib/customizer/v2/fonts.ts`. Files live in `public/fonts/*.ttf`
(Cormorant Garamond 400/500/600/700 + italic, Inter 400/500/600/700 +
italic). System fonts (Georgia, Arial, …) remain listed for legacy templates
but are `serverRenderable: false` — preflight warns and print jobs refuse
them.

**To add a font:**
1. Add the licensed TTF files to `public/fonts/`.
2. Add a `FontRegistryEntry` in `FONT_REGISTRY` (id, cssFamily, files,
   weights, availability, license, fallback).
3. Load the webfont in `app/layout.tsx` (`next/font/local`) with the same family name.
4. Optionally add it to `CUSTOMIZER_APPROVED_FONTS` in `lib/customizer/index.ts`
   for the legacy pickers.

Run `npm run validate:fonts` before every build. It checks that each registered
production file exists, is non-empty, and parses as a real font.
`public/fonts/README.md` records the licensing responsibility. Production
rendering returns `FONT_FILE_MISSING` rather than silently substituting. The
application no longer imports `next/font/google`, so a clean build does not
depend on Google Fonts.

## 9. Elements library

- Admin: Dashboard → **Elements Library** (upload SVG/PNG/JPG/WebP, title,
  category, tags, customer visibility, archive, delete-when-unreferenced).
- SVG uploads pass `sanitizeSvg()` (`lib/customizer/v2/uploads.ts`): scripts,
  event handlers, foreignObject, external href/url() references, and XML
  entities are rejected. Single-colour SVGs are flagged `tintable` and can be
  recoloured by customers via an feFlood/feComposite filter.
- Customer: Elements tool (shown when the template's
  `settings.allowCustomerElements` is on) → browse/search/filter → insert as
  a user layer (move/resize/rotate/flip/tint/opacity/duplicate/delete).
- Storage: public `customizer-elements` bucket; rows in `customizer_assets` +
  `customizer_asset_categories`.

## 10. Customer upload library

- `POST /api/customizer/upload` validates magic bytes (never browser MIME),
  enforces 15MB / 12000px / decompression limits, EXIF-rotates and strips
  metadata, and generates original + editor (1600px WebP) + thumbnail (384px
  WebP) versions under `customer-uploads/{uid}/…`.
- `customer_asset_library` records every upload; `GET /api/customizer/library`
  lists it with fresh signed URLs (search, sort, pagination);
  `DELETE /api/customizer/library/[id]` refuses while the asset is referenced
  by an in-cart or ordered design.
- Persistent customization/order JSON stores a versioned asset id, owner,
  private bucket/path variants, dimensions, MIME, checksum, and original file
  name. One server resolver verifies row ownership and signs original, editor,
  or thumbnail delivery URLs on demand. Legacy path-only references remain
  readable; signed URLs are stripped before every save and stable hash.

## 11. Database tables (V2 additions)

Migrations: `20260714120000_customizer_v2.sql`,
`20260714153000_customizer_v2_completion.sql`, and the production hardening
migration `20260714210000_customizer_v2_production_hardening.sql`.

| Table | Purpose |
|---|---|
| `customizer_template_versions` | Immutable published template snapshots |
| `customizer_assets` / `customizer_asset_categories` | Elements library |
| `customer_asset_library` | Reusable customer uploads |
| `customizer_render_jobs` / `customizer_render_outputs` | Render queue + files |
| `customizer_preflight_results` | Preflight audit trail |
| `order_design_snapshots` | Permanent per-order design snapshots |
| `customizer_mockup_templates` | Draft/published versioned mockup roots |
| `customizer_guides` | Admin canvas guides |
| `customizer_mockup_views` / `customizer_mockup_artwork_areas` / `customizer_mockup_overlays` | Normalized flat mockup scenes |
| `customizer_feature_flags` | DB-authoritative global/product-type/product rollout controls |

**RLS:** admins manage everything; customers read/write only their own
uploads, designs, and render jobs; public reads only enabled published
templates and explicitly public assets. Render outputs and order snapshots
are written exclusively through the service role. There is no broad
`authenticated` write policy on any administrative table.

Buckets: `customizer-elements` (public read), `customizer-renders` (private,
service-role only + signed URLs).

## 12. Preflight

`runPreflight()` in `lib/customizer/v2/preflight.ts` checks: missing required
text/images, text overflow (via real layout), text below readable size,
unknown/unrenderable fonts, empty frames/grid slots, broken asset refs,
low-resolution photos (effective DPI vs page DPI), objects outside the page,
important objects outside the safe area, invalid page dimensions. Errors
block ordering; warnings don't. Server endpoint:
`POST /api/customizer/preflight` (`{customizationId, context}`), results are
persisted to `customizer_preflight_results`.

## 13. Photo grids and groups

Photo grids remain structured layers. `lib/customizer/v2/grids.ts` owns slot
normalization, layout rectangles, crop merging, and geometry validation.
Admins can insert 2/3/4/5/6/8/9-photo layouts and configure the container plus
each slot's mask, default image, required state, and customer editability.
Customers can upload, reuse, or drag library photos into slots; clear, crop,
pan, zoom, rotate, flip, reset, or swap them; and undo/redo those operations.
Slot overrides preserve private bucket/path references and image dimensions.

Groups are persistent `group` layers. `lib/customizer/v2/groups.ts` owns
rotated bounds, descendants/cycles, local-to-canvas conversion, group/ungroup,
proportional nested transforms, and inherited visibility/opacity. Children
retain absolute canvas coordinates with `groupId` providing the hierarchy,
which makes V1 compatibility and ungrouping lossless.

Both systems resolve before browser SVG, server SVG, PNG/PDF, thumbnail,
review, cart, and order-snapshot rendering. Guides are editor furniture and
never enter print output.

## 14. Mockups

Mockup scenes are authored and rendered from normalized
`customizer_mockup_templates`, `customizer_mockup_views`,
`customizer_mockup_artwork_areas`, and `customizer_mockup_overlays` rows.
Published rows are authoritative; legacy template JSON is a read-only fallback
until imported. Each view supports multiple independently ordered page areas,
clip masks, opacity/blend, rotation, visibility/locking, and deterministic
overlays. Four-corner perspective uses an inverse homography with bilinear RGBA
sampling, convex/self-intersection validation, transformed clipping, and safe
canvas-boundary cropping. Cylinder/custom warps fail explicitly. Customer
mockups are cached server WebP (PNG only when transparency is required); print
artwork remains flat and undistorted.

## 15. Administrator tools and guides

The rail contains functional Select, Text, Upload, Frame, Grid, Shape, Line,
Elements, Group, Ungroup, Background, Guide, Pan, Preview, Pages, Layers,
Fields, Options, and Settings actions. Guides persist in the template and can
be dragged, positioned numerically, locked, hidden, or deleted. Customer guide
visibility is opt-in.

## 16. Migrating existing templates

Nothing to do for basic operation: V1 rows keep working. To version an
existing template, open its Design Studio and press **Publish** — that
creates version snapshot #N+1 via the migration path. In-memory migration
warnings (repaired pages, moved layers) are returned by
`templateToDocument()` and surfaced in the publish response.

## 17. Preflight and render errors

Blocking checks cover missing fonts/content/assets, text overflow, empty
required grid slots, invalid crop/mask/slot geometry, blocking DPI, invalid
pages/groups, unsupported layers, production-render failure, and missing
trusted versions. Cart addition calls server preflight and stops on errors.

Canonical render codes are `FONT_FILE_MISSING`, `ASSET_NOT_FOUND`,
`ASSET_ACCESS_DENIED`, `INVALID_DOCUMENT`, `TEXT_OVERFLOW`,
`IMAGE_DECODE_FAILED`, `PDF_RENDER_FAILED`, `MOCKUP_RENDER_FAILED`, and
`UNSUPPORTED_LAYER`. Jobs use a recursively stable SHA-256 hash, reuse
identical trusted work, and retry at most three times.

## 18. Tests and deployment

`npm test` — unit tests in `lib/customizer/v2/__tests__/` covering
masks (incl. true arch regression), text layout (wrapping, shrink-to-fit,
maxLines), V1→V2 migration + permission mapping, server validation
(reject/sanitize), pricing + option validation, preflight, and the full
server render pipeline (real PNG/PDF output, watermark/placeholder exclusion
in print mode, untrusted-host rejection, font failure).

Run release gates in this order:

```text
npm install
npm run validate:fonts
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

Playwright always runs the local-font/responsive public smoke. The complete
customer, mobile, admin, ownership, private-asset, perspective-WebP, caching,
and render journeys require `.customizer-e2e.json` or equivalent `E2E_*`
variables. Create the manifest with `npm run seed:customizer:test` against an
explicitly confirmed local/staging Supabase project. Seeded suites fail setup
when the fixture is absent; they never silently skip.

Apply all three migrations before enabling feature flags. Required buckets are
`customer-uploads` (private), `customizer-elements` (public read),
`product-mockups` (admin managed), and `customizer-renders` (private service
role). Configure `RENDER_WORKER_SECRET` and a scheduler.

Roll out `customizer_v2`, `customizer_v2_grids`, `customizer_v2_groups`,
`customizer_v2_mockups`, `customizer_v2_perspective_mockups`, `customizer_v2_server_rendering`, and
`customizer_v2_print_pdf` on selected products first. Rollback means disabling
flags and returning products to the existing customizer. Never reverse-drop
customer uploads, render files, customizations, orders, or immutable snapshots.

Flags are enforced, not informational: disabled grid/group tools cannot create
or mutate those structures, disabled mockups stay out of the customer preview,
and render/PDF jobs are rejected with `FEATURE_DISABLED`. Existing saved layers
remain readable and client-renderable so disabling a flag is a safe product-level
fallback instead of a destructive document rewrite.
