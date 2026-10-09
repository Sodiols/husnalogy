# Production procedure — `20261007150000_rls_public_surface_hardening.sql`

**Status: APPLIED by the owner. Anonymous draft access protection VERIFIED IN
PRODUCTION (2026-10-10). Remaining checks pending — see "Production
verification" below.** Before it was applied (2026-10-09/10) the probe showed
`customizer_template_is_public` missing and the public (anon) key read 2 rows
of `product_customizer_templates`.

## Production verification (2026-10-10, read-only)

| Check | Status | Evidence |
|---|---|---|
| Schema probe | **VERIFIED IN PRODUCTION** | `npm run probe:schema -- --env .env.local` → `"ok":true` (53 tables, 41 RPCs, 10 buckets; nothing missing). |
| Anonymous users cannot read unpublished Customizer drafts | **VERIFIED IN PRODUCTION** | Publishable key: `GET product_customizer_templates` → 401 `42501 permission denied`, also for the two previously exposed rows requested by id. |
| Published templates remain public | **VERIFIED IN PRODUCTION** | Publishable key reads 20/20 published versions (all belong to public active products); `customizer_template_is_public` answers correctly for both templates; both active products' product and personalize pages return 200 with the customizer for a guest on husnalogy.com. |
| Server paths (service role: product pages, studio, contact, newsletter routes) | **VERIFIED IN PRODUCTION** (privileges) | Service role reads drafts; holds INSERT on `contact_messages` and `newsletter_subscribers`. |
| Real Admin and Designer sessions | **PENDING** | Needs a sign-in by the owner (open the Design Studio as an admin and as a designer). Locally verified: `public-surface-migration.test.ts`, `designer-authorization.test.ts`. |
| Contact and newsletter submissions; direct anonymous inserts refused | **PENDING** | One live submission of each form; the SQL below for the anonymous INSERT privilege. Not tested from here: it would write production data. |
| Migration-history entry | **PENDING** | History tables are not exposed through the API (`PGRST106`). If the file was pasted into the SQL editor, Supabase records no history row; note the application date in the launch checklist instead. |

Read-only SQL that closes the pending database checks (production SQL editor):

```sql
select tablename, policyname from pg_policies
 where schemaname = 'public'
   and tablename in ('product_customizer_templates','contact_messages','newsletter_subscribers')
 order by 1, 2;  -- no *_public_read_active / *_public_insert policies expected
select has_table_privilege('anon','public.product_customizer_templates','select') as anon_reads_drafts,
       has_table_privilege('anon','public.contact_messages','insert')            as anon_inserts_contact,
       has_table_privilege('anon','public.newsletter_subscribers','insert')      as anon_inserts_newsletter;  -- all false expected
select version, name from supabase_migrations.schema_migrations where version = '20261007150000';  -- only if applied with the CLI
```

The procedure below is kept as the record of how the change is applied (and
for any other environment); do not apply it to production again.

## What it changes (and what it does not)

| Object | Before (production now) | After |
|---|---|---|
| `product_customizer_templates` (working drafts) | policy `customizer_templates_public_read_active` lets **anyone** read drafts of active products; `anon` has SELECT | that policy dropped; `revoke select … from anon`. Admins keep everything through `customizer_templates_admin_manage`. |
| `customizer_template_versions` (published) | read policy looks the draft row up with the caller's privileges | same visibility (public, active, enabled products; admins all) through the new definer function `customizer_template_is_public(uuid)`, which returns only true/false |
| `contact_messages`, `newsletter_subscribers` | `anon` may INSERT directly (bypassing the API's validation and rate limits) | public insert policies dropped; INSERT revoked from anon/authenticated. `/api/contact` and `/api/newsletter` write with the service role and are unaffected. |
| Data | — | **none changed** (no INSERT/UPDATE/DELETE of rows) |

It depends only on `public.is_admin()`, `products`, `product_customizer_templates`,
`customizer_template_versions`, `contact_messages`, `newsletter_subscribers` —
all present in production (probe). It is idempotent.

**Application impact, checked in the code:** every read of drafts, versions,
contact messages and newsletter sign-ups goes through the service role
(`lib/products`, `lib/customizer/store.ts`, `lib/customizer/versions.ts`,
`app/api/customizer/assets/sign`, `lib/messages`, `lib/newsletter`), which
RLS and these revokes do not affect. No browser code reads these tables.

## Local verification (done)

`lib/database/__tests__/public-surface-migration.test.ts` — real PostgreSQL 17
with Supabase's default privileges, schema = every migration before this one
(= production), seeded drafts, published versions, draft/hidden products:
**6/6 PASS** (2026-10-10). It first reproduces the production finding, then
applies the file twice and proves: no guest/customer/designer reads a draft;
published versions stay readable for public active products only; admins keep
drafts and versions; the service role reads/writes drafts, contact messages
and newsletter sign-ups; direct anonymous/customer inserts are refused; data
fingerprint unchanged. Also covered: `rls-authorization-matrix.test.ts`,
`supabase-grants-fidelity.test.ts` (full migration chain).

## Procedure (each step needs the owner present)

1. **Approval** of this change and a maintenance note (no downtime expected).
2. **Backup first.** Either a verified `backup:run` (PRODUCTION_BACKUP_STRATEGY.md)
   or, at minimum, confirm in Supabase → Database → Backups that a backup from
   today exists. Do not proceed without one.
3. **Preflight (read-only)** in the production SQL editor:
   ```sql
   select to_regprocedure('public.customizer_template_is_public(uuid)') is not null as already_applied;
   select to_regprocedure('public.is_admin()') is not null as dependency_ok;
   select tablename, policyname, cmd from pg_policies
    where schemaname = 'public' and tablename in ('product_customizer_templates','customizer_template_versions','contact_messages','newsletter_subscribers')
    order by 1, 2;
   select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated')
      and table_name in ('product_customizer_templates','contact_messages','newsletter_subscribers')
    group by 1, 2 order by 1, 2;
   ```
   Expected: `already_applied = false`, `dependency_ok = true`, and the
   policies `customizer_templates_public_read_active`,
   `contact_messages_public_insert`, `newsletter_public_insert` present. Save
   the output (it is the rollback reference).
4. **Apply** — paste, as ONE transaction:
   ```sql
   begin;
   -- contents of supabase/migrations/20261007150000_rls_public_surface_hardening.sql
   commit;
   ```
   (The repository's `staging:migrate` runner cannot be used: it refuses
   production project refs by design.)
5. **Post-checks:**
   - `npm run probe:schema -- --env .env.local` → `"ok":true`.
   - Anonymous read regression (publishable key): `GET /rest/v1/product_customizer_templates?select=id`
     → 401/permission denied; `GET /rest/v1/customizer_template_versions?select=id`
     → rows (published versions of public products).
   - Rerun the step 3 queries: the three policies are gone, `anon` has no
     SELECT on drafts and no INSERT on contact/newsletter.
   - Site smoke test: a product page and its personalize page open for a
     guest; the Customer Customizer loads the published design; an admin
     opens the Design Studio and saves a draft; the contact form and the
     newsletter sign-up succeed.
6. **Record** date, operator and results in the launch checklist.

## Rollback / forward recovery

The migration only removes access, so a rollback is needed only if an
unforeseen path depended on the public read. Prefer a forward fix (grant the
specific access a reviewed migration needs). Emergency restoration of the
previous behaviour (re-opens the vulnerability; owner approval required):

```sql
begin;
create policy "customizer_templates_public_read_active" on public.product_customizer_templates
for select using (public.is_admin() or (enabled and exists (
  select 1 from public.products p where p.id = product_id and p.status = 'active' and p.visibility <> 'hidden')));
grant select on public.product_customizer_templates to anon;
drop policy if exists "customizer_template_versions_read" on public.customizer_template_versions;
create policy "customizer_template_versions_read" on public.customizer_template_versions
for select using (public.is_admin() or exists (
  select 1 from public.product_customizer_templates t join public.products p on p.id = t.product_id
   where t.id = template_id and t.enabled and p.status = 'active' and p.visibility <> 'hidden'));
create policy "contact_messages_public_insert" on public.contact_messages for insert with check (true);
create policy "newsletter_public_insert" on public.newsletter_subscribers for insert with check (true);
grant insert on public.contact_messages, public.newsletter_subscribers to anon;
commit;
```
The function `customizer_template_is_public` may stay (it is harmless). No
data restore is ever needed for this migration.
