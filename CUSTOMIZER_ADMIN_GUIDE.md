# Husnalogy Customizer Administrator Guide

## Open and publish a design

Open a product in Admin, choose **Images & Mockups**, enable the customizer,
then select **Open Design Studio**. Save Draft keeps the mutable working row.
Publish runs blocking validation and creates a new immutable version; existing
customer designs, carts, and orders remain pinned to their original version.

## Studio layout

- The command bar provides status, sections, undo/redo, draft save, customer
  preview, and publish.
- Creation tools add text, uploads, photo areas, grids, shapes, lines, QR,
  elements, backgrounds, guides, groups, and page content.
- The property panel shows only controls relevant to the current selection.
  Arrange, filters, and group behavior are collapsible advanced sections.
- The Pages/Layers side panel manages hierarchy, visibility, locks, names,
  duplication, deletion, and ordering.
- Canvas controls provide actual-size/percentage zoom, Fit, snapping, safe
  area, bleed, and preview.

## Customer edit permissions

For a normal layer, **Customer editable** is the single primary switch. When
enabled it applies the safe permission bundle for that layer type; individual
permission checklists are not required. Position lock and interaction-disabled
remain separate deliberate restrictions.

Photo grids are the exception: administrators may keep the grid container fixed
while enabling replacement/crop on individual slots. Required slots are checked
by preflight.

## Layers, groups, and guides

Customer Layers includes search, nested groups, grid slots, visibility/lock
state, rename where allowed, four arrange commands, and guarded drag ordering.
Protected administrator layers are hard ordering boundaries.

Group two or more selected objects to transform them together. Ungroup restores
children without changing their visible position. Guides are administrator
furniture and never appear in print output.

## Fonts, assets, and uploads

Approved fonts are registered in `lib/customizer/v2/fonts.ts` and stored in
`public/fonts`. Add licensed TTF files, update the registry and local font load,
then run `npm run validate:fonts`.

Elements are curated in `customizer-elements`. Customer photos are private and
must stay under the authenticated user's prefix in `customer-uploads`. Do not
paste signed URLs into templates; select/upload assets through the studio.

## Mockups

In Mockups, define one or more views, map artwork areas to source pages, and add
ordered shadow/highlight/texture/foreground overlays. Perspective uses four
validated corners; unsupported cylinder/custom production warps fail explicitly.
Publish creates a new mockup version. Mockups never distort the flat print file.

## Preflight and production

Resolve all blocking errors before publish/order: missing required content,
unavailable fonts/assets, invalid groups/crops/masks, empty required grid slots,
unreadable QR, text overflow, or insufficient resolution. Warnings should be
reviewed but may not block.

Production files are created server-side and stored privately. Order Admin reads
the immutable snapshot, render status, checksums, and signed download links.
Retry through the existing admin render endpoint only after correcting the
reported failure.

The longer feature reference remains in `docs/CUSTOMIZER_ADMIN_GUIDE.md`; this
root guide is the release-operational entry point.
