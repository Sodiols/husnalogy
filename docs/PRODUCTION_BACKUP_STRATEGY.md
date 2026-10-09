# Production backup strategy

Updated **2026-10-10** (backup hardening). Status: **tooling implemented and
drill-tested locally; NOT configured or run against production.** Paid
features, the destination, credentials, the schedule and the retention policy
need the owner's approval (§9). Supabase facts are from the official docs
(<https://supabase.com/docs/guides/platform/backups>).

## 1. Current state

| Item | Status |
|---|---|
| Supabase plan / managed backups / PITR | **UNKNOWN** — needs the dashboard (Billing; Database → Backups). Pro: daily, 7 days; Team: 14; Enterprise: up to 30; Free: none listed. PITR is a paid add-on (Pro+, ≥ Small compute) that **replaces** daily backups. |
| Storage files backed up | **NO.** Supabase backups contain Storage metadata only, never the files. |
| Verified off-site production backup | **NONE.** |
| Backup tooling | Implemented, format v2 (§3–§6); drill PASS locally (BACKUP_RESTORE_TEST_RESULTS.md). |
| Scheduled automation | `.github/workflows/production-backup.yml` — manual dispatch only; not run (no secrets/destination). |
| Production size (read-only, 2026-10-10) | Small database; Storage 75 objects ≈ 44 MB; 0 missing referenced files. |

## 2. What must be recoverable

Database (accounts incl. `auth.users`/`identities`, profiles, addresses,
catalogue, drafts, immutable published versions, saved designs, carts,
orders, items, integrity-hashed snapshots, pinned production assets, tasks);
Storage files (customer originals/editor/thumbnails, admin library, order
production files, renders, catalogue media, avatars); configuration and
secrets (HUSNALOGY_DISASTER_RECOVERY.md §4); the application (git tags).

## 3. One entry point, six stages (`npm run backup:run`)

| Stage | What happens | Failure status (never a success) |
|---|---|---|
| 1 identity | static checks + live cross-check that the database and the Storage API are the approved project (§4) — **before anything is written** | `identity-mismatch` / `identity-unverified` |
| 2 database | one exported snapshot; both `pg_dump` archives use it; row counts read inside it; archives read back and **every table's row count must equal the snapshot's** (§5) | `consistency-unavailable`, `incomplete`, `failed` |
| 3 storage | every object downloaded, size-checked, encrypted under an opaque name | `incomplete` |
| 4 verification | without restoring: hashes, decryption, `pg_restore`, row counts, every blob | `incomplete` |
| 5 upload | to `BACKUP_DESTINATION`, every file verified there, then `COMPLETE.json`, then `latest-success.json` | `upload-failed` |
| 6 retention | planned every run; applied only when configured AND approved (§7) | reported, never invalidates the backup |

A run that fails in stages 2–4 keeps only `FAILED.json`; partial artifacts are
removed. `last-success.json` is written only for `recovery-grade` runs.
Standalone database/Storage backups are no longer possible (no bypass of
stage 1); `backup:inventory` remains as a read-only listing.

## 4. Project identity validation (`scripts/backup/lib/source.mjs`)

* `BACKUP_ENVIRONMENT` ∈ production | staging | local; `BACKUP_EXPECTED_PROJECT_REF` required.
* The database URL must identify a Supabase project — direct `db.<ref>.supabase.co`
  or pooler user `postgres.<ref>` — equal to the expected ref. Anything else is refused.
* The API URL must be the same ref, or a custom domain (then only the live
  check below can accept it).
* A legacy JWT service key must carry `role=service_role` and the same ref.
* `production` requires a registered production ref (`PRODUCTION_PROJECT_REFS`,
  `HUSNALOGY_PRODUCTION_SUPABASE_REFS`); `staging` refuses one; `local` accepts
  only local addresses.
* **Live cross-check (always):** buckets read through PostgreSQL and through
  the Storage API must be the same set, same public flags, same creation
  times; the newest objects' ids in `storage.objects` must be served by the
  API under the same ids. If neither signal is available the run is refused.
* Settings given twice with different values (e.g. a variable in the process
  and in the env file) are refused as ambiguous. There is no override flag.

## 5. Database consistency guarantee

`pg_dump` alone is transactionally consistent, but Husnalogy needs TWO
archives (application schemas; `auth.users`/`identities` data) plus row counts,
so they must share one exported snapshot. If `pg_export_snapshot()` fails —
e.g. through the **transaction** pooler (port 6543) — the backup fails as
`consistency-unavailable`. Use the **session** pooler (5432) or the direct
connection. After dumping, each archive is replayed through `pg_restore` and
its COPY rows counted: a mismatch with the snapshot's counts fails the run as
`incomplete`. PostgreSQL client tools must be ≥ the server's major version
(17 recommended; `HUSNALOGY_PG_BIN` or PATH); the run checks and refuses older
tools. The production server version is not yet confirmed (needs the DB URL).

## 6. Encryption and metadata (format v2)

AES-256-GCM (Node `crypto`, authenticated) with `BACKUP_ENCRYPTION_KEY`
(32 bytes, hex or base64) — **mandatory for every backup**; there is no
plaintext mode. Artifacts:

| File | Content | Encrypted |
|---|---|---|
| `database/public.dump.enc`, `auth.dump.enc` | archives | yes |
| `database/manifest.enc` | row counts, schema/policy inventory, file hashes, source | yes |
| `storage/index.enc` | every object's bucket, path, name, type, eTag, sha256; bucket settings; failure details | yes |
| `storage/blobs/xx/<id>.enc` | file bytes; `id` = HMAC(key, sha256) — names reveal no content hash | yes |
| `database/status.json`, `storage/status.json`, `verification.json`, `last-run.json`, `last-success.json`, `COMPLETE.json`, `latest-success.json` | format, status, times, counts, encrypted sizes, ciphertext hashes — **no paths, file names, ids, row counts or customer data**; error texts are redacted | no (monitoring) |

Plaintext exists only in a private scratch folder (owner-only on POSIX; set
`HUSNALOGY_BACKUP_TMP` to place it) and is deleted after use, also on failure.
The drill scans every local and off-site artifact for user ids, order ids,
file names, phone, e-mail and content hashes: none found.
**Compatibility:** v1 backups (plaintext indexes, made before 2026-10-10) are
still read, verified and restored; nothing writes v1. Re-encrypting old v1
folders is unnecessary — none exist outside test runs.
**Key custody:** two people hold `BACKUP_ENCRYPTION_KEY` in a password
manager; losing it makes every backup unreadable. Never store it next to the
backups. Rotation = new key for new backups; keep the old key while backups
made with it are retained.

## 7. Off-site destination, retention, monitoring

* **Destinations** (`scripts/backup/lib/destination.mjs`): `s3://bucket/prefix`
  (any S3-compatible provider through the AWS CLI; `BACKUP_S3_ENDPOINT` for
  non-AWS) or `file:///path` (an encrypted mounted volume). Uploads are
  verified file by file before `COMPLETE.json`; runs without it are partial
  and ignored by restore, monitoring and retention. Recommended bucket
  settings: private, versioning (or object lock), write-capable credentials
  without delete rights for the backup job (a separate retention job then
  needs delete rights — or rely on bucket lifecycle rules).
* **Retention** (`lib/retention.mjs`): `BACKUP_RETENTION=daily=14,weekly=8,monthly=12`
  (proposal) plans which runs to keep; deletion happens only with
  `BACKUP_RETENTION_APPROVED=yes`. Always kept: the newest complete run,
  partial uploads younger than 48 h; nothing is deleted when no complete run
  exists. Unset → dry-run report only.
* **Monitoring** (`npm run backup:check`, with `BACKUP_DESTINATION`): fails on
  no off-site backup, latest older than 26 h, latest run failed (any stage —
  identity, database, Storage, encryption, upload), destination unreachable or
  credentials rejected, size drop below 50 % of the previous run; warns on old
  partial uploads. The GitHub workflow runs it after every backup; schedule it
  separately (or as an uptime monitor) once approved.

## 8. Recovery objectives (proposals, not agreed)

| Option | Database | Files | RPO (DB / files) | RTO | Monthly cost (list prices) |
|---|---|---|---|---|---|
| A | our encrypted off-site backup, daily | same run | ≤ 24 h / ≤ 24 h | 2–4 h (new project + restore) | destination only (cents at ≈ 50 MB) |
| **B (recommended now)** | Supabase Pro daily (7 d) **+** our daily off-site backup | our backup, daily (6-hourly possible) | ≤ 24 h / ≤ 24 h | ~1 h in place; 2–4 h new project | Pro $25 if not already + destination |
| C (when orders grow) | Pro + PITR 7 d (≥ Small compute) + our daily backup | our backup, hourly | ≈ 2 min / ≤ 1 h | ~1 h | + PITR ≈ $100 + Small compute |

Measured locally (synthetic, small): restore steps ≈ 10–40 s; a real recovery
is dominated by creating and configuring a project.

## 9. Decisions and actions needed (nothing is enabled until then)

1. Confirm the plan; choose A, B or C. (Paid features need approval.)
2. Destination: a private S3-compatible bucket owned by Husnalogy, separate
   from Supabase, with an IAM user/application key scoped to that bucket.
3. GitHub Environment `production-backup` (Settings → Environments): required
   reviewers, deployment branch `master`; secrets `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_DATABASE_URL` (session pooler, 5432),
   `BACKUP_ENCRYPTION_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`;
   variables `BACKUP_EXPECTED_PROJECT_REF`, `BACKUP_DESTINATION`, `AWS_REGION`,
   optional `BACKUP_S3_ENDPOINT`, `BACKUP_RETENTION`, `BACKUP_RETENTION_APPROVED`.
4. First run: Actions → production-backup → Run workflow (manual). Success =
   job green AND the summary shows `"status":"recovery-grade"` and
   `"offSite":true`.
5. First restore test of that backup into a disposable project
   (HUSNALOGY_DISASTER_RECOVERY.md §3) — only then is production recovery
   *verified*.
6. Approve the schedule (uncomment the cron in the workflow) and the retention policy.

## 10. Commands

```bash
npm run backup:run -- --backup-root <private folder>          # settings from the environment (§3)
npm run backup:check -- --max-age-hours 26                    # with BACKUP_DESTINATION
npm run backup:verify -- --backup <run folder>                # needs BACKUP_ENCRYPTION_KEY
npm run backup:inventory -- --source-env .env.local           # read-only listing, aggregates
npm run backup:reconcile -- --source-env .env.local           # read-only DB ↔ Storage check
npm run restore:fetch -- --run latest --out <new folder>      # from the destination, then verified
```
