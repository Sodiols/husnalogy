# Husnalogy Customizer V2 Production-Hardening Validation

Date: 14 July 2026  
Workspace: `D:\husnalogy-master\husnalogy-master`

## Implemented in this pass

- Ten local Cormorant Garamond/Inter TTF files are registry-driven and parsed
  before every production build. No Google Fonts dependency is used.
- Customer photos persist as versioned permanent references. A central server
  resolver verifies the asset-library row and owner before signing original,
  editor, or thumbnail variants. Save/cart/order hashes exclude URL tokens.
- Cart, checkout, review, account order details, and order history use protected
  server mockups and store only permanent output references.
- Real four-corner perspective is implemented with inverse homography,
  bilinear RGBA sampling, clip-before-warp, convex/self-intersection validation,
  deterministic ordering, alpha preservation, and canvas-boundary cropping.
- Admin mockup authoring supports multiple views/areas, independent page maps,
  draggable corners, visibility/locking/order, overlays, WebP/PNG output choice,
  normalized import, draft save, and publish.
- Published normalized mockup rows are authoritative; legacy template JSON is
  retained as a rolling-deploy read fallback.
- Feature flags resolve from database rows with product > product type > global
  priority plus environment, percentage, and admin-only gates. Template JSON is
  compatibility metadata, not the production authority.
- Render jobs have atomic DB claims, worker/lock tokens, leases, heartbeats,
  abandoned-job recovery, retry backoff, cancellation, read-back checksum
  verification, deterministic input hashes, and complete output metadata.
- Order snapshot identity/design fields are protected by an immutability trigger;
  only preview/print lifecycle fields may advance.
- The staging seed creates two customers, an admin, a private asset, versioned
  grid template, published perspective mockup, flags, and a customization.
  It refuses production and unconfirmed remote projects.
- Seeded Playwright suites contain no `test.skip`; absent staging fixtures fail
  setup instead of being reported as acceptance success.

## Local validation evidence

| Gate | Result |
| --- | --- |
| `npm run validate:fonts` | Passed: 10 local TTF files parsed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with 0 errors and 61 warnings |
| `npm test` | Passed: 13 files, 79 tests |
| Perspective tests | Passed: identity/flat composition, skew/trapezoid, invalid quad, alpha/crop boundaries |
| `npm run test:e2e:public` | Passed: 1 Chromium responsive/offline-font smoke |
| `npm run build` | Passed: Next.js 16.2.7, 48 generated pages |
| Seed safety | Passed: refused because no explicit local/staging target was supplied |
| Full `npm run test:e2e` | Not accepted: failed setup because the confirmed staging seed/credentials are absent |

## Required staging acceptance

This workspace is not declared production-accepted yet. The live database was
not mutated because its role (staging versus production) could not be proven.

1. Apply `20260714210000_customizer_v2_production_hardening.sql` after the two
   earlier Customizer V2 migrations in a dedicated staging project.
2. Set `CUSTOMIZER_SEED_TARGET=staging`,
   `CUSTOMIZER_SEED_CONFIRM_PROJECT_REF=<verified staging ref>`, and a 12+
   character `CUSTOMIZER_SEED_PASSWORD`; run `npm run seed:customizer:test`.
3. Run `npm run test:e2e`. All customer/mobile/admin/cross-account/private-asset/
   perspective/caching/render journeys must pass with zero skips.
4. Exercise the scheduled worker and deliberately abandon/cancel jobs to verify
   database lease recovery and output cleanup under the deployment runtime.

No claim is made that the migration, seed, RLS matrix, render worker, or complete
Playwright acceptance has passed against staging in this local-only run.
