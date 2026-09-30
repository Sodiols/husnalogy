# Husnalogy snapshot production remediation report

Workspace: `D:\HUSNALOGY\Main`. Audit date: 2026-09-30.
This report describes implemented source changes and independently executed
local evidence. It does not certify a deployed Supabase/Hostinger environment.
Existing user changes to `.env.example` and the 20260930 migration were retained;
this work creates a new forward migration instead of modifying deployed SQL.

## 1. Problems

Severity rates the original risk. Files below are repository-relative.

| # | Problem / severity | Affected files | Traced root cause and impact |
|---|---|---|---|
| 1 | Live customization dependency — Critical | `lib/customizer/order-snapshots.ts`, `render-jobs.ts` | Dispatch and rendering reopened live designs/versions after acceptance; deletion could prevent fulfillment. |
| 2 | Incomplete production snapshot — Critical | `snapshot-compose.ts`, `order-snapshots.ts` | Resolved document was stored, but jobs reconstructed renderer input and flags from current state. |
| 3 | Temporary customer uploads — Critical | `server/private-assets.ts`, `render-jobs.ts` | Signed source references did not guarantee durable bytes after customer/source cleanup. |
| 4 | Product deletion — High | permanent-delete API, template/version FKs | Cascading product/template changes could erase required design dependencies. |
| 5 | Template changes/removal — High | `versions.ts`, `render-jobs.ts` | Historical production resolved a live published version rather than complete order-owned input. |
| 6 | Live admin retry — High | `app/api/admin/customizer/render/retry/route.ts` | Recovery required the old customization instead of the accepted order snapshot. |
| 7 | Disabled-rendering contradictions — High | `order-snapshots.ts`, production task functions | A dispatch could complete with no jobs and an ambiguously pending snapshot. |
| 8 | Incomplete health/reconciliation — High | production health API, outbox SQL | Queue counters did not verify every finalized item→snapshot→task→job→page/output link. |
| 9 | Permanent-failure recovery — High | retry API, outbox/render functions | Bounded failures lacked a complete audited recovery path; abandoned leases did not consume attempts. |
| 10 | Inconsistent admin mutation controls — High | full `app/api/admin` mutation tree | Method/body/origin/auth controls were repeated separately and could be omitted. |
| 11 | Missing reproduction evidence — High | database/render regression suites | Existing checkout/outbox tests did not actually remove live entities and render retained input. |
| 12 | Account cascade destroys production — Critical | render job/output customization FKs | `ON DELETE CASCADE` could remove required job/output history when account-owned designs disappeared. |
| 13 | Durable asset isolation — High | storage policies, production access APIs | A new namespace needed explicit private access and cleanup protection, rather than public object links. |
| 14 | Unversioned historical interpretation — High | snapshot contract / renderer | A format change could silently reinterpret old data with new assumptions. |
| 15 | Nondeterministic reproduction — High | flags/assets/fonts/render/PDF code | Current flags, external files and generated PDF timestamps could change historical output. |
| 16 | Font substitution/drift — High | `server-fonts.ts`, `google-font-files.ts` | Dynamic downloads and cached parse failure could substitute measurements; font identities/bytes were not pinned. |
| 17 | Duplicate/uncertain production results — High | render worker/output storage/commit | Output acknowledgement and snapshot progress were separate; cleanup after a lost successful response could remove a winner. |
| 18 | Duplicate notification delivery — High | notification runner/provider/outbox | A provider key alone had a finite deduplication window; successful delivery and task acknowledgement were not independently durable. |
| 19 | Operational worker proof — High | process/health APIs, `HOSTINGER_DEPLOYMENT.md` | Queue health omitted chain failures/outcomes; hangs and host/cron assumptions lacked complete operational verification. |
| 20 | Unsafe migration/backfill — High | migrations, live validator | New ownership/schema constraints needed a forward transition preserving history and explicitly separating unreproducible legacy records. |

## 2. Fixes

1. **Snapshot-only dispatch/render.** `enqueueRenderJobFromSnapshot` and the
   snapshot branch of `processRenderJob` validate snapshot/order/item/hash and
   never query a live customization, product, template or customer. Legacy
   order jobs without linkage fail explicitly. Live draft rendering refuses
   ordered/customization order IDs; it cannot serve as an alternative order path.
2. **Complete immutable input.** `production-input.ts` freezes the exact renderer
   template, values/editor state, dimensions/pages, flags/output requirements,
   font metadata and asset manifest. Existing immutable snapshots/order items
   preserve quantity/options/pricing. Form personalization receives a manual
  instruction snapshot too; it is not excluded merely for lacking a customizer ID.
   Manual instructions retain the trusted product specification, selected options,
   quantity, customer values, pinned reference images and durable customer PDFs.
3. **Durable originals.** `pinProductionInput` copies validated originals into a
   private, order-scoped, content-addressed namespace before acceptance. SHA and
   size are verified at write/read. Finalization checks physical object metadata.
   Rendering never re-signs customer uploads or resolves current library assets.
   Pinning rewrites image sources only, preserving equal customer text/labels/IDs.
4. **Safe product deletion.** New v1 inputs have no required product dependency.
   The database blocks deleting products required by unfulfilled legacy designs;
   source diagnostic relationships may become null for independently pinned v1.
5. **Frozen templates.** V1 stores renderer-ready content; modifications, archive
   or version deletion cannot change it. Old published design mutation remains
   prohibited; diagnostic parent erasure is allowed when no legacy dependency exists.
6. **Snapshot retries.** Admin retry accepts snapshot/job/task identity, retains
   the exact input and resets the same logical rows. No live design lookup occurs.
7. **Explicit manual production.** Snapshot mode/status distinguish automatic
   work from `manual_required` / `manual_complete`. Manual completion requires
   staff evidence; dispatch completion verifies required jobs or manual handoff.
8. **Whole-chain reconciliation.** Missing tasks/jobs and expected PNG pages/PDF
   are detected. Repair is idempotent; invalid stored bytes are audited and the
   same logical job is requeued. Form-personalized missing snapshots are flagged.
   Ready-output hashes are checked in a bounded rotating pass.
9. **Audited recovery.** Admin mutation endpoints and service-only RPCs record
   actor, reason, prior error/status/count and timestamp. Active leases, duplicate
   completed work, unknown formats and unsafe notification retries are refused.
   Expired jobs consume an attempt, so timeout/crash loops reach bounded failure.
10. **Shared guard.** All exported admin mutations use `withAdminMutation` and
    keep existing finer role/ownership checks and proxy rate limiting. Streaming
    body bounds also apply without Content-Length. Controlled errors fail closed.
    Exact logout and designer/worker exceptions are documented in the runbook.
11. **Actual regression pipeline.** Tests execute the real checkout SQL, actual
    dispatch, Resvg/PDF renderer and commit RPC, then compare bytes after deletion
    of source entities. The injected production client rejects mutable table reads.
12. **Account independence.** Customization FKs now set null instead of cascading
    production jobs/outputs. Finalized order/item/snapshot deletion is protected;
    operational bytes/audits retain order ownership rather than customer ownership.
13. **Private access.** Production assets have admin-read RLS, no customer storage
    policy, service-only mutation and short-lived admin-signed originals/outputs.
    Committed storage metadata cannot be erased/overwritten by cleanup. Staff
    download signing omits invalid/missing/checksum-mismatched references.
14. **Versioned readers.** Schema 1 and `husnalogy-snapshot-1` are explicit. Canonical
    hashing tolerates JSONB key ordering. Schema 0/unknown renderer/schema produces
    a controlled remediation error; it does not silently invoke current templates.
15. **Deterministic inputs/output.** Layout dependencies are frozen, system fonts
    disabled, image/font SHA verified, and PDF dates fixed. PNG/PDF repeat hashes
    are covered. New platforms/renderer upgrades still require reference validation.
16. **Exact fonts.** Exact bytes, family/variant/provider/version and licensed
    notices are pinned. Missing/corrupt/changed files fail loudly. Cache publication
    is atomic; no live catalogue/fallback font repairs a finalized manufacturing job.
17. **Atomic output lifecycle.** Snapshot/job locks fence lease tokens. Required
    output records, acknowledgement and aggregate progress commit together. Attempt
    paths isolate stale workers. Lost responses preserve committed outputs. Failure
    transitions are atomic too; PNG and PDF results cannot overwrite one another.
18. **Durable delivery.** Payload/sender and first timestamp freeze under a lease;
    successful provider ID commits before ordinary acknowledgement. Retries retain
    task/generation/key/body. After 23h uncertainty requires verified provider review.
    Audited verified non-delivery permits a new key/payload generation for correction.
19. **Worker operations.** Authenticated header-secret cron, single-process busy
    exclusion, cross-process DB leases, network/job deadlines, reserved job budget,
    last-success/failure timestamps and explicit chain health are implemented.
    The updated runbook distinguishes code settings from unverified host behavior.
20. **Forward transition.** New transaction-only migration retains existing rows,
    does not invent assets, marks incomplete legacy production and protects its
    remaining sources. Staged coordinated migration/app rollout is mandatory;
    the old live renderer is not a safe rollback after strict v1 finalization.
    Existing-object recovery is now replay-safe: named constraints/triggers/policies
    are recreated, tables/indexes retained and functions replaced. The original
    queue-health function is renamed only once. Legacy rows already marked for
    remediation are not updated again, and the PDF asset-kind check is refreshed.

The source-disappearance guarantee follows from steps 1–5, 12 and 16: the
finalized renderer reads only versioned order snapshots and checksum-bound
private order bytes. Original customization/account/catalogue/template data is
optional historical metadata, not a manufacturing dependency.

## 3. Final production data model

| Record | Identity and ownership | Meaning |
|---|---|---|
| Order/item | immutable finalized order and exact item | Trusted commercial/fulfillment facts, cart claim and stable line identity. |
| Design snapshot | one exact order item; schema 1 | Immutable approved input/hash; mutable output/progress fields only. |
| Order asset | snapshot + SHA; private order path | Actual image/font/license/manual-PDF bytes with size/MIME/checksum; source-independent. |
| Production task | snapshot + task type | Leased durable dispatch; completed means automatic jobs exist or explicit manual handoff. |
| Render job | snapshot + required job type | Stable logical job with lease/attempt count and immutable lineage/hash. |
| Output | snapshot + job + page + format | Verified actual stored bytes, attempt path and checksum; PNG/PDF groups. |
| Notification | order + kind + audited delivery generation | Durable recipient/payload/provider key and recorded provider delivery. |
| Recovery audit/manual completion | stable IDs; actor UUID without account cascade | Checked reason/evidence, prior state/error/count and timestamp. |

See [SNAPSHOT_PRODUCTION.md](SNAPSHOT_PRODUCTION.md) for modes, ceilings, readers,
retention boundaries, APIs and lifecycle details.

## 4. Database changes

Only new migration: `supabase/migrations/20261002120000_snapshot_owned_production.sql`.

- Snapshot columns `snapshot_schema_version`, `production_mode`; expanded status
  check for manual/remediation states; mode check.
- Job/output `snapshot_id`, `order_item_id` RESTRICT FKs; customization FKs SET NULL.
  Partial unique indexes `snapshot_render_job_identity`, `snapshot_output_identity`.
- `order_production_assets`: snapshot/order RESTRICT FKs, SHA/size/kind/path checks,
  composite PK, order index, RLS and admin-read policy, service insert/select only.
- Private `order-production` bucket, size/MIME limits. No customer object policy.
- `production_recovery_audit`: immutable service insert/admin read evidence table.
  `manual_production_completions`: unique snapshot, actor/evidence/completion date,
  RESTRICT reference, RLS/admin read and service insertion.
- Notification columns `first_delivery_attempt_at`, `delivery_payload`, checked
  `delivery_generation`; worker `last_success_at`, `last_failure_at`.
- Triggers: snapshot initialization, manifest registration, manual instruction
  snapshot/task creation, finalized contract/object-presence requirement, new
  job lineage guard, committed storage protection, product/history deletion
  guards and worker outcome stamping.
- RPCs: `enqueue_snapshot_render_job`, `mark_snapshot_render_processing`,
  `commit_snapshot_render_result`, `fail_snapshot_render_job`,
  `retry_production_work`, `complete_manual_production`, `invalidate_snapshot_output`,
  `reconcile_production`, `production_storage_cleanup_candidates`,
  `prepare_notification_delivery`, `record_notification_delivery`,
  `resolve_notification_delivery`.
- Existing functions updated: production dispatch finish, missing-task wrapper,
  abandoned render lease recovery and both overlapping immutable template guards
  (`prevent_customizer_version_mutation`, `protect_template_version`). The second
  guard was reproduced under service role, not hidden by database-owner bypass.
  Existing queue health renamed `production_queue_health`; `production_health`
  combines existing counters with complete chain failures/manual/automatic counts.
- Public/anon/authenticated execution revoked for privileged new/replaced RPCs;
  authenticated snapshot/job/output mutations revoked. Existing customer read
  boundaries remain. Completed storage objects are retained; only old orphan
  candidates are removed through the Storage API, never metadata-only SQL deletion.
- Backfill preserves contents/IDs/output rows, flags incomplete schema-0 work as
  remediation-required, and retains old tasks. The tested forward migration
  preserves customers/orders/snapshots/tasks and blocks unsafe legacy source deletion.

## 5. Tests

New regression specifications:

- `lib/customizer/__tests__/snapshot-production.test.ts`: actual SQL→renderer→commit
  pipeline, 26 tests; A–R coverage below plus deterministic PDF, original/output
  deletion protection, storage disappearance/regeneration, timeout attempt ceilings,
  safe orphan selection, changed-font rejection, corrupt/static-vector acceptance
  guards and preserving text/identity during pinning. The manual PDF case removes
  both the original upload and live product, then verifies retained document bytes,
  product specification and pinned product reference images.
  A further migration replay case preserves finalized v1 inputs, originals,
  completed jobs/outputs, notifications, security checks and queue-health semantics.
- `lib/customizer/__tests__/production-pdf.test.ts`: 3 passing tests; readable
  self-contained PDF acceptance, unembedded custom font rejection and corrupt/empty
  PDF rejection. Standard PDF font resources are explicitly recognized.
- `lib/security/__tests__/admin-production-guard.test.ts`: 8 tests; unauthorized
  retry/original access, same-origin/method, chunked limits, worker/designer
  capabilities, auth exceptions, exact logout and AST audit of all admin mutations.
- `lib/customizer/__tests__/production-output-links.test.ts`: 2 tests; nested and
  old output signing, and refusing missing/invalid/checksum-mismatched leaves.
- `lib/database/__tests__/snapshot-forward-migration.test.ts`: 2 tests; accepted
  legacy history survives first application and repeated application, and the
  migration accepts an already-existing `snapshot_production_mode_check` constraint.
- Added actual notification SQL regression tests to `checkout-outbox-database.test.ts`
  for committed delivery before lost acknowledgement, frozen payload retries,
  expired provider window, refused blind admin retry and audited review generation.
  Added provider-generation key regression to `order-email.test.ts`.
- Existing checkout tests were adapted to assert actual durable upload metadata;
  finer auth/version/feature tests now assert the correct checkout-versus-production
  boundary. No failing test was disabled or replaced with a skipped placeholder.
- `e2e/production-security-smoke.spec.ts`: 2 browser tests added for unauthorized
  production operations and exact expired-session/cross-origin logout behavior.
  These were not executed: automatic approval review blocked local server launch.

| Mandatory case | Executed proof | Local result |
|---|---|---|
| A | Normal PNG + PDF, aggregate completion and exact output groups | PASS |
| B | Delete actual customization row; render checksum unchanged | PASS |
| C | Archive product; render unchanged | PASS |
| D | Permanently delete v1 product; render unchanged; legacy unsafe deletion blocked | PASS |
| E | Change mutable template to version B; output remains captured A | PASS |
| F | Delete template/version cascade; render still succeeds | PASS |
| G | Delete actual auth user and account cascade; pending production succeeds | PASS |
| H | Explicitly remove temporary customer upload bytes/metadata; render pinned original | PASS |
| I | Commit succeeds but response is lost; second worker/dispatch gives one logical result | PASS |
| J | Asset outage makes rendering fail; restoring bytes permits retry | PASS |
| K | Permanent failure, denied customer recovery, audited admin reset on same job/task | PASS |
| L | Manual-required instead of ambiguous pending; audited completion once | PASS |
| M | Completed dispatch with missing job repaired twice without duplicate work | PASS |
| N | Deliberately broken historical item linkage flagged by health | PASS |
| O | Foreign customer gets no asset RLS rows and no signed original URL | PASS |
| P | Customer/anonymous route retry denied before privileged I/O; RPC execution denied | PASS |
| Q | Schema 0/unknown/hash corruption explicitly refused; valid JSONB integrity accepted | PASS |
| R | Two customized products in one order retain separate assets/item/output checksums | PASS |

PGlite runs actual PostgreSQL schema/migrations/functions/RLS on one connection.
Storage bytes use a controlled stand-in; the real renderer and hashing execute.
These prove local logic, not live Storage API behavior or interleaving PostgreSQL
transactions. Those separate external gates remain unverified.

## 6. Commands executed

Commands ran in this checkout with Node **22.23.3**, using its executable and
`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`. The machine's default
Node 24 was not used for the final gates. Evidence is retained in
`docs/validation/2026-09-30-snapshot-production/`.

| Command / scope | Actual final result | Evidence file |
|---|---|---|
| `npm ci` under Node 22 | PASS; 443 packages installed, 444 audited, zero vulnerabilities | `install-node22-results.log` |
| `npm run typecheck` | PASS, including the migration-replay follow-up | `migration-replay-typecheck.log` |
| `npm run lint` | PASS; zero errors, 66 existing warnings | `lint-results.log` |
| `npm test` (unit, integration, actual SQL/RLS/migration and rendering regressions) | PASS; 111 files, 2,073 tests | `migration-replay-full-tests.log` |
| Final forward-migration and production regression run after the asset-kind replay update | PASS; 2 files, 28 tests, including existing constraint and repeated successful application | `migration-replay-tests.log` |
| ESLint on the changed migration/production test files | PASS; zero errors or warnings | `migration-replay-lint.log` |
| `npm run validate:customizer:database` | Static PASS: 18 tables; live database SKIPPED because no connection string was provided | `database-validation.log` |
| `npm run test:e2e` (seeded Playwright) | FAILED collection: required customer/admin seed credentials and URLs are missing; no browser cases executed | `e2e-results.log` |
| Public/security Playwright smoke | NOT EXECUTED: local `next start -p 3041` was rejected twice by automatic approval review, with reason `blocked by policy` | This report; tool rejection produced no process log |
| `npm run build` | PASS, including ten local font validations; process-scoped `NEXT_PUBLIC_SITE_URL=https://husnalogy.com` because `.env.local` has a localhost origin | `build-results.log` |
| `npm run audit:customizer` | PASS; 286 files, zero manual-review findings, zero import cycles | `customizer-audit.log` |
| `npm audit --json` | PASS; zero vulnerabilities | `audit-results.json` |
| `git diff --check` | PASS; only normal LF/CRLF working-copy notices | Final command output |

The full passing suite includes all mandatory A–R cases, rather than only isolated
unit mocks. PGlite is actual PostgreSQL in-process, but its single connection and
controlled Storage implementation do not substitute for live Supabase concurrency,
RLS/Storage API and authenticated browser validation. Earlier failed focused runs
were repaired and rerun; they are not represented as final passes.

## 7. Production deployment requirements

Follow [SNAPSHOT_PRODUCTION.md](SNAPSHOT_PRODUCTION.md) and the updated
[HOSTINGER_DEPLOYMENT.md](../HOSTINGER_DEPLOYMENT.md). Required sequence:
backup DB/private storage → pause personalized checkout/cron → apply missing
migrations in filename order and the complete new forward migration → matching Node 22
install/build/deployment → read-only schema/storage checks → legacy inventory and
remediation → actual multi-worker/asset/auth/render/email staging smoke → resume.

Required app configuration: public HTTPS site/Supabase origin and publishable key;
private service-role key, Google Fonts API key and worker secret; verified Resend
sender/API key, reply-to/admin destination; monitoring DSN. Multi-process deployments
need the existing Upstash distributed rate limiter and actual trusted proxy count. Production fixture
flags stay disabled. Cron invokes the header-authenticated protected endpoint every
five minutes. Health alerts cover worker outcomes/age, queue age, failures and every
chain gap; staff handles the explicit manual queue. The runbook provides the private
cron script, recovery payloads, storage protection and output-download procedure.

## 8. Remaining limitations

- No designated disposable live Supabase database/storage project or authenticated
  E2E seed credentials were provided. The live validator skipped; seeded Playwright
  failed collection. No real project migration, destructive test or deployment ran.
- Automatic approval review rejected both local server launch attempts with
  `blocked by policy`. No local server started; public responsive/font smoke and
  the new production-security browser cases remain unexecuted.
- PGlite cannot prove multi-connection lock contention/deadlock behavior, real
  Supabase Storage overwrite/delete semantics, provider delivery or host cron limits.
- Legacy production cannot be fabricated from incomplete history. Its actual
  deployed inventory and retained original/output bytes need independent review.
- Linux/Hostinger native rendering, capacity, physical print output, worker frequency,
  email inbox/bounce behavior and deployed monitoring remain unverified.
- Rendering is deterministic for the frozen input and current tested engine/platform;
  future native/library upgrades require retained v1 semantics and checksum QA.
  Synchronous native rendering cannot be force-aborted mid-call; acceptance bounds
  workload and the network/execution deadlines fence subsequent side effects.
- Lint warnings already present in the application remain disclosed. Local build
  reads encountered a Supabase gateway clock-skew retry; deployed clock/auth behavior
  should be checked during staging smoke.

These are explicit release gates. Local evidence does not close them. No known
remaining source dependency or manufacturing integrity defect was found in the
final audited v1 code path, but a production-ready decision requires the external
evidence and legacy inventory above.

## 9. Final decision

NOT READY FOR PRODUCTION
