# Husnalogy Customizer Database

This document is the safety and installation companion for
`supabase/customizer_v2.sql`. The canonical schema file is intended for a fresh
Supabase environment. Existing databases must continue to use the ordered,
timestamped migrations under `supabase/migrations/`.

## Mandatory backup before an existing-database migration

Never test a migration for the first time against production. Use a dedicated
staging project whose project reference has been independently verified.

The modernization branch starts from Git commit
`20bcb4569b2342937b2db1c4b5890cd94a4c26e3`. Keep that commit and the database
backup timestamp together in the deployment record.

### 1. Freeze and identify the source

1. Pause administrator template publishing and render-worker claims.
2. Record the Supabase project reference, database host, PostgreSQL version,
   migration table contents, active feature flags, and current UTC timestamp.
3. Confirm that the connection string points to the intended staging or
   production project. Do not paste credentials into the repository or shell
   history; expose `HUSNALOGY_DATABASE_URL` only in the current secure session.

### 2. Create database dumps

Store backups outside the Git workspace on encrypted storage. These commands
require PostgreSQL client tools compatible with the server major version.

```powershell
$stamp = Get-Date -AsUTC -Format 'yyyyMMddTHHmmssZ'
$backup = Join-Path $env:USERPROFILE "secure-backups\husnalogy-$stamp"
New-Item -ItemType Directory -Path $backup | Out-Null

pg_dump --dbname=$env:HUSNALOGY_DATABASE_URL --format=custom --no-owner --no-acl --file=(Join-Path $backup 'database.dump')
pg_dump --dbname=$env:HUSNALOGY_DATABASE_URL --schema-only --no-owner --no-acl --file=(Join-Path $backup 'schema.sql')
pg_dump --dbname=$env:HUSNALOGY_DATABASE_URL --data-only --format=custom --no-owner --no-acl --file=(Join-Path $backup 'data.dump')
```

Capture a readable customizer inventory alongside the binary dump:

```powershell
psql $env:HUSNALOGY_DATABASE_URL -X -v ON_ERROR_STOP=1 -c "select schemaname, tablename, rowsecurity from pg_tables where schemaname in ('public','storage') order by 1,2" | Out-File (Join-Path $backup 'tables-and-rls.txt')
psql $env:HUSNALOGY_DATABASE_URL -X -v ON_ERROR_STOP=1 -c "select schemaname, tablename, policyname, roles, cmd from pg_policies order by 1,2,3" | Out-File (Join-Path $backup 'policies.txt')
psql $env:HUSNALOGY_DATABASE_URL -X -v ON_ERROR_STOP=1 -c "select flag, scope, scope_id, enabled, rollout_percentage from public.customizer_feature_flags order by flag,scope,scope_id" | Out-File (Join-Path $backup 'feature-flags.txt')
psql $env:HUSNALOGY_DATABASE_URL -X -v ON_ERROR_STOP=1 -c "select version from supabase_migrations.schema_migrations order by version" | Out-File (Join-Path $backup 'migration-versions.txt')
```

If an optional table is not installed yet, record that fact instead of changing
the source database just to make an inventory command pass.

### 3. Back up Storage object bytes

`pg_dump` contains Storage metadata, not the uploaded object bytes. Create a
provider snapshot or copy every object, preserving bucket and object path, from
these customizer buckets when present:

- `customer-uploads`
- `customizer-elements`
- `customizer-renders`
- `product-mockups`

Export a manifest containing bucket, object name, size, MIME type, checksum or
ETag, and updated timestamp. Compare manifest object counts and total bytes to
the source before continuing. Keep private buckets private in the backup.

### 4. Verify the backup by restoring it

Restore only into a new isolated PostgreSQL database. The `--clean` option is
destructive and must never target the source project.

```powershell
createdb husnalogy_restore_check
pg_restore --dbname=husnalogy_restore_check --clean --if-exists --no-owner --no-acl (Join-Path $backup 'database.dump')
psql postgresql:///husnalogy_restore_check -X -v ON_ERROR_STOP=1 -f scripts/validate_customizer_database.sql
```

Verify row counts for products, templates, versions, customizations, customer
assets, render outputs, order snapshots, feature flags, and audit logs. Restore
sample private objects into a non-public test bucket and confirm their checksums.
A dump is not accepted until this restore drill succeeds.

### 5. Recovery boundary

If deployment validation fails, disable the affected feature flags, stop render
workers, preserve all new data, and roll application code back to the recorded
Git commit. Prefer an additive corrective migration. A database restore is a
last-resort incident operation because it can discard writes made after the
backup; it requires an explicit maintenance window and reconciliation plan.

## Fresh installation versus existing databases

- Fresh project: install the repository's core ecommerce schema first, then run
  `supabase/customizer_v2.sql` once with `ON_ERROR_STOP` enabled.
- Existing project: do not run the canonical file. Apply only missing ordered
  migrations after the backup and staging verification above.
- Never run unrestricted drop, truncate, or delete statements as part of the
  normal Customizer deployment.
