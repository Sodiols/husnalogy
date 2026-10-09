# Test results — local verification

**Environment:** Windows 11, Node 22.23.3 (`npx -y node@22`), PostgreSQL 17.10
client tools, embedded PostgreSQL 17 / PGlite, Playwright 1.61 in the
isolated **stub mode** (the app and browser are pointed at a dead local
Supabase address and answered by local stand-ins — no real project is ever
reached). **No hosted staging project exists**, so nothing below is
"verified in staging".

## 2026-10-10 — backup hardening, security migration, worker (latest)

No application code changed in this pass (backup tooling, ops scripts,
tests, docs, workflow only).

| Layer | Command | Result |
|---|---|---|
| TypeScript | `tsc --noEmit` | **PASS** (0 errors) |
| Lint | `eslint .` | **PASS** (0 errors; 60 pre-existing warnings, none in new files) |
| Unit + integration, incl. real PostgreSQL 17 | `vitest run` with `HUSNALOGY_PG_BIN` | **PASS** — 196 files / **2,887 tests**; 1 file / 13 tests skipped (`supabase-staging.test.ts`: no staging project) |
| Backup security (identity, metadata encryption, formats, retention, destination, monitoring) | `backup-hardening.test.ts`, `backup-tooling.test.ts` | **PASS** 17 + 12 |
| Backup → off-site → restore drill | `backup-restore-drill.test.ts` | **PASS** 11/11 |
| Security migration 20261007150000 | `public-surface-migration.test.ts` | **PASS** 6/6 |
| RLS / Storage policies under Supabase grants | `supabase-grants-fidelity.test.ts` | **PASS** 8/8 |
| Worker (first run, overlap, isolation, auth) | `worker-first-run`, `worker-endpoint-overlap`, `worker-isolation`, `worker-endpoint-auth`, `production-worker` | **PASS** |
| Playwright, targeted Customizer/privacy/recovery/render regression (17 spec files) | `playwright test --project=chromium --workers=1 …` | **PASS 91/91** (16.7 min) |
| Production build | fonts + types + `next build --webpack` (copy, `NEXT_PUBLIC_SITE_URL=https://husnalogy.com`) | **PASS**; no secret value in `.next/static`, no source maps |
| Hosted staging (`test:staging`, seeded Playwright) | — | **NOT RUN — BLOCKED** (no staging project) |

The full 420-test Chromium run of 2026-10-09 (below) was not repeated: no
application code changed since it passed.

## Summary (2026-10-09)

| Layer | Command | Result |
|---|---|---|
| TypeScript | `tsc --noEmit` | **PASS** (0 errors) |
| Lint | `eslint .` | **PASS** (0 errors; 60 warnings, all pre-existing, none in new files) |
| Unit + integration (incl. PGlite and real PostgreSQL 17) | `vitest run` with `HUSNALOGY_PG_BIN` | **PASS** — 192 files / **2,852 tests** passed; 1 file / 13 tests skipped (`supabase-staging.test.ts`: no `.env.staging`) |
| RLS / security posture under Supabase grants | `supabase-grants-fidelity.test.ts` | **PASS** 8/8 |
| Backup → isolated restore drill | `backup-restore-drill.test.ts` | **PASS** 6/6 |
| Backup tooling | `backup-tooling.test.ts` | **PASS** 12/12 |
| Playwright, Chromium, 63 runnable spec files | `playwright test --project=chromium --workers=1 <63 files>` | 417 passed, 2 failed, 1 skipped (1.1 h) → failures diagnosed and fixed, re-run **12/12 PASS** (below) |
| Playwright, WebKit + mobile Safari (`webkit-critical`) | `--project=webkit --project=mobile-safari` | 9/10 after fix; the 10th (desktop WebKit `/checkout`) timed out on first-run route compilation and passed 2/2 when re-run |
| Production build | `validate:fonts` + `repair:next-types` + `next build --webpack` (from a copy; `NEXT_PUBLIC_SITE_URL=https://husnalogy.com`) | **PASS**; no secret value found in `.next/static`, no source maps |
| Real Supabase staging (`npm run test:staging`) | — | **NOT RUN — BLOCKED** (no staging project) |
| Seeded staging Playwright (10 spec files: checkout, multi-tab journey, storefront, admin security/render, Google fonts, Iconify, unified elements, staging privacy) | `npm run test:e2e:staging` | **NOT RUN — BLOCKED** (they need a seeded staging project) |

## Failures found and fixed

| Test | What failed | Root cause | Fix | Retest |
|---|---|---|---|---|
| `customizer-performance.spec.ts` (20 / 100 layers; 7 of 12 on a quiet re-run) | "the workspace re-rendered during a drag" (4 renders) | Not the drag: timestamped instrumentation showed two render pairs ~0.5–0.9 s **after the selection click**, in every run, independent of the pointer. The test paused a fixed 400 ms after selecting, so they sometimes landed inside the drag window. When they landed before it, drags rendered the workspace 0 times. | Wait until the workspace has been quiet for 700 ms before measuring the drag (`waitForWorkspaceIdle`); the strict "0 renders during a drag, 1 commit" assertions are unchanged. | 12/12 PASS (3 × 4 sizes): every drag 0 workspace renders, 1 commit |
| `webkit-critical.spec.ts` "customizer text field accepts input" (WebKit + mobile Safari) | typed value replaced by the template default | The editor shows "Loading your design…" over the fields until the saved design is restored (by design: an edit made before would be replaced). Playwright's `fill` does not check overlays, so the test typed before a customer could. | Wait for `[data-customizer-restore-overlay]` to disappear first, as a customer must. | PASS on WebKit, mobile Safari and Chromium |

No application code defect was found; both fixes are to test timing assumptions.

## What the passing suites cover

* **Admin Customizer** (152 browser tests in the `admin-*` specs, `/__e2e/admin-dashboard`
  fixture): canvas interaction, contextual toolbar, crop + crop button,
  clipping masks, context menu, layers/pages, multi-drag, orientation, page
  backgrounds, panels/toolbar at desktop sizes, history matrix (undo/redo),
  recovery matrix and studio recovery (autosave, reload, account isolation),
  studio exit guard, save/publish, text growth, uploads/thumbnails, asset
  reliability, wheel scroll, selection matrix/groups.
* **Customer Customizer** (195 tests in the `customizer-*` specs plus the shared text, shape, SVG, font and render-parity specs; `/__e2e/customizer`): interaction
  contract, selection matrix, gesture cancellation, text drag/editing/growth,
  resize, crop matrix, clipping masks, context menu, autosave + recovery,
  card sizes, responsive layout, asset reliability, version pinning,
  performance at 20–200 layers, render parity (admin preview = customer
  preview = server render geometry), safe areas, SVG recolour, shape paint.
* **Account isolation / privacy (stub):** `customer-recovery-isolation`,
  `shared-browser-privacy`, `admin-studio-recovery` (Admin A's draft never
  offered to Designer B).
* **Public site:** SEO metadata, public build smoke, production security
  smoke, image optimizer (the catalogue-image check skips locally by design),
  product option persistence.
* **Unit/integration (vitest):** checkout transaction, server pricing,
  idempotency and cart claims (PGlite + real PostgreSQL concurrency), order
  snapshots and snapshot-owned production rendering, render limits, worker
  isolation and leases, auth redirects and role capabilities, upload
  pipeline, RLS matrices, migrations on a fresh database, backup/restore.

## Not verified here (needs hosted services)

Real Supabase Auth (signup e-mail, verification, password-reset e-mail,
Google OAuth, session refresh against GoTrue), PostgREST/Storage behaviour
(signed URL expiry, bucket limits enforced by the Storage API), real
multi-tab checkout through PostgREST, staging render worker + cron, Resend
e-mail delivery. Their tests exist (`test:staging`, the 10 seeded specs) and
are ready to run once `.env.staging` points at a staging project.
