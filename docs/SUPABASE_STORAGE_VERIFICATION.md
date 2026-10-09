# Supabase Storage verification

Date: **2026-10-09**. Buckets, who may do what, what was verified (and on
which engine), and the production inventory. Storage RLS was tested on real
PostgreSQL 17 with Supabase's default grants (`storage.objects` policies are
exactly what Supabase Storage evaluates for user requests). The hosted Storage
API itself (signed URL expiry, size/MIME enforcement at upload, image
transforms) needs a staging project — **BLOCKED**.

## Bucket inventory (migrations = production, verified by `npm run probe:schema`)

| Bucket | Public | Size limit | Allowed types | Purpose | Written by | Read by | Backup |
|---|---|---|---|---|---|---|---|
| `customer-uploads` | no | 25 MB | jpeg, png, webp, gif, pdf | customer photos: original, editor-quality and thumbnail variants (`<user id>/…`) | server only (`/api/customizer/upload`, re-encodes) | owner, admin, assigned designer; signed URLs | **critical** |
| `customer-avatars` | no | 2 MB | webp | profile photos | server only (`/api/account/avatar`) | server-signed only | yes |
| `customizer-elements` | no | 25 MB | svg, jpeg, png, webp | permanent admin asset library (originals + variants) | admins | admins; customers via server-signed URLs | **critical** |
| `admin-assets` | no | 15 MB | jpeg, png, webp, gif, avif, pdf | admin media | admins | admins | yes |
| `order-production` | no | 30 MB | png, jpeg, webp, svg, ttf, text, pdf | files PINNED by order snapshots (checksummed; deletion blocked while referenced) | server / worker | server (admin-authorized endpoint) | **critical** |
| `customizer-renders` | no | 100 MB | png, webp, pdf, svg | previews and final print renders | worker | server-signed | **critical** for orders |
| `product-images`, `product-mockups` | **yes** | 15 MB | images | catalogue | admins | everyone | yes |
| `product-videos` | **yes** | 30 MB | mp4, webm, mov, avi | catalogue | admins | everyone | yes |
| `site-assets` | **yes** | 5 MB | images, ico | site branding | admins | everyone | yes |

## Policy matrix (tested: `supabase-grants-fidelity.test.ts`, 4 Storage tests, PASS)

| Bucket group | Anonymous | Customer A (owner) | Customer B | Designer | Admin |
|---|---|---|---|---|---|
| Public media | R ✓, W ✗ | R ✓, W ✗ | R ✓, W ✗ | R ✓, W ✗ | R ✓, W ✓ |
| `admin-assets`, `customizer-elements` | ✗ | ✗ | ✗ | ✗ (through server) | R/W ✓ |
| `customer-avatars`, `customizer-renders`, `order-production` | ✗ | ✗ | ✗ | ✗ | ✗ (server / service role only) |
| `customer-uploads` (A's folder) | ✗ | R ✓; upload ✗ (server only); overwrite ✗; delete ✓ own | ✗ R / W / delete | ✗ unless assigned to that upload | R ✓ |

W = insert, update and delete each tried separately. Tampered paths (writing
into another customer's folder) and cross-customer reads are covered by the
same rows. A private file restored from backup keeps its protection: policies
key on the path, not on the uploader (`backup-restore-drill.test.ts`, PASS).

## Other Storage behaviour and where it is covered

| Behaviour | Verified by | Status |
|---|---|---|
| Upload content verification, re-encoding, size and type limits (customer + admin) | `sharp-upload-pipeline.test.ts`, upload route tests, admin media limit tests | PASS (unit) |
| Editor images stay full quality; a thumbnail never replaces the editor image | customizer asset reliability unit tests; `e2e/admin-uploads-thumbnails.spec.ts`, `e2e/admin-asset-reliability.spec.ts` | PASS (unit + stub browser) |
| Signed URL refresh after expiry | `e2e/customizer-asset-reliability.spec.ts`, `lib/customizer/v2/__tests__/asset-reliability.test.ts` | PASS (stub); hosted expiry **NOT RUN** |
| Crop / mask survive save + reload | `e2e/customizer-crop-matrix.spec.ts`, `admin-clipping-mask.spec.ts`, `customizer-clipping-mask.spec.ts` | PASS (stub browser) |
| Pinned production files cannot be deleted | `lib/customizer/__tests__/snapshot-production.test.ts` (`COMMITTED_PRODUCTION_ASSET_IMMUTABLE`) | PASS (local) |
| Signed URLs, bucket limits, unauthorized download on the real Storage API | `npm run test:staging` | **NOT RUN — BLOCKED** |

## Production inventory (read-only, 2026-10-09, `npm run backup:storage -- --source-env .env.local --inventory-only`)

No file was downloaded; only metadata was listed.

| Bucket | Objects | Bytes |
|---|---|---|
| customer-uploads | 3 | 14,074 |
| customizer-elements | 42 | 15,781,992 |
| order-production | 16 | 7,158,483 |
| product-images | 5 | 8,067,067 |
| product-mockups | 9 | 13,358,133 |
| admin-assets, customer-avatars, customizer-renders, product-videos, site-assets | 0 | 0 |
| **Total** | **75** | **44,379,749 (≈ 44 MB)** |

All ten buckets have the public/private setting, size limit and type list the
migrations define.

### Database ↔ Storage reconciliation (read-only, `npm run backup:reconcile`)

361 references across designs, templates, snapshots, asset libraries and the
catalogue → 64 distinct objects: **0 missing, 0 missing production files,
0 checksum problems**. 11 objects are unreferenced (4 belong to a checkout
preparation that never became an order — the worker that would clean them has
never run, see audit F2; 7 are older logo/collection images in public
buckets). Nothing was deleted; the detailed list stays outside the repository.
