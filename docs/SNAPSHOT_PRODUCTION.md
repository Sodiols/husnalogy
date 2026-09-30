# Immutable snapshot production

Finalized personalized orders use `order_design_snapshots.snapshot.production`
as their manufacturing input. Checkout pins bytes before the atomic order RPC;
the RPC links each snapshot to its exact order item, registers the manifest,
inserts production/notification tasks, consumes the cart and finalizes together.
Asset verification failure prevents acceptance. Failed pre-transaction copies
are private and eligible for bounded cleanup after 48 hours.

## Contract and supported inputs

`snapshot_schema_version=1` / `snapshotSchemaVersion=1` and renderer
`husnalogy-snapshot-1` identify this contract. The canonical SHA-256 includes the
entire JSON snapshot. JSONB key reordering does not change its integrity hash.
The production input freezes the renderer template, customer values, editor
state, pages, dimensions/DPI/bleed, masks/transforms/layers, flags, output types,
font catalogue entries and exact licensed font bytes. Order-item columns and
the snapshot retain trusted options, quantity and pricing.

Assets use `order-production/orders/<orderId>/assets/<sha256>`. Manifest entries
contain checksum, actual size, MIME and kind. Images render through
`order-asset:<sha256>` references. Renderer reads only private copies and checks
every checksum; it neither downloads source images nor consults a current font
catalogue. Font files are parsed before acceptance and rendering. Original
Google Fonts OFL/Apache/Ubuntu notices are retained alongside their exact bytes;
unknown licensing fails acceptance. Manual file fields retain checksum-pinned PDF
originals (1–100 readable pages, embedded or PDF-standard font resources).
Corrupt/encrypted or non-self-contained PDFs fail before acceptance. Cache publication is atomic. SVG image text
must be outlined and vectors static; corrupt images fail before acceptance.

Automatic rendering accepts at most 32 distinct safe page IDs, 12,000 pixels
per side including bleed, 50 million pixels per page, 200 million total pixels,
and 1,200 DPI. Assets are at most 30 MiB each, 100 image sources, 100 font
variants, 256 total manifest entries. These ceilings fail explicitly instead
of accepting a job that exceeds known worker capacity. Deployment load testing
must verify smaller operating limits if the hosting plan cannot sustain them.

Future incompatible formats require a new schema/renderer identifier and a
retained old renderer. Do not change v1 layout semantics and silently reuse its
identifier. Preserve pinned native renderer/library versions with deployment
artifacts; validate a new platform/build against reference PNG/PDF checksums.

Schema 0 is preserved without fabricated assets. Incomplete legacy snapshots
become `remediation_required`; old completed outputs remain intact. Legacy or
unknown contracts fail explicitly and health reports them. Inventory legacy
orders and manually review retained design/output/source bytes before launch.
Do not substitute the current template or declare absent originals recoverable.
Escalate unverifiable accepted designs to the owner for customer resolution.

## Lifecycle and recovery

Automatic: snapshot pending → durable dispatch → one job per required output
type → processing → exact stored bytes verified → atomic output/job/snapshot
commit. PNG jobs require every enabled page; PDF requires `all`. Snapshot is
complete only when all required logical jobs complete. Dispatch completion
means the required jobs exist; it is not manufacturing completion.

Manual: `production_mode=manual`, `manual_required`; no automatic jobs are
created. Form-based personalization freezes field instructions and durable
uploads, product specification and durable product reference images too. Staff must record a checked physical/manufacturing batch using
`POST /api/admin/production/manual-complete` with `snapshotId` and `evidence`
(10–1,000 characters). Its evidence and actor survive account deletion.

Jobs have unique `(snapshot_id, job_type)` identity and outputs unique
`(snapshot_id, job_id, page_id, format)` identity. Attempt storage paths contain
the lease token. A stale worker cannot overwrite a winning attempt or remove
committed output after a lost response. Completion and failure transitions
lock snapshot before job and commit atomically. Rendering leases are 180s,
heartbeat 25s, execution/network deadline 120s/60s respectively. The network
deadline stops renewing a hung worker; abandoned lease recovery consumes an
attempt and permanently fails after three. Native rasterization is synchronous;
dimension limits bound its workload, and the deadline is checked after it.
The worker stops claiming when it cannot reserve the full job deadline.

Audited admin recovery uses `POST /api/admin/production/retry` with `kind`
(`production`, `render`, `snapshot`, `notification`), UUID `id` and `reason`
(3–500 chars). The existing customizer retry route accepts `jobId` or
`snapshotId`. Recovery resets the same logical task/job, records previous state,
error and attempt count, and refuses active leases, completed render duplicates,
manual rendering and unsupported legacy contracts. Admin ID comes from the
authenticated session; authenticated database clients cannot call these RPCs.

The order snapshot viewer signs ready output leaves in both historical flat
and v1 PNG/PDF groups, for 300s, with no-store responses. Missing/invalidated
output records are not signed. `GET /api/admin/production/assets?snapshotId=…&key=…`
is admin-only and grants a 120s signed original URL. Bucket access is private;
customer preview APIs retain their existing ownership checks.

## Notifications

Each order/kind has one durable task and provider key
`husnalogy-notification-<taskId>`. Before sending, a leased RPC freezes the full
email payload, sender/reply-to and first attempt timestamp. Provider delivery ID
is durably recorded as sent before ordinary task acknowledgement. Retrying a
lost response uses the same key and exact payload. Email tasks defer when
configuration is absent without consuming attempts.

[Resend retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys).
This application refuses an uncertain send after 23 hours. Staff must inspect
provider activity and use `POST /api/admin/production/notification-delivery`
with `id`, `delivered`, optional `providerId`, and `reason` (at least 10 chars).
Verified delivery records the provider ID; verified non-delivery increments an
audited delivery generation and allows a new provider key and newly frozen
payload, so corrected sender/recipient configuration can recover too. Ordinary
retries keep the same generation/key/body. A blind retry cannot bypass review. Provider accepted
delivery is distinct from inbox delivery/bounces; monitoring provider activity
remains required.

## Shared mutation security

Every `/api/admin` POST/PUT/PATCH/DELETE uses `withAdminMutation`: safe methods,
same-origin checks, authenticated actor/capability, bounded streaming body and
controlled errors. Original ownership/capability checks and proxy rate limits
remain. Designer studio routes explicitly permit designers, then retain their
existing ownership checks. Worker secrets are constant-time verified headers;
they bypass browser/session checks solely on the worker-capable route.

The single session authorization exemption is `/api/admin/logout`: expired or
downgraded sessions must still be clearable. It retains exact-route, origin,
method, body and error checks and performs only sign-out. Secret-only worker
GET and admin/secret health GET remain intentional read/scheduler endpoints.

## Deployment and operational proof

1. Use Node 22, `npm ci`, the checked lockfile and the normal server build/start.
   Back up database and private storage. Pause personalized acceptance and cron.
2. Apply missing timestamp migrations in filename order, then
   `20261002120000_snapshot_owned_production.sql` through migration tracking. The
   full file can safely be rerun if its constraints, tables, functions or triggers
   already exist; it preserves order-owned rows and the original queue-health
   implementation. Run the entire file, including `begin`/`commit`, not selected
   statements. Deploy this matching
   application before resuming. Do not roll back only the app to a live renderer.
3. Confirm `order-production` is private, 30 MiB limit, permitted MIME types,
   no customer storage policy, and `guard_pinned_production_storage` exists.
   Database metadata cannot be deleted/overwritten while originals/ready outputs
   reference it. Do not run external bucket lifecycle deletion against committed
   production objects. Storage/database administrators can bypass application
   protections: coordinated backups and access discipline are necessary.
4. Run the read-only live validator with `CUSTOMIZER_DATABASE_URL` or
   `HUSNALOGY_DATABASE_URL` targeting the designated disposable/staging database.
   It checks the new tables, columns, indexes, private bucket, restricted RPCs,
   manifest object presence and outstanding legacy remediation.
5. Configure `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, publishable key,
   `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` or `RENDER_WORKER_SECRET`. Configure
   `GOOGLE_FONTS_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, optional `EMAIL_REPLY_TO` and
   `ORDER_NOTIFICATION_EMAIL`; configure monitoring DSN. Keep all secrets private.
6. Schedule the protected worker every 5 minutes; use the script below rather
   than putting a secret in a URL or cron output. hPanel shell/script support
   depends on the plan: [Hostinger cron setup](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/).
   Verify the actual hosting request timeout; `maxDuration=300` is application
   configuration, not proof that the hosting plan honors 300 seconds.
7. Monitor `/api/admin/production/health` using a header secret. Alert on 503,
   worker last-success age >15m, oldest production/render pending >30m, email
   pending >60m, failed tasks, missing chain links and legacy snapshots. Inspect
   manual-required counts as the staff fulfillment queue, not automatic success.
8. A worker run performs rolling checksum verification (10 outputs, 20s soft
   budget), bounded orphan cleanup (25 candidates, 10s soft budget), chain repair,
   due dispatch/email and rendering. Soft budgets stop claiming between operations;
   requests already started can take up to their network deadline. Busy runs
   return 409 within one process; multi-process work is protected by DB leases.
9. For multiple app processes configure `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN` and `REQUIRE_DISTRIBUTED_RATE_LIMIT=1`; validate
   `TRUSTED_PROXY_HOPS` against the actual proxy chain. Keep production fixture
   flags disabled. Provision a separate disposable E2E project and accounts.
10. Before opening checkout, place actual staged multi-design automatic/manual
    orders, delete test source entities/uploads/account, render, compare hashes,
    retry a forced failure, overlap two worker invocations, verify private storage
    denials, perform one real email retry and observe health recovery. Confirm
    PNG/PDF dimensions and the staff download/manufacturing path on Linux/Hostinger.

Example private cron script (owner-readable mode 700; secret supplied securely
to this script's environment). Register the script invocation in hPanel:

```sh
#!/bin/sh
set -eu
: "${CRON_SECRET:?missing worker secret}"
curl --fail-with-body --silent --show-error --connect-timeout 10 --max-time 300 \
  -H "Authorization: Bearer ${CRON_SECRET}" -H 'Content-Type: application/json' \
  -d '{"limit":20}' https://husnalogy.com/api/admin/customizer/render/process
```

Never delete finalized order/item/snapshot history to resolve a constraint.
Customer-account FKs may clear optional customer/customization metadata;
order snapshots, pinned assets, jobs, outputs and audit actor IDs survive.
