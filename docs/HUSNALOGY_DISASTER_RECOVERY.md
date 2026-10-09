# Husnalogy disaster recovery runbook

For an authorized operator. **Never restore over the live production
project.** Every restore goes into a NEW, isolated recovery project first;
switching the live site to it is a separate, approved cutover (§6). The tools
refuse production targets (`scripts/backup/lib/target.mjs`).

Backups and their limits: [PRODUCTION_BACKUP_STRATEGY.md](PRODUCTION_BACKUP_STRATEGY.md).
Proof that this procedure works (synthetic data): [BACKUP_RESTORE_TEST_RESULTS.md](BACKUP_RESTORE_TEST_RESULTS.md).

## 1. Choose the path

| Incident | First response | Recovery path |
|---|---|---|
| Wrong data change / accidental delete of products, templates, orders | Stop the cause (revert deploy, disable the admin user). Note the time T of the mistake. | Small scope: restore a backup into a recovery project (§3), copy the affected rows back with reviewed SQL. Large scope: Supabase in-place restore (§2) or full recovery + cutover. |
| Incorrect migration | Stop deploys. Do not run more migrations. | Prefer a forward-fix migration (tested on staging). Data damaged → as above. |
| Database corruption / project failure | Maintenance mode (§5). | Supabase in-place restore (§2) if the project is reachable; otherwise new project (§3) + cutover (§6). |
| Storage objects lost | Stop cleanup jobs (pause the worker cron). | `restore:storage --skip-existing` into the SAME buckets from the latest Storage backup — only after rehearsing it in a recovery project; it never overwrites. |
| Bad application deployment | Redeploy the previous git tag in hPanel. | No data restore needed unless data was damaged. |
| Compromised credentials | Rotate at once (§4.3). Review Auth logs, `customizer_audit_logs`, orders. | Restore only if data was altered. |

## 2. Supabase in-place restore (managed backups / PITR)

Only if the plan has them (Pro+). Dashboard → Database → Backups → pick the
latest daily backup before T (or a PITR time). The project is **offline**
during the restore and everything after the restore point is lost; Storage
files are NOT rolled back (metadata only). Afterwards: reset custom role
passwords, run §3 step 10 checks, then `npm run backup:reconcile` against the
live project to list files the restored rows expect but Storage lacks (restore
those with `restore:storage --skip-existing` from our Storage backup).

## 3. Full recovery into a new, isolated project

Commands run from a checkout of the release that matches the backup's
migrations, on Node 22, with PostgreSQL 17 client tools
(`HUSNALOGY_PG_BIN` or PATH) and `BACKUP_ENCRYPTION_KEY` in the environment.

1. **Identify** the incident and the recovery point T. Record who decided.
2. **Restrict risky operations:** pause the hPanel worker cron; enable
   maintenance mode (§5) if customers could write bad data.
3. **Pick the backup run:** each run holds the database AND the Storage copy
   taken right after it. `npm run restore:fetch -- --list` (with
   `BACKUP_DESTINATION` and the destination credentials) lists complete runs
   (run ids are UTC times; a run's `snapshotAt` is in its `status.json`).
   Choose the latest run whose snapshot is before T, then download it:
   `npm run restore:fetch -- --run <runId|latest> --out <new private folder>`
   — only complete runs are accepted, and the download is verified at once.
4. **Verify it** (again, if copied elsewhere): `npm run backup:verify -- --backup <run folder>`
   → `"ok":true` (needs `BACKUP_ENCRYPTION_KEY`; a wrong key or any modified
   byte fails here).
5. **Create the recovery project** in Supabase (same region), note its ref.
   Write a private env file (e.g. `recovery.env`):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<recovery-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=…
   RESTORE_DATABASE_URL=postgresql://postgres.<recovery-ref>:…@aws-0-<region>.pooler.supabase.com:5432/postgres
   RESTORE_CONFIRM_TARGET=<recovery-ref>
   ```
6. **Schema:** apply the versioned migrations to it — e.g. copy `recovery.env`
   to `.env.staging` with `STAGING_DATABASE_URL`/`STAGING_CONFIRM_PROJECT_REF`
   set to the recovery project, then `npm run staging:migrate`. This creates
   tables, RLS, grants, functions, buckets and Storage policies.
7. **Database:** `npm run restore:db -- --backup <run>/database --target-env recovery.env`
   (one transaction; refuses drift, production and non-empty targets; compares
   every table's row count with the manifest).
   *Drift fallback* (migrations do not reproduce the source):
   use a recovery project WITHOUT migrations and `--mode full` (schema + data
   from the archive), then apply the Storage statements (bucket inserts and
   `on storage.objects` policies) from the migrations in the SQL editor.
8. **Storage:** `npm run restore:storage -- --backup <run>/storage --target-env recovery.env`
   (needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` AND
   `RESTORE_DATABASE_URL` in `recovery.env`: before uploading it proves the
   API and the database are the same recovery project; ambiguous settings
   are refused)
   (verifies every file's SHA-256 before upload, refuses a public/private
   mismatch, never overwrites, re-downloads everything to verify).
9. **URLs:** `npm run restore:rewrite-urls -- --target-env recovery.env --from https://<old-ref>.supabase.co`
   (dry run), then add `--apply`. Catalogue images otherwise keep loading from
   the old project. Order snapshots are never touched; order history and
   published versions only with `--include-immutable`.
10. **Verify** (record results in the incident log):
    - `npm run backup:reconcile -- --source-env recovery.env --out <private>/reconcile.json`
      → `missing: 0`, `missingCritical: 0`, `checksumMismatch: 0`;
    - `npm run probe:schema -- --env recovery.env` → `"ok":true`;
    - HOSTINGER_DEPLOYMENT.md §3 query in the recovery SQL editor → all `true`;
    - user / product / customization / order counts equal the manifest
      (step 7 does this) and Storage counts equal `storage-manifest.json`;
    - template version relationships: a saved design opens on its pinned
      version (customizer smoke test below);
    - private buckets: `select id, public from storage.buckets;`.
11. **Reconfigure the platform** (§4.1) and **restore secrets** (§4.3).
12. **Auth:** sign in as an admin and as a customer (existing passwords keep
    working: `auth.users` is restored with its hashes); request a password
    reset to check e-mail; test Google sign-in.
13. **RLS / privacy smoke test:** a second customer cannot see the first
    customer's design, address or order; `npm run test:staging` if the
    recovery project can be used as staging.
14. **Application smoke test** with a deployment pointed at the recovery
    project (staging host or a local `npm run build && npm start` with the
    recovery variables): home, listing, product page, Admin Customizer opens a
    product, Customer Customizer opens a saved design with its photo,
    "My orders" shows the customer's order, images load.
15. **Production rendering:** run the worker once
    (`POST /api/admin/customizer/render/process`, Bearer `CRON_SECRET`) and
    confirm `GET /api/admin/production/health` → 200 and that pending orders
    render from their snapshots.
16. **Document differences** (what is newer in the old project, what is lost
    between the backup point and the incident).
17. **Prepare the cutover** (§6) for approval.

## 4. Configuration that a database restore does NOT bring back

### 4.1 Supabase project settings (dashboard)

* Authentication → URL Configuration: Site URL `https://husnalogy.com`;
  redirect URLs `https://husnalogy.com/auth/callback`,
  `https://husnalogy.com/reset-password` (+ `www` twin if used).
* Authentication → Providers: Email (confirmations as configured), Google
  (client id/secret; add `https://<new-ref>.supabase.co/auth/v1/callback` to
  the Google OAuth client's authorized redirect URIs in Google Cloud Console).
* Authentication → Emails / SMTP: templates and custom SMTP if used.
* Project Settings → API: new URL, publishable key, service-role key (new
  values — the old keys do not carry over).
* Database → Backups / PITR: re-enable the chosen protection on the new project.
* Auth data restored: `auth.users` (incl. password hashes) and
  `auth.identities`. NOT restored: sessions and refresh tokens (everyone signs
  in again) and MFA factors (not used by Husnalogy today).
* Storage: buckets and policies come from the migrations; verify §3 step 10.

### 4.2 Hosting and integrations

* hPanel → Node.js app → environment variables (names in
  HOSTINGER_DEPLOYMENT.md §2): `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_FONTS_API_KEY`, `CRON_SECRET`,
  `RENDER_WORKER_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
  `ORDER_NOTIFICATION_EMAIL`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`,
  `SENTRY_RELEASE`, `TRUSTED_PROXY_HOPS`, `UPSTASH_REDIS_REST_URL/TOKEN`,
  `OPENAI_API_KEY`, `OPENAI_MODEL`, `LOGY_USE_OPENAI`, `ICONIFY_API_BASE_URL`,
  `DELETE_ADMIN_EMAIL/PASSWORD`. `NEXT_PUBLIC_*` values are built into the
  bundle: **rebuild** after changing them.
* hPanel cron: worker every 5 min (HOSTINGER_DEPLOYMENT.md §5); backup check.
* Resend: verified sending domain (DNS records stay with the domain).
* Uptime monitor and Sentry project: point at the same URLs; nothing to restore.
* Domain / DNS / CDN: unchanged by a database recovery. (Cloudflare is out of
  scope here; review it in the final pre-launch stage.)

### 4.3 Secrets

Kept by the owner in a password manager / vault (never in git, never inside a
backup): Supabase DB password, service-role key, `CRON_SECRET`,
`RENDER_WORKER_SECRET`, `BACKUP_ENCRYPTION_KEY`, Resend, Google OAuth secret,
Google Fonts, OpenAI, Upstash, Sentry DSN, backup-destination credentials.
Rotation after compromise: Supabase → reset DB password and roll API keys;
generate new `CRON_SECRET` (`openssl rand -hex 32`, keep the old one in
`RENDER_WORKER_SECRET` only while the cron is updated); rotate provider keys;
update hPanel variables and the backup runner's secrets; rebuild + restart.
`BACKUP_ENCRYPTION_KEY` is never rotated in place: start a new key for new
backups and keep the old key as long as backups made with it are retained.

## 5. Maintenance mode

There is no built-in switch. Options, in order: pause the hPanel cron; stop
the Node.js app in hPanel (site offline); or deploy a build whose checkout
API is disabled. Choose and document before launch.

## 6. Production cutover (separate approval required)

Never automatic. Plan to present: chosen recovery point and expected data
loss; downtime window; steps — maintenance mode → final reconciliation →
switch hPanel variables to the recovery project → rebuild/restart → smoke test
(§3 steps 12–15) → re-enable cron → monitor; rollback = switch the variables
back. The old project is kept (not deleted) until the owner signs off.

## 7. Migration safety (future deployments)

Developer migration → `npm test` (fresh-database + PGlite + PostgreSQL 17
suites) → staging migrate → `npm run test:staging` + Customizer and checkout
regression → **backup taken and verified just before** → approval → apply to
production (SQL editor or `staging:migrate`-style runner) → `probe:schema` and
the §3 query → smoke test. Never run reset commands against production.
Not every migration can be rolled back: destructive changes (drops, type
changes, data rewrites) need a forward fix or a restore from the pre-migration
backup — state that in the migration's header before it ships.
