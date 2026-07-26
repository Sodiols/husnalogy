# Husnalogy Customizer Modernization and Cleanup Report

Date: 19 July 2026

## Safety and scope

- Branch: `customizer_modernization_cleanup`
- Starting branch: `master`
- Starting commit: `20bcb4569b2342937b2db1c4b5890cd94a4c26e3`
- Starting worktree: clean
- Database writes performed: none
- Storage writes performed: none
- Seed commands performed: none; no local/staging target was confirmed
- Backup/restore procedure: `CUSTOMIZER_DATABASE.md`

The current engine, Supabase/auth/cart/order behavior, feature-flagged staged
features, V1/V2 adapters, immutable publications, and order snapshots were
preserved.

## Inventory and dependency evidence

`npm run audit:customizer` maps static imports, dynamic imports, Next route
entry points, package/config references, API strings, tests, workers, Supabase
functions, migrations, and compatibility SQL. The generated
`CUSTOMIZER_DEPENDENCY_MAP.md` records every decision.

- Files audited: **135**
- Unreferenced executable candidates after manual/framework checks: **0**
- Static or dynamic Customizer import cycles: **0**
- Files deleted: **1** (`supabase/migrations/hero_collections_single_featured.sql`, consolidated into the authoritative rerunnable hero migration)
- Files moved: **0**

No Customizer file was deleted merely because it had no import. Documentation, Next.js
routes, tests, scripts, migrations, and Supabase functions were retained as
required entry points. Existing compatibility adapters remain because there is
no live database evidence proving stored V1/V2 rows no longer require them.

## Dead-code and duplicate-system audit

A strict TypeScript unused-symbol pass found and removed three Customizer-local
dead declarations:

- unused `defaultImageTransform` import in `lib/customizer/v2/document.ts`;
- unused `ZERO_INSETS` constant in that module;
- unused image-toolbar callback parameter in the customer editor.

The same optional strict pass still reports three pre-existing declarations
outside Customizer scope (`account-client.tsx`, `admin-dashboard-client.tsx`,
and `ProductInfo.tsx`). They were not changed during this focused modernization.
The normal repository TypeScript gate is clean.

Responsibilities remain consolidated at these authoritative implementations:

| Concern | Authority |
| --- | --- |
| Fonts | `lib/customizer/v2/fonts.ts` |
| Stable private assets and signed URLs | `lib/customizer/server/private-assets.ts` |
| Flat compatibility normalization | `lib/customizer/index.ts` |
| Typed document migration | `lib/customizer/v2/document.ts` |
| Permissions/save validation | `lib/customizer/v2/validate.ts`, `save-validation.ts` |
| Text layout | `lib/customizer/v2/text-layout.ts` |
| Masks/grids/groups | `masks.ts`, `grids.ts`, `groups.ts` |
| Layer arrangement | `lib/customizer/v2/customer-actions.ts` |
| Feature flags | `lib/customizer/v2/feature-flags.server.ts` |
| Mockups | `lib/customizer/mockup-store.ts` and normalized mockup tables |
| Rendering/jobs | `lib/customizer/v2/server/`, `lib/customizer/render-jobs.ts` |
| Preflight/pricing/order history | `preflight.ts`, `pricing.ts`, `order-snapshots.ts` |

`product_customizer_templates` remains the mutable compatibility draft;
`customizer_template_versions` remains immutable publication history; mockup
template status/version remains a separate presentation concern. No duplicate
alias table or service was introduced, and historical migrations were not
rewritten.

## Dependency audit

Every declared runtime/development package has a code, script, test, or build
reference. Therefore:

- Packages removed: **0**
- Packages added: **0**
- Reclassified: `@types/qrcode` moved from runtime dependencies to
  `devDependencies`
- `npm install` audit: **0 vulnerabilities**

## Database consolidation

- `supabase/customizer_v2.sql` is generated from the core Customizer draft
  definitions plus five chronological additive migrations.
- `20260719120000_customizer_v2_schema_consolidation.sql` adds missing update
  timestamp parity, update triggers, targeted indexes, table comments, and
  least-privilege grants without dropping data.
- The canonical surface covers 17 Customizer tables, indexes, constraints,
  functions, RLS/policies, and the four required Storage bucket/policy models.
- `lib/supabase/database.types.ts` is generated from that canonical SQL.
- `npm run validate:customizer:database` validates the checked-in contract and
  optionally runs the read-only live validator through `psql`.

The canonical file is the complete Customizer install surface **after the core
Husnalogy commerce prerequisites in `supabase/schema.sql`**. Existing databases
must use chronological migrations, not replay the canonical install file.

No new migration weakens RLS. No new Storage policy broadens customer access.
The live database and Storage-object consistency checks remain unclaimed until
a confirmed connection is supplied.

## Design and interaction changes

- Customer header now exposes page context and Help/shortcut access.
- Customer Layers now supports search, result count, nested matching, guarded
  drag ordering, larger controls, clearer ownership/lock state, grid slots,
  rename, visibility, duplication, deletion, and the four arrange actions.
- Drag ordering cannot cross administrator-protected layers and has unit tests.
- Bottom controls now provide actual size, percentage, zoom, Fit, page
  navigation, and a large-screen canvas view switch.
- Admin command bar wraps into an accessible second row when horizontal room is
  limited; studio surfaces use the Husnalogy brand system and scoped dropdown,
  input, scrollbar, focus, and reduced-motion behavior.
- Arrange, image-filter, and group-behavior properties use collapsible advanced
  sections.
- The previously prohibited site colour is absent from application source; the
  workspace uses warm paper `#F8F6F1` instead.

## Final local validation

| Gate | Result |
| --- | --- |
| `npm run generate:customizer:schema` | Passed; 5 migrations assembled |
| `npm run generate:customizer:types` | Passed; 17 tables generated |
| `npm run validate:fonts` | Passed; 10 local fonts |
| `npm run validate:customizer:database` | Static passed; live check skipped because no confirmed URL |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with 0 errors and 63 pre-existing warnings; no warning increase |
| `npm test` | Passed; 16 files, 95 tests |
| `npm run test:e2e:public` | Passed; 1 Chromium responsive/local-font smoke |
| `npm run test:e2e` | Blocked at fixture guard; seeded admin/customer URLs and credentials absent |
| `npm run build` | Passed; Next.js 16.2.7, 48 static pages generated |
| `git diff --check` | Passed |

The initial stale `.next/dev` type cache was isolated and the two missing native
render packages were restored from the lockfile before the clean successful
build. No generated cache is part of the source diff.

## Release status and remaining limitations

The local implementation and public smoke are complete, but this report does
**not** label the release production-ready. Required external acceptance work:

1. Restore the backup to an isolated database and run the live validator.
2. Apply the additive migration to a confirmed staging project.
3. Confirm Storage manifests/objects and policies.
4. Run the seed script against that dedicated staging project.
5. Pass the full customer desktop/mobile, admin, ownership, restore, cart,
   PNG, PDF, mockup, render-worker, and immutable-order Playwright journeys.
6. Roll out feature flags to selected products and observe before production.

Deployment and rollback commands are recorded in `CUSTOMIZER_DEPLOYMENT.md`
and `CUSTOMIZER_ROLLBACK.md`.
