# Customizer Elements — Iconify architecture

The Elements panel combines Husnalogy's own curated library with **Iconify as a
discovery and import source**.

> **Iconify is never a runtime dependency of a design.** Once a graphic is
> imported, Husnalogy owns a sanitized permanent copy. Saved designs, cart
> previews, order snapshots, PNG and PDF rendering never contact Iconify —
> proven by `lib/customizer/v2/__tests__/iconify-offline.test.ts`, which renders
> with every Iconify host hard-failed.

Husnalogy does **not** store all of Iconify. Only graphics a customer or admin
actually imports become permanent records.

## Panel structure

Elements is the customer's **single** insertion tool. There is no separate
Shapes, Frames or QR Code entry on the primary rail — all of them live here.

| Section (landing order) | Backed by |
|---|---|
| Dynamic Shapes | **Native** `ShapeLayer` — never Iconify |
| Graphics | Husnalogy library + Iconify discovery |
| Text | **Native** `TextLayer` (Google Fonts engine) |
| Borders / Lines | **Native** `LineLayer` + decorative SVG assets |
| Shapes | **Native** `ShapeLayer` — the less common kinds |
| Frames | **Native** `FrameLayer` masks |
| QR Code | **Native** `QRCodeLayer`, validated by the shared `isValidQRValue` |
| Recently Used / Favourites | Stable identities, never signed URLs |

Shapes, lines, frames, QR codes and text are deliberately native: they must stay
editable objects, not images. **The consolidation is UI grouping only** — the
document keeps every distinct object type, so designs saved before the change
load and render identically.

`See more` on Graphics, Text, Borders/Lines, Shapes and Frames opens a focused
subview *inside the same panel*, with a Back control — never a route change.
Recently Used and Favourites are short lists and expand in place instead.

### When the tool appears

Elements is shown whenever **any one** of its sections is permitted —
`hasAnyElementsCapability()` in `CustomerToolRail.tsx`. A template that enables
only QR codes still gets Elements; a template that enables none never shows an
empty tool.

## Import flow

```
Iconify search  →  Husnalogy server  →  license gate  →  results
                                                            │
                                    customer selects a result
                                                            ▼
     fetch SVG (server, size-capped, timeout)  →  sanitize  →  tint detect
                     →  measure  →  checksum  →  dedupe  →  Supabase storage
                     →  customizer_assets row  →  normal ElementLayer
```

After that the graphic is an ordinary Husnalogy asset referenced by `assetId`.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/customizer/iconify/search` | Server-mediated search, license-filtered, cached |
| `GET /api/customizer/iconify/preview` | Same-origin sanitized preview of a not-yet-imported icon |
| `POST /api/customizer/iconify/import` | `{ "icon": "mdi:heart" }` → permanent asset |

All three require an authenticated user. The import endpoint is rate limited
far more tightly than search.

## Modules

| File | Responsibility |
|---|---|
| `lib/customizer/v2/iconify.ts` | Pure: identity validation, license policy, search normalization, categories |
| `lib/customizer/v2/server/iconify.ts` | The only module that talks to Iconify: search, collections, SVG fetch, caching |
| `lib/customizer/server/asset-ingest.ts` | Shared trusted pipeline — admin upload **and** Iconify import both use it |
| `lib/customizer/server/element-assets.ts` | Resolves element `assetId`s against `customizer_assets` |
| `app/components/customizer/CustomerElementsPanel.tsx` | The panel |

## Security

- **No API key.** The public Iconify API needs none, and none is defined.
- **No arbitrary proxy.** The client sends a canonical identity (`mdi:heart`);
  the server builds the upstream URL from its validated `[a-z0-9-]` parts. URLs,
  schemes, paths, traversal and markup are all rejected before any fetch.
- **Sanitation.** Every imported SVG goes through the existing sanitizer, and
  the *sanitized* document is what gets stored.
- **Trusted asset resolution.** A saved element layer is authoritative only in
  its `assetId`. Client `src`/`url` are display hints, stripped on save and
  re-derived from the permanent asset on read — so an expired signed URL never
  breaks a design and a forged URL can never affect rendering.
- **Limits.** Query length, page size, SVG byte cap, request timeouts, and
  separate rate limits for search, preview and import.

## License policy

Centralized in `lib/customizer/v2/iconify.ts` and **fails closed**.

| Verdict | Meaning | Customer |
|---|---|---|
| `allowed` | Permissive/public-domain (MIT, Apache-2.0, BSD, ISC, CC0, Unlicense, 0BSD, MIT-0) | Visible |
| `requires-attribution` | Real open license needing visible credit (CC-BY, OFL, GPL, MPL…) | **Hidden** — Husnalogy has no per-design attribution surface yet |
| `blocked` | Recognised but not permitted | **Hidden** |
| `unknown` | Cannot be positively identified | **Hidden** |

Admins receive results labelled with the verdict so the policy is diagnosable.
Widening the policy means editing `ALLOWED_SPDX` — nothing else.

License metadata is captured **at import time** into
`source_license*` columns and never refreshed, so a later upstream change
cannot alter the terms recorded against an asset already used in an order.

## Configuration

```bash
ICONIFY_API_BASE_URL=   # optional, server-only, defaults to https://api.iconify.design
```

No secret. To move to a self-hosted Iconify instance later, point this at
(for example) `https://icons.husnalogy.com` — no customizer changes required.

## Permissions

- `allowCustomerElements = false` → no **Graphics** section, no discovery, no
  import. The Elements tool itself still appears if Shapes, Lines, Frames, QR or
  Text presets are permitted — each section is gated independently.
- `allowedCustomerElementIds` empty → the full permitted library plus online
  discovery (the existing "empty means all" rule).
- `allowedCustomerElementIds` populated → **only** those permanent assets.
  Online discovery is withheld so a new import cannot bypass the allowlist, and
  the server drops any element layer whose asset is not verified regardless.

## Database

`supabase/migrations/20260824180000_customizer_asset_source_provenance.sql`
adds nullable `source_provider`, `source_key`, `source_collection`,
`source_license`, `source_license_url`, `source_license_spdx`, `source_author`,
a **partial unique index** on `(source_provider, source_key)` — which is what
makes concurrent duplicate imports resolve to one winner — and provider and
collection indexes. Local uploads have no provenance and are unaffected.
