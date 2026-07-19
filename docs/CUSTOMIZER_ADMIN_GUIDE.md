# Husnalogy Customizer Administrator Guide

## Open the studio

Open a product in Admin, go to **Images & Mockups**, enable the customizer, and
choose **Open Design Studio**. The studio uses Husnalogy's cream, charcoal, and
gold palette and adapts across desktop and larger displays.

## Create a photo grid

1. Choose **Grid** and select an exact 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, or
   16-photo layout, or an editorial, magazine, window, polaroid-inspired, arch,
   or minimal wedding layout.
2. Resize or rotate the whole grid on canvas.
3. Set rows/columns, gap, padding, outer radius, background, and border.
4. For every slot choose its mask, optional default photo, required state, and
   **Customer editable** checkbox.
5. Enable **Keep grid position fixed for customers** when customers should
   replace/crop photos without moving the layout.

Customers can upload, choose or drag a library photo into a slot and use crop,
pan, zoom, rotate, flip, reset, clear, and move-to-slot controls. These changes
autosave and participate in undo/redo.

## Group objects

Shift/Ctrl-click two or more objects and choose **Group**. Groups persist and
can be moved, proportionally resized, rotated, duplicated, hidden, locked,
reordered, or nested. Choose **Ungroup** to restore children without changing
their visible positions. The group panel controls whole-group, permitted-child,
or no customer selection. Customer ungrouping is off unless explicitly enabled.

## Other design tools

- **Text** adds text. Font family, size, weight, colour, spacing, line height,
  alignment, italic, and vertical alignment live in the contextual toolbar.
- **Frame** adds one masked photo area.
- **Shape** supports rectangle, rounded rectangle, circle, oval, triangle,
  polygon, and arch. **Line** supports solid, dashed, and dotted dividers with
  flat/round/square strokes and optional circle/arrow endpoints.
- **QR** adds a local vector QR with URL, colours, quiet zone, error correction,
  module style, opacity, and readability checks. QR generation never calls an
  external service.
- **Elements** opens the searchable, categorized, paginated V2 library.
- **Background** adds a per-page colour/image layer with cover/contain fit.
- **Guide** adds a horizontal/vertical guide. Drag it or set its number,
  lock/hide/delete it as needed. Guides never print.
- **Pan**, **Preview**, Pages, Layers, Fields, Options, and Settings are live.

## Customer permissions

For ordinary layers, **Customer editable** is the single switch: checked
unlocks relevant controls; unchecked locks them. Grid containers and slots have
the fixed-container/independent-photo exception described above. Server
validation repeats these rules and rejects forged changes or uploads outside
the customer's private folder.

## Enable customer capabilities

Open **Settings** in Design Studio. Template switches decide which tools this
specific design offers: customer shapes, lines, frames, grids, QR codes,
backgrounds, grouping, and the Layers panel. The existing per-layer
**Customer editable** checkbox remains the single unlock switch for that
layer; you do not need to check every style/position action separately.

### Restrict customer content and geometry

The **Customer content limits** card in Settings provides optional allowlists
for fonts, colours, shapes, Elements-library IDs, frame masks, grid layouts,
image filters, and pages where customers can insert their own content. Leaving a list empty allows every registered
option. A non-empty list hides other choices and the server rejects forged or
stale requests that attempt to use them.

Use **Objects / page** for the customer-created object limit. Width, height,
rotation, and four page-inset fields constrain inserted and transformed
objects. Values are expressed in print-canvas pixels; `0` means no explicit
size/count limit where noted. Keep at least two strongly contrasting colours
when customer QR styling is enabled so preflight can produce readable codes.

Database rollout flags are a second safety gate. Enable the corresponding
product-scoped flag for Layers, multiselect, grouping, QR, shapes, lines,
frames, grids, image filters, Product Preview editing, and Split View. A tool
appears only when both its template switch and rollout flag allow it. Leave a
flag disabled to stage or roll back that capability without deleting saved
objects.

Use **Position locked for customers** when content/style should remain
editable but movement must stop. Use **Customer interaction disabled** when
the object must have no customer hit target and must stay out of Customer
Layers. These are separate from the administrator's own layer lock.

## Customer Layers and product editing

Enable **Show the customer Layers panel** to expose permitted administrator
layers and customer-created objects. Customers can expand groups and grids,
select slots, arrange permitted layers, rename/lock their own objects, and
enter a group to edit a child. Fully interaction-disabled administrator layers
are never disclosed.

Enable **Product Preview editing** only for published flat mockups with
rectangular or rotated artwork areas. Perspective/cylinder/custom views remain
preview-only; customers use Print Canvas for precise editing. **Split View**
shows both surfaces against one state and is useful for larger tablets and
desktops.

## Create and publish a product mockup

1. Open the **Mockups** tab.
2. Upload/select a base image and add front, back, side-by-side, stacked,
   envelope, detail, or another-angle views.
3. Add one or more artwork areas to each view and map every area to a source
   page. Use the minus/plus controls for placement, size, rotation, and opacity.
4. Enable **Four-corner perspective**, then drag the four numbered canvas
   handles or fine-tune their coordinates. Invalid/self-crossing/zero-area
   quads are rejected instead of approximated.
5. Add ordered shadow, highlight, texture, or foreground overlays. Upload PNG
   or WebP and choose opacity/blend mode.
6. **Save draft** writes normalized scene tables. **Publish mockup** makes a
   new version available to customer server rendering. Legacy JSON remains a
   compatibility read fallback until it is imported.

Mockups are presentation-only. Print artwork stays flat and undistorted.
Four-corner perspective is rendered server-side with real homography. Cylinder
and custom warps remain explicit unsupported modes.

## Preflight and publish

Choose **Publish**. Fix blocking errors such as missing fonts/content, empty
required grid slots, invalid groups/crops, broken assets, unsupported layers,
or blocking image resolution. Review warnings for safe area, small text,
near-threshold resolution, and mockup availability. Publishing creates an
immutable version; existing drafts, cart items, orders, and snapshots keep
their original version.

## Orders and production files

Order administration reads the permanent design snapshot and its preflight,
preview, and render status. Successful output records each page PNG and combined
PDF with bucket/path, size, dimensions, DPI, checksum, engine, template version,
and timestamp. Production files contain no watermark, guides, selection UI,
safe-area marks, or placeholders.

Retry failures through Admin or call
`POST /api/admin/customizer/render/retry` with `{"jobId":"..."}` or
`{"snapshotId":"..."}`. Downloads use short-lived signed URLs; customers
cannot directly access private print files.

## Deployment and rollback

Run all gates in `CUSTOMIZER_V2.md`, apply all additive migrations, configure
the buckets and render worker, then enable the core and customer-parity flags
for selected staging products. To roll back, disable only the affected flag
and use the existing customizer.
Never delete customer uploads, render files, orders, customizations, or
immutable snapshots.
