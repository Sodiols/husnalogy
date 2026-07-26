# Husnalogy Customizer V2 Deployment

## 1. Freeze and back up

Record the release commit and target Supabase project. Follow
`CUSTOMIZER_DATABASE.md` to create logical schema/data dumps, Storage manifests
and object copies, then prove the backup by restoring to an isolated database.
Never run migration or seed commands until the target is explicitly confirmed
as local or staging.

## 2. Regenerate checked-in contracts

```powershell
npm ci
npm run generate:customizer:schema
npm run generate:customizer:types
npm run audit:customizer
npm run validate:customizer:database
```

The checked-in type snapshot is generated from the canonical SQL so local work
does not need production credentials. Before production, generate the complete
live-project types with the Supabase CLI and reconcile intentional differences:

```powershell
npx supabase gen types typescript --project-id <confirmed-project-id> --schema public | Out-File -Encoding utf8 lib/supabase/database.types.ts
```

## 3. Apply additive migrations

Apply migrations chronologically to an isolated restore and then staging. For a
CLI-linked, confirmed project use `npx supabase db push`; alternatively apply
the new migration with `psql` under an administrator-controlled connection.
Do not execute `supabase/customizer_v2.sql` over an existing database: it is the
fresh-environment canonical install surface after core prerequisites.

Run the live validator read-only:

```powershell
$env:CUSTOMIZER_DATABASE_URL='<local-or-staging-postgres-url>'
npm run validate:customizer:database
```

The validator checks tables, columns, indexes, RLS, policy names, validated
foreign keys, orphan references, duplicate active drafts/publications, and
Storage objects referenced by ready rows.

## 4. Verify Storage and services

Confirm these buckets and their policies: private `customer-uploads`, private
admin-managed `customizer-elements`, public/admin-managed `product-mockups`, and private
service-written `customizer-renders`. Configure `RENDER_WORKER_SECRET`, the
render worker/scheduler, Supabase URL/keys, and the normal application secrets.
Never expose service-role or render-worker secrets to browser code.

## 5. Run release gates

```powershell
npm run validate:fonts
npm run validate:customizer:database
npm run typecheck
npm run lint
npm test
npm run test:e2e:public
npm run test:e2e
npm run build
```

The seeded Playwright suite requires a confirmed staging fixture manifest and
credentials. A missing fixture is a release blocker, not a pass. Verify desktop
and mobile customer flows, admin publish, restore, cart, private asset ownership,
PNG/PDF/mockup outputs, and immutable order snapshots.

## 6. Stage flags and observe

Enable the core flag for one internal product, then customer layers, selection,
grouping, QR, shapes, lines, frames, grids, filters, mockups, product-preview
editing, split view, server rendering, and print PDF in small steps. Monitor save
rejections, preflight, render leases/retries, output checksums, and audit logs.
Promote only after the staging gates pass. Use `CUSTOMIZER_ROLLBACK.md` for any
regression.
