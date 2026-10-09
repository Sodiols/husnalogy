# Backup and restore test results

## Summary (2026-10-10, after the backup hardening)

| What | Result |
|---|---|
| Backup → off-site → isolated restore drill, **synthetic data, local PostgreSQL 17 + local Storage API stand-in + S3 CLI test double** | **PASS 11/11** (alone, and again inside the full `vitest run`) |
| Backup unit tests (identity, encryption, formats, retention, destination, monitoring) | **PASS** — `backup-hardening.test.ts` 17, `backup-tooling.test.ts` 12 |
| Production database backup | **NOT RUN** — no production database URL, destination or approved key here |
| Production Storage backup | **NOT RUN** (files) — read-only inventory only: 75 objects ≈ 44 MB, 0 missing references |
| Supabase managed backups / PITR | **NOT VERIFIED** — needs the dashboard |
| Restore into a hosted Supabase project | **NOT RUN** |

The tools and the runbook are proven on synthetic data; **production data is
not yet protected by a verified backup.**

## Drill (`lib/database/__tests__/backup-restore-drill.test.ts`)

Tools: PostgreSQL 17.10 client tools (EDB binaries, `HUSNALOGY_PG_BIN`),
Node 22.23.3. Evidence file: `test-results/backup-restore-drill.json`.
Without the client tools the suite reports SKIPPED with the reason.

**Dataset (synthetic):** 5 accounts (admin, designer, customers A/B/C);
products incl. draft/hidden/sold-out; a product collection; 3 templates with
published versions plus a version 2 published after customer A saved on v1;
5 saved designs (photo reference with crop and mask, background image);
cart lines; an address; a checkout order with its integrity-hashed snapshot
and pinned production file; a real **automatic-production order** (pinned
image, font, licence); a render job and output; customer photo
(original/editor/thumbnail), customer B's upload, an avatar, admin SVG and
background assets, a product image by absolute URL — 13 Storage objects in 6
buckets.

| # | Test | Result |
|---|---|---|
| 1 | Identity: DB of project X + Storage of project Y refused (both ways); wrong expected ref refused; production label on non-production refused; no key refused — **no run folder created** | PASS |
| 2 | Backup while 6,327 rows were written concurrently: `recovery-grade`, archives = snapshot exactly; uploaded off-site, byte-identical; **no user id, order id, file name, phone, e-mail or content hash in any plaintext artifact, locally or off-site** (control: they are present inside the encrypted index) | PASS |
| 3 | Snapshot export denied (role without `pg_export_snapshot`) → `consistency-unavailable`; run folder holds only `FAILED.json`; last success unchanged | PASS |
| 4 | Connection killed mid-backup (backend terminated while waiting on a lock) → failed at `database`; only `FAILED.json`; off-site still one complete run | PASS |
| 5 | Restore from the **off-site** copy (fetched, verified) into a NEW database built from the migrations and a NEW Storage: all 54 tables match the manifest; policy fingerprint identical; live identity of the target proven; 13/13 objects restored and re-downloaded by checksum; 2 URLs re-pointed; design on template v1 with v1+v2 present; snapshots + integrity hashes identical; accounts and roles identical; collection link and background reference intact; reconciliation 0 missing / 0 critical / 0 checksum / 0 orphans; **the production worker, given only restored data and files, produced and rendered the restored automatic order (output checksum verified)** | PASS |
| 6 | Restored project: customer isolation (order, design, address, library, private photo), no listing of private buckets, no role escalation, same bucket privacy | PASS |
| 7 | Refusals: production target, mismatched URL pair, unconfirmed target, non-empty target, schema drift (names the column), wrong key (verify and restore), flipped byte in an archive, truncated archive, tampered `manifest.enc`, tampered `index.enc`, tampered blob (reported without its path) | PASS |
| 8 | A v1-format backup (previous layout) verifies and restores | PASS |
| 9 | `--mode full` (schema + data from the archive alone) | PASS |
| 10 | Off-site faults: upload error, silent partial upload, rejected credentials → `upload-failed`, last success unchanged, partial run visible as incomplete; retention dry-run by default, applied only when approved, newest complete kept; monitoring: fresh OK, > 26 h stale, destination unreachable, rejected credentials | PASS |
| 11 | Monitoring: no backup / stale backup reported | PASS |

**Timings** (run inside the full parallel suite, machine under load):
backup 10.2 s; database restore 10.6 s; Storage restore 0.5 s; total restore
12.3 s; full-mode restore 5.6 s. Alone: backup 5.5 s, restore 6.9 s.

| Objective | Measured (drill) | Proposed (strategy option B) |
|---|---|---|
| RPO | = time since the last run (the restore is exactly the snapshot) | ≤ 24 h |
| RTO, restore steps | ≈ 7–40 s (synthetic, small) | — |
| RTO, real | not measured: + create/configure a project, fetch backup, platform settings, deploy, smoke tests | 2–4 h new project; ~1 h in place |

## Limits of this evidence

* Storage = local stand-in of the Storage HTTP API (metadata in the real
  `storage.objects`), S3 = a CLI test double — not Supabase Storage, AWS or
  another provider.
* The database was PostgreSQL 17 with the Supabase scaffolding, not a hosted
  project (whose `auth` schema has more tables; the auth archive restores
  `auth.users`/`auth.identities` by column name).
* No HTTP application smoke test against the restored data (needs
  PostgREST/Auth): the worker render is the end-to-end proof here.

## Next drill (needs owner action)

After the first production backup (strategy §9): restore it into a
disposable Supabase project with the runbook, record times here, then repeat
quarterly and after any backup-tool change.
