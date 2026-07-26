# Husnalogy Customizer V2 Rollback

## Immediate application rollback

1. Disable the affected database feature flag at the narrowest scope (product,
   product type, then global). This stops new use while keeping saved documents
   readable.
2. Disable the product customizer only if the whole editor must be withdrawn;
   the standard product/cart path remains available.
3. Stop the render worker if it is producing incorrect files. Do not delete
   queued jobs or output history.
4. Redeploy the last known-good application commit. Prefer a normal revert
   commit on the release branch; do not rewrite shared history.

Starting point for this modernization:
`20bcb4569b2342937b2db1c4b5890cd94a4c26e3` on the original `master` branch.

## Database rollback policy

The modernization migration is additive. Leave new columns, indexes, comments,
triggers, and policies in place when rolling application code back; older code
ignores them. Do not drop Customizer tables/columns, published versions,
customizations, assets, render rows, audit logs, carts, orders, or order
snapshots as a rollback technique.

Restore a database backup only for proven corruption, after freezing writes and
capturing a forensic dump of the current state. Restore into isolation first,
compare row/object counts and checksums, then schedule an approved recovery.
The backup and restore drill is in `CUSTOMIZER_DATABASE.md`.

## Storage rollback

Do not delete customer uploads or production renders. Revoke/disable the faulty
application or worker, preserve bucket contents, and restore missing objects
from the versioned backup copy. Validate owner prefixes and ready-row object
references before reopening traffic.

## Verification after rollback

- Existing V1 and V2 templates open.
- Saved customer designs restore against their recorded version.
- Cart customizations and product-image fallbacks render.
- Order snapshots and checksums are unchanged.
- Private assets remain inaccessible across users.
- The standard test/type/lint/build gates pass on the rollback commit.

Record the flag changes, commits, database decision, Storage actions, validation
evidence, incident time, and approver in the deployment log.
