# Husnalogy Customizer Administrator Guide

## Open the studio

Open a product in Admin, go to **Images & Mockups**, enable the customizer, and
choose **Open Design Studio**. The studio uses Husnalogy's cream, charcoal, and
gold palette and adapts across desktop and larger displays.

## Create a photo grid

1. Choose **Grid** and select a 2, 3, 4, 5, 6, 8, or 9-photo layout.
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
  polygon, and arch. **Line** supports solid, dashed, and dotted dividers.
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
the buckets and render worker, then enable the seven V2 flags for selected
staging products. To roll back, disable flags and use the existing customizer.
Never delete customer uploads, render files, orders, customizations, or
immutable snapshots.
