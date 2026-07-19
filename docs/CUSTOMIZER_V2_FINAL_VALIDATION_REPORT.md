# Husnalogy Customizer V2 Customer-Parity Validation

Date: 18 July 2026
Workspace: `D:\husnalogy-master\husnalogy-master`

## Outcome

The customer-parity implementation is complete in the repository and all
available local gates pass. Production acceptance is still conditional because
the authenticated seeded Playwright suite cannot run without the dedicated
local/staging manifest and credentials. No live database was seeded or mutated.

## Files created

- `app/components/customizer/CustomerInsertPanel.tsx`
- `app/components/customizer/CustomerLayersPanel.tsx`
- `app/components/customizer/CustomerObjectToolbar.tsx`
- `app/components/customizer/CustomerProductEditingPreview.tsx`
- `app/components/customizer/CustomerShortcutHelp.tsx`
- `lib/customizer/audit.ts`
- `lib/customizer/v2/customer-actions.ts`
- `lib/customizer/v2/image-filters.ts`
- `lib/customizer/v2/preview-mapping.ts`
- `lib/customizer/v2/qr.ts`
- `lib/customizer/v2/__tests__/parity.test.ts`
- `supabase/migrations/20260718120000_customizer_v2_customer_parity.sql`

## Files modified

- Admin studio: `AdminCustomerPreview.tsx`, `AdminDesignBuilder.tsx`,
  `AdminPropertiesPanel.tsx`, `AdminTemplateSettings.tsx`, `AdminToolRail.tsx`,
  and `builder-utils.ts` under `app/admin/dashboard/design-builder/`.
- Customer editor: `personalize-client.tsx`, `CustomerContextToolbar.tsx`,
  `CustomerCustomizerHeader.tsx`, `CustomerElementsPanel.tsx`,
  `CustomerImageToolbar.tsx`, `CustomerToolRail.tsx`,
  `CustomerUploadsPanel.tsx`, `CustomizerPreview.tsx`,
  `CustomizerWorkspace.tsx`, and `customizer-utils.ts`.
- APIs and security: both customization routes and the customizer render route.
- Shared engine: `lib/customizer/index.ts`, `save-validation.ts`, and V2
  document, flags, grids, preflight, SVG, types, validation, and related tests.
- Release assets: `package.json`, `package-lock.json`,
  `scripts/seed-customizer-test.mjs`, both Customizer documents, and the
  customer/admin Playwright suites.

An unrelated pre-existing edit in `app/components/data.ts` was preserved and
is not part of this implementation.

## Packages and schema

- Added `qrcode@1.5.4` and `@types/qrcode@1.5.6` for deterministic local QR
  matrices. Added a PostCSS override to a patched supported version; npm audit
  reports zero vulnerabilities.
- Schema version advanced from 3 to 4; migrations from versions 1, 2, and 3
  remain supported.
- The additive parity migration sets schema defaults, adds feature flags,
  strengthens render-data constraints/indexes, and creates append-only audit
  storage with RLS/grants. It does not delete historical templates,
  customizations, carts, orders, snapshots, or render outputs.

## Implemented capability summary

- Customer Layers: nested groups/grids, ownership/lock/visibility state,
  rename, arrange, duplicate, delete, and slot selection.
- Selection: click, modifier multiselect, marquee, select-all, multi-object
  move/resize/rotate, group entry, large handles, keyboard shortcuts, and
  touch/pinch gestures.
- Arrange/group: protected admin-layer boundaries, front/back/forward/backward,
  align/distribute, persistent nested groups, ungroup, deep duplication, and
  undo/redo integration.
- Customer content: text, elements, shapes, lines with endpoints, frames,
  exact-count and editorial grids, page backgrounds, and locally generated QR
  codes. Elements support search/category/pagination, click or drag insertion,
  recents, and favourites.
- Text/appearance: font family, size, weight, colour, letter spacing, line
  height, horizontal/vertical alignment, italic, opacity, borders/fills, and
  responsive dropdown/toolbars. The site uses `#F8F6F1` for its soft background.
- Images: replace/crop/pan/zoom/rotate/flip, per-slot grid editing, structured
  brightness/contrast/saturation/grayscale/sepia/tint filters, and browser/server
  SVG parity.
- Product editing: Print Canvas, flat/rotated rectangular Product Preview, and
  synchronized Split View. Perspective/cylinder/custom surfaces remain
  intentionally preview-only.
- Admin: product Images & Mockups entry point, Husnalogy brand styling,
  responsive studio/dropdowns, capability flags, one Customer editable switch,
  independent position/interaction locks, and optional font/colour/shape/
  element/frame/grid/filter/page allowlists plus count/geometry limits.
- Security: trusted-template reload, database flag resolution, typed hard
  rejects, storage ownership checks, admin-only print routes, QR scheme checks,
  private outputs, audit logging, and server preflight before cart/order.
- Rendering: shared native QR modules, filters, text layout, line endpoints,
  grid slots, locks/visibility, PNG/PDF/mockup generation, and immutable order
  snapshots.

## Validation evidence

| Gate | Result |
| --- | --- |
| `npm install` / dependency audit | Passed; 0 vulnerabilities |
| `npm run validate:fonts` | Passed; 10 local font files |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed; 0 errors, 63 repository warnings |
| `npm test` | Passed; 14 files, 91 tests |
| `npm run build` | Passed; Next.js 16.2.7, 48 pages |
| `npm run test:e2e:public` | Passed; 1 Chromium responsive/offline-font smoke |
| Guarded staging seed | Passed safety behavior: refused without `CUSTOMIZER_SEED_TARGET` |
| Full `npm run test:e2e` | Blocked before execution by missing seeded admin/customer URLs and credentials |

Unit coverage includes migrations, permission rejection, document restore,
selection/marquee, arrange/group, exact grid geometry, filters, native QR,
preflight, browser/server SVG, real PNG/PDF generation, and mockup paths.
Playwright coverage was expanded for customer desktop/mobile tools, grouping,
QR/grid flows, keyboard help, admin print PNG/PDF, and customer print denial,
but those authenticated scenarios require the staging fixture to execute.

## Backward compatibility

- Legacy V1/V2/V3 documents migrate in memory to V4 without deleting or
  rewriting source rows.
- Existing template layers, values, editor state, customizations, carts,
  orders, and snapshots retain their read/restore path.
- Feature rollback is non-destructive: disable the affected product/global
  flag; saved V4 objects remain readable.
- The production build and migration/restore tests pass locally. Live legacy
  cart/order regression remains part of the blocked seeded Playwright gate.

## Remaining acceptance work

1. Use a dedicated local/staging Supabase project, apply all four additive V2
   migrations, and verify its project reference.
2. Set `CUSTOMIZER_SEED_TARGET=local|staging`,
   `CUSTOMIZER_SEED_CONFIRM_PROJECT_REF`, and a strong seed password; run
   `npm run seed:customizer:test` to generate `.customizer-e2e.json`.
3. Run `npm run test:e2e` with zero failures/skips, including cart, order
   snapshot, PNG, PDF, mockup, cross-account, and mobile journeys.
4. Exercise the deployed render worker's retry/lease/cancellation behavior.

Until those staging checks pass, this report does not claim full production
acceptance or exact parity. It confirms repository implementation and all
available local validation only.
