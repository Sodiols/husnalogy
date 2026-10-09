# Customizer Stabilization Report

Tracking document for the 19-task Admin Customizer stabilization audit (started 2026-10-08).

Statuses: **CONFIRMED FIXED**, **ALREADY CORRECT AND VERIFIED**, **BLOCKED**, **NOT VERIFIED**.

Environment: Windows 11, Node 22.23.3 via `npx -y node@22` (machine default is Node 24; `package.json` pins 22.x).
Browser tests run in the repository's isolated stub mode (`playwright.config.ts`: dead Supabase at 127.0.0.1:54399,
`NEXT_DIST_DIR=.next/e2e-stub`, port 3105). Nothing in this work touched the Supabase project in `.env.local`, which is
treated as production.

---

## Task 01 — Page background removal — CONFIRMED FIXED

- **Initial condition:** The Pages panel's "Remove background image" patched only `{ backgroundImage: "" }`. The Background
  panel cleared `backgroundImage` and `backgroundAssetId` but left `bucket`, the storage paths, and the runtime fields
  that server hydration copies onto the page (`assetId`, `thumbnail`, signed URLs).
- **Reproduction:** `lib/customizer/v2/__tests__/page-background.test.ts` › "the old URL-only removal really did bring it
  back": a template whose page has `backgroundImage: ""` but keeps `backgroundAssetId` is saved, then re-hydrated by
  `hydrateAdminAssetUrls` — the background URL is re-signed back onto the page. `CustomizerPreview` also draws a
  background whenever `backgroundAssetId` is present, so the studio, customer preview and production render (which
  hydrates the original by identity) all showed the "removed" picture again.
- **Root cause:** No single command owned a page background; each panel patched a different subset of the fields.
- **Fix:** `lib/customizer/v2/page-background.ts` — `PAGE_BACKGROUND_IMAGE_KEYS`, `pageHasBackgroundImage`,
  `setPageBackgroundImage`, `removePageBackgroundImage`. Removal deletes every picture field and keeps the colour;
  setting first clears the previous picture so nothing of it survives a replace. No-op commands return the same
  template (no undo entry, no unsaved flag). The studio exposes `setPageBackground` / `removePageBackground`, which read
  the live template ref (`tRef.current`) so an upload that finishes later cannot roll back intervening edits. Both
  panels call these; the Pages menu now also offers Remove/Replace for id-only backgrounds (recovered designs carry no
  URLs).
- **Files:** `lib/customizer/v2/page-background.ts` (new), `AdminDesignBuilder.tsx`, `AdminPagesPanel.tsx`,
  `AdminBackgroundPanel.tsx`.
- **Tests added:** `lib/customizer/v2/__tests__/page-background.test.ts` (13), `e2e/admin-page-background.spec.ts`
  › "Removing a page background" (2).
- **Tests executed:** unit 13/13 pass; browser: Front+Back backgrounds set, Front removed from its card menu → canvas
  draws no picture, saved page has none of the picture keys, colour kept, Back untouched; Undo restores the exact
  identity and paths; Redo removes again; reload (server re-sign path) keeps it removed; customer preview shows no
  picture; Background-panel removal on Back keeps Front. Existing `admin-background-uploads.spec.ts` (8) and
  `admin-layers-pages.spec.ts` (5) still pass. Server SVG output asserted at unit level (`buildPageSvg`).
- **Remaining risk:** Designs saved *before* this fix with the URL-only removal still carry the stale
  `backgroundAssetId`; they will show that background again on open (it cannot be distinguished from a recovered
  id-only background). Removing it again now removes it for good.

## Task 05 — Background upload failures — CONFIRMED FIXED

- **Initial condition:** The Pages panel called `uploadBuilderImage` without a `catch` (an unhandled rejection, no
  feedback) and with `accept="image/*"` although the server takes only JPG/PNG/WebP. The Background panel showed
  "Uploading…" and a raw error string with no retry. Neither distinguished network, auth, size, format or storage
  failures.
- **Fix:** `lib/customizer/v2/upload-failure.ts` classifies failures (`unsupported-format`, `too-large`,
  `invalid-image`, `network`, `auth`, `storage`, `server`, `cancelled`) with actionable text and a retryable flag, and
  pre-checks type/size before any bytes are sent. `uploadBuilderImage` rejects with a typed `AssetUploadError`.
  `use-background-upload.ts` (shared by both panels) tracks uploading (with %), processing, failed; applies the page
  change only after success; ignores a stale earlier upload; keeps the file for Retry. `BackgroundUploadStatus.tsx`
  renders progress or the failure ("The current background was not changed.") with Retry/Dismiss.
- **Files:** `lib/customizer/v2/upload-failure.ts` (new), `builder-utils.ts`, `use-background-upload.ts` (new),
  `BackgroundUploadStatus.tsx` (new), `AdminPagesPanel.tsx`, `AdminBackgroundPanel.tsx`.
- **Tests added:** `lib/customizer/v2/__tests__/upload-failure.test.ts` (5); `e2e/admin-page-background.spec.ts`
  › "Background upload failures" (4).
- **Tests executed:** unit 5/5; browser: HTTP 500 storage failure, network abort and 401 each show the reason, keep the
  previous background, add no undo step (Undo goes straight past the earlier pick) and leave the design not unsaved;
  Retry after 500/network applies the new upload; 401 offers no Retry; a GIF is refused before any request; upload from
  the Back card shows progress on that card and applies to Back only.

## Task 02 — Page-specific safe area — CONFIRMED FIXED

- **Initial condition:** The studio canvas, customer workspace, `CustomizerPreview`, selection geometry, snapping, text
  layout (`templateSafeBounds`) and the server SVG (`buildPageSvg`) all read `template.safeArea`. Print preflight reads
  the canonical document's `page.safeArea` (`templateToDocument`: the page's own, else the template's). The legacy page
  normalizer (`normalizeCustomizerPage`) silently dropped `page.safeArea`, and publishing (`templateFromVersionSnapshot`)
  flattened every page to the first page's area.
- **Reproduction:** `page-safe-area.test.ts` › "preflight checks each page against its own safe area": a box inside
  Front's 90 px margin but outside Back's 300 px margin is flagged only on Back by preflight, while the editor used the
  template's area for both pages.
- **Root cause:** No canonical resolver; nine call sites computed bounds from the template.
- **Fix:** `lib/customizer/v2/safe-area.ts` — `resolvePageSafeArea` / `pageSafeBounds` / `pageSafeInsets` /
  `setPageSafeArea` (document px only; zoom never enters). Every consumer now resolves per page: `AdminCanvas`
  (text bound + snapping), `AdminDesignBuilder` (relayout + selection geometry), `CustomizerPreview` (wrap + guide),
  `CustomizerWorkspace`, `personalize-client`, `text-layout.templateSafeBounds(template, pageId)`, `svg.ts`.
  `normalizeCustomizerPage` keeps a page's own area; publishing keeps each page's area when it differs from the first;
  validation checks each page's area; orientation change fits inside the tightest page area; DPI changes scale page
  areas (already supported). Template Settings gained a scoped "Safe area applies to: All pages / <page> only" selector
  with "Use the all-pages safe area" to return a page to inheriting (no new panel). Bleed/decorative objects are never
  modified — the safe area bounds only auto-width text growth and preflight warnings.
- **Files:** `lib/customizer/v2/safe-area.ts` (new), `text-layout.ts`, `svg.ts`, `artboard.ts`,
  `lib/customizer/index.ts`, `lib/customizer/versions.ts`, `AdminCanvas.tsx`, `AdminDesignBuilder.tsx`,
  `AdminTemplateSettings.tsx`, `CustomizerPreview.tsx`, `CustomizerWorkspace.tsx`, `personalize-client.tsx`.
- **Tests added:** `lib/customizer/v2/__tests__/page-safe-area.test.ts` (12: 5×7, 7×5, 3.5×5, 5×3.5; editor box vs
  server SVG line count per page; preflight per page; normalize → document → publish round trip; validation; DPI and
  orientation). `e2e/page-safe-area.spec.ts` (2): Front wraps at 1350 px, Back at 900 px; zoom 50/200/100 identical;
  save/reload; Customer Preview identical per page; a Settings-scoped Front area changes only Front, "inherit" restores
  it, Undo brings the override back.
- **Tests executed:** unit 12/12; browser 2/2. Regressions `text-safe-width`, `text-auto-width`, `admin-text-growth`,
  `customizer-text-growth`, `artboard-orientation`, `admin-orientation-controls`, `customizer-card-sizes`: 24/25 in the
  first run; the one failure was an HMR reload caused by my own edit to the builder during the run (re-run recorded
  under Task 18).
- **Remaining risk:** A template with no `safeArea` at all is treated as zero insets by the editors and renderers but
  as 90 px by `templateToDocument` (its migration default). Every saved template passes `normalizeCustomizerTemplate`,
  which fills 90 px, so only hand-built fixtures are affected. Per-page *sizes* (`page.widthPx`) are honoured by the
  resolver, but the studio canvas still draws every page at the template size (pre-existing; legacy pages carry no
  size).

## Task 03 — New-design autosave — CONFIRMED FIXED

- **Initial condition:** Autosave ran only when the product had an id. A new product's work lived only in the
  browser's recovery copy until a manual Save Draft, and the header showed "Unsaved"/"Autosaving" only above 1280 px.
  An autosave failure was silent in the studio (the error went to the product form hidden behind it) and was not
  retried until the next edit; there was no offline state.
- **Fix:**
  - A named new product is created on the server as a **draft** by autosave (the same request as Save Draft; status is
    not sent, so the server makes it `draft`; drafts are excluded from every customer read — `lib/products` requires
    `status === "active"`). Without a name nothing is sent and the header says **Local only** with what is needed.
  - `describeStudioSaveStatus` (lib/customizer/studio-save.ts): **Saved** only after server confirmation; **Unsaved**
    stays until the server confirms (never cleared by merely sending); **Saving…**, **Local only**, **Save failed**
    (reason + "kept on this device", Retry now) and **Offline** are shown beside it. The chips render at every width;
    an alert line under the header explains problems.
  - Failed saves (autosave, Save Draft, or the save before a publish) retry with backoff 5 s / 15 s / 30 s / 60 s;
    validation refusals wait for the next edit; going offline suspends autosave and reconnecting saves at once.
  - Race hardening: the product form resolves create-vs-update from a ref set the moment the creation returns
    (`persistedIdRef`). Verified finding: through the UI this duplicate POST is already prevented, because Save Draft is
    disabled while the form's save is in flight (the race test still passed with the ref change reverted) — so the ref
    is defence-in-depth, not a demonstrated fix. Only the revision a request sent is marked clean (existing
    `RevisionTracker`), so an older response never marks newer edits as saved.
- **Superseded test:** `admin-studio-recovery.spec.ts` › "a new product is never created by autosave" encoded the old
  rule this task replaces; it is now "a named new product is created on the server as a draft by autosave — never
  published — then updated in place", plus "a new product without a name is never sent: it stays Local only".
- **Files:** `lib/customizer/studio-save.ts`, `AdminDesignBuilder.tsx`, `AdminBuilderHeader.tsx`,
  `product-upload-form.tsx`.
- **Tests added:** `lib/customizer/__tests__/studio-save-status.test.ts` (9); `e2e/admin-studio-recovery.spec.ts`:
  new product → POST draft (no status) → Saved → next edit PUT same id → nothing left in local recovery → another
  session (fresh tab with only server data) opens the same layers; unnamed product never sent, Local only + reason,
  local copy kept; failed autosave → Save failed with reason → retried without an edit → Saved; offline → Offline, no
  request for 6 s, reconnect → saved; first autosave in flight + Save Draft → one product.
- **Tests executed:** unit 18/18 (`studio-save*.test.ts`); browser `admin-studio-recovery.spec.ts` 11/11.
- **Remaining risk:** Two different tabs editing the same product still last-write-win on the draft (publication is
  revision-pinned; the draft save is not). Unchanged here.

## Task 04 — Right-click selection for groups — ALREADY CORRECT AND VERIFIED (code path unified)

- **Initial condition:** In the shared `CustomizerInteractionStage` a left press resolves the hit node through
  `resolveSelectionTarget` (a member → its group unless the group is entered), while the right-button press and the
  `onContextMenu` event used the raw Konva `node.id` — two different resolution rules.
- **Reproduction attempt:** The reported symptom does **not** occur on today's canvas: neither editor creates a Konva
  node for a group member unless that group has been entered (`selectableLayersForPage` in the studio, the
  interactive-parent filter in the customer workspace), so a right click on a member's pixels already hits the group
  node. My first browser test looked members up by node id and failed for exactly that reason; it now presses the
  member's pixels, as a designer does.
- **Change made anyway (hardening, not a demonstrated fix):** `resolveContextMenuSelection`
  (lib/customizer/v2/interaction/hit-test.ts) gives right click the same target rule as left click, and keeps the
  selection when the target is already in it. Both right-click paths in the shared stage use it, so the two rules can no
  longer drift if member nodes are ever exposed.
- **Tests added:** `lib/customizer/v2/__tests__/context-menu-selection.test.ts` (4, incl. nested groups);
  `e2e/group-right-click.spec.ts` (admin: member → group both ways, menu Duplicate duplicates the group with Undo/Redo;
  multi-selection kept; inside an entered group the member is targeted and Hide hides only it; customer: member →
  group both ways).
- **Tests executed:** unit 4/4; browser 4/4 (pressing members' pixels); existing `admin-context-menu` (8),
  `admin-selection-groups` (1) and `customizer-context-menu` (12) pass. Two source-pinning assertions in
  `context-menu.test.ts` were updated to the new (equivalent) call.

## Tasks 09–14 — Verify tasks

These were "verify" items: the existing browser and unit suites were run (see Task 18 for counts) and gaps were
filled with new tests. Results per task:

- **09 Selection, dragging, resizing, rotation — ALREADY CORRECT AND VERIFIED.** Existing specs cover one commit per
  drag/resize/rotation gesture (`admin-canvas-interaction`), rigid multi-object drags of text+images incl. a rotated
  one and a group at several zoom levels (`admin-multi-drag`), selection rules incl. marquee, Shift-click, locked
  layers (`admin-selection-matrix`, `customizer-selection-matrix`), and Escape/pointercancel/blur cancellation that
  restores exactly (`customizer-gesture-cancellation`). New `admin-history-matrix.spec.ts` additionally proves a drag,
  a resize and a rotation are each exactly one undo step. No flicker/snapback defect reproduced.
- **10 Automatic text width — ALREADY CORRECT AND VERIFIED.** `text-auto-width` (17 pt default, box hugs the words),
  `text-safe-width` ("hi hi hi how are you" stays one line; wraps at words only at the safe area; zoom 50/200/100
  identical; manual side resize becomes fixed width; Undo/Redo; save/reload), `admin-text-growth` /
  `customizer-text-growth` (Up/Center/Down anchors, rotated text). Task 02 made the limit page-specific; Task 17 made
  the server's wrapping match the editor's.
- **11 Crop, replacement, masks — ALREADY CORRECT AND VERIFIED (coverage extended).** Existing: crop Cancel/Done/Reset,
  zoom, pan, rotate, flip, frames, grid slots, 200 % zoom, touch (`customizer-crop-matrix`, `admin-crop`,
  `admin-crop-button` incl. after orientation change/resize/rotation/duplicate); masks with move/resize/rotate, crop
  inside a mask, duplicate/copy-paste, published render (`customizer-clipping-mask`, `customizer-admin-mask`,
  `admin-clipping-mask`). Added `mask-shape-matrix.test.ts` (17): rectangle, rounded rectangle, circle, ellipse,
  heart, arch, star and rounded star, each in both selection orders with a rotated shape and a cropped photo — one
  clipped photo, crop kept, mask saved, server outline identical. `render-parity.spec.ts` compares masked/cropped
  photos between the client and server renderers.
- **12 Long-session image rendering — ALREADY CORRECT AND VERIFIED.** `admin-asset-reliability` and
  `customizer-asset-reliability`: renewal past the signing period without blanking or dirtying, already-expired URLs,
  404/corrupt/thumbnail-sized editor variant → sharp original (reported), recovery restores identities not stale URLs,
  dropped connection keeps the picture and renews on reconnect. Task 06 extended this to library thumbnails.
- **13 Undo/Redo — ALREADY CORRECT AND VERIFIED (new matrix).** `admin-history-matrix.spec.ts`: nudge, drag, resize,
  rotate, delete, duplicate, group, bring to front, align, font size (text geometry), page background colour and
  orientation — for each, ONE Undo restores the exact saved document AND the exact drawn canvas markup, and ONE Redo
  reproduces the command's result exactly. Finding (not a defect): consecutive arrow-key nudges are separate undo
  steps (one per key press). Existing specs cover crop, mask, layer drag-reorder, page add/duplicate/rename/delete,
  background image, text style changes and recovery restore as one step.
- **14 Toolbars and panels — CONFIRMED FIXED (two small defects).** `admin-toolbar-responsive` and
  `admin-panels-responsive` iterate exactly 1280×720, 1366×768, 1440×900, 1536×864 and 1920×1080 across text, image,
  shape, line, multi, group, mask and crop states with the side panel open. Two defects at 1280: (a) the text toolbar
  overflowed by 3 px with a side panel open (the compact font picker is now 8 px narrower); (b) my Task 03 save chip
  was clipped under the section tabs (Published/Active chips now show from 1536 px; the save state shows at every
  width). The narrow-workspace test's premise ("1024 px must scroll") was outdated — the bars now fit there — so it
  checks that the bar fits at 1024 and exercises the scroll buttons with a side panel open, where it genuinely
  overflows. `forbidden-controls.test.ts` guards against any Effects or Remove BG control; the Eraser remains.

## Task 06 — Uploads thumbnail recovery — CONFIRMED FIXED

- **Initial condition / root cause:** `AdminUploadsPanel`'s tile set `failed = true` on the first `<img>` error and
  never reset it: the flag survived the row receiving a fresh signed URL, so an expired link stayed a grey box for the
  rest of the session. There was no re-sign, no fallback preview and no retry; the media manager had the same tile.
- **Fix:** `lib/customizer/v2/library-thumbnail.ts` (preview candidates thumbnail → editor → url, a source key, a
  re-sign schedule that ignores already-lapsed links so it cannot loop, in-place merge of re-signed rows) and
  `LibraryThumb.tsx` (failure state keyed to the URLs it had — a re-signed row starts over; loading placeholder;
  fallback through the candidates). The panel re-signs its loaded rows 60 s before the earliest expiry (never more often
  than every 15 s), on a tile failure (throttled to once per 20 s) and on Retry (immediate). Retry is a sibling button,
  not nested inside the tile button. Inserting still hands over the asset (identity + editor/original paths), never a
  preview URL. The media manager uses `LibraryThumb` too.
- **Tests added:** `library-thumbnail.test.ts` (5); `e2e/admin-uploads-thumbnails.spec.ts` (3): expired link, 404 and
  undecodable bytes each end in a placeholder with Retry while a good tile draws; after the library re-signs, Retry
  draws the expired one with the new URL; a genuinely missing file stays a placeholder (no loop); inserting a failed
  tile stores identity + editor/original paths and no thumbnail URL; a link about to lapse is swapped for a re-signed
  one without ever failing; three consecutive inserts keep their own identities.
- **Tests executed:** unit 5/5; browser 3/3; existing `admin-background-uploads` (8) passes (one source-pinning
  assertion in `admin-upload-rendering.test.ts` updated to the new equivalent).
- **Not covered:** a 403 from Storage is simulated as the stub's expired-token refusal (status 400 with Storage's 403
  body); slow-network was not separately simulated for tiles.

## Task 07 — Unsaved-change exit protection — CONFIRMED FIXED

- **Initial condition:** Studio "Back to Product" closed immediately, even with unsaved work or a save in flight, and
  autosave stopped once the studio closed. Closing the product form, switching dashboard sections, editing another
  product or signing out unmounted the form with no warning. Only the browser's native unload prompt existed.
- **Fix:** A studio exit dialog: nothing unsaved → closes at once; otherwise **Save and exit** (waits for an in-flight
  autosave, then saves; a failure keeps the studio open with the reason and "Try again"), **Continue editing**, and
  **Discard changes** (restores the last server-confirmed design, clears the recovery copy). When the design cannot
  reach the server yet (new product without a name) Save is not offered; instead **Keep changes and add a name**
  (changes stay in the form and the local recovery copy). Autosave keeps running after the studio closes. The builder
  reports its unsaved state up through the product form; the dashboard asks "Leave without saving the design?" before
  closing the form, switching section, editing/duplicating/adding another product or signing out (Cancel stays; leaving
  keeps the local recovery copy). The native unload prompt is unchanged.
- **Defect introduced and fixed during this task:** the dialog's hooks were first declared after the component's early
  return for a disabled customizer, which crashed the studio ("Rendered more hooks…") when the customizer was switched
  on; caught by the browser suite, fixed by moving them above the return; `studio-exit-guard.test.ts` + the browser
  specs cover it.
- **Files:** `AdminDesignBuilder.tsx`, `product-upload-form.tsx`, `admin-dashboard-client.tsx`.
- **Tests added:** `studio-exit-guard.test.ts` (3); `e2e/admin-studio-exit.spec.ts` (7): no prompt when saved; Continue
  editing; Save and exit; failed save stays open, Try again exits; save in flight waited for; Discard returns to the last
  saved design and clears recovery; unnamed design → keep changes → dashboard asks on Close (Cancel keeps) and on
  section change (leave keeps the recovery copy); saved design closes without prompts.
- **Tests executed:** browser 7/7; existing "leaving with unsaved changes asks first" (native beforeunload) passes.
- **Not covered:** account switching is covered by the existing actor-scoped recovery tests, not re-tested here.

## Task 08 — Transparent line stroke — CONFIRMED FIXED

- **Initial condition / root cause:** `AdminContextToolbar` passed `allowTransparent={!line}` to the line colour
  control. The renderers already draw a `none` stroke on a line as no line and no caps (editor preview and server SVG
  agree), and the customer editor already offered it.
- **Fix:** offer Transparent for a line's colour. A legacy empty stroke keeps its old meaning (falls back to a visible
  colour), so existing designs are unchanged.
- **Tests added:** `line-transparent-stroke.test.ts` (4 — normalization keeps `none` and geometry; server SVG draws
  nothing visible and a colour restores it; legacy empty stroke unchanged; toolbar source); browser test in
  `shape-paint.spec.ts`: Transparent from the toolbar, line still selectable from Layers with weight intact, Undo/Redo,
  copy/paste keeps `none`, a colour restores it, saved draft. Unit test was red before the one-line fix.
- **Tests executed:** unit 4/4; browser `shape-paint.spec.ts` 7/7.

## Task 15 — Layers and Pages performance — CONFIRMED FIXED (measured)

- **Measurement (before):** `e2e/admin-pages-performance.spec.ts` — documents of 2, 10 and 20 pages, each page with
  4 texts, 4 shapes and 3 images, Pages panel open, one committed edit on Front (arrow-key nudge), dev build:

  | Pages | Preview renders / edit | Edit settle (ms) | Page switch (ms) |
  |---|---|---|---|
  | 2 | 6 | 197 | 286 |
  | 10 | 22 | 258 | 323 |
  | 20 | 42 | 421 | 492 |

- **Root cause:** every page card rendered `CustomizerPreview` from the whole template, so each edit redrew every
  page's thumbnail (twice: the commit and the follow-up selection render) — cost proportional to page count.
- **Fix:** `lib/customizer/v2/page-preview-memo.ts` (`pagePreviewUnchanged`: template-wide inputs, the page object and
  that page's layers compared by reference — edits are immutable) and a memoised `PageThumbnail` in `AdminPagesPanel`.
- **Measurement (after), same harness:**

  | Pages | Preview renders / edit | Edit settle (ms) | Page switch (ms) |
  |---|---|---|---|
  | 2 | 4 | 168 | 182 |
  | 10 | 4 | 266 | 287 |
  | 20 | 4 | 219 | 378 |

  Render count is now constant. Millisecond figures come from a dev build on this laptop and are noisy; they are
  indicative only. The spec asserts the render count and that the edited page's thumbnail **does** update (no stale
  thumbnails); `page-preview-memo.test.ts` (3) covers page settings, template-wide inputs and moving a layer between
  pages. Not measured: memory growth over long sessions.

## Task 16 — Background Fit/Fill review — ALREADY CORRECT AND VERIFIED (no new UI)

- A **page** background image is always drawn cover-style (`xMidYMid slice`) by both the editor preview and the server
  SVG. A **Background layer** (the Background panel's "Add background layer") already supports `fitMode`
  cover/contain, rendered identically by both. No new control was added, per the task's scope rule.
- **Tests added:** `background-fit-parity.test.ts` (2).
- **Proposal if wanted:** expose the Background layer's existing Fit/Fill in its toolbar (the image toolbar's Fit/Fill
  pattern) rather than adding a fit mode to page backgrounds — no schema change. Needs product approval.

## Task 17 — Admin / Customer / server rendering parity — CONFIRMED FIXED (one real defect)

- **Harness:** `/__e2e/render-parity` (test-only route, closed in production like the customizer fixture) renders a
  reference design through `CustomizerPreview` (what the studio canvas and the customer editor draw) and through
  `buildPageSvg` (production), in the same browser with the same font bytes. The reference design covers wrapped
  safe-width text, left/right/centre alignment, letter spacing and line height, bold, a serif display face, a manual
  line break, rectangle/oval/line/transparent line, a cropped photo with a circle mask, an arch-masked photo with Fit,
  page background colour and image, and Front/Back with different safe areas, at 5×7, 7×5 and 3.5×5.
  `e2e/render-parity.spec.ts` asserts (1) server text metrics equal the browser's for the same font file, (2) every
  text line (content and position), image placement/fit, clip path and shape attribute matches between the two SVGs,
  and (3) production wrapping in Node (opentype metrics) yields the lines the browser drew.
- **Defect found:** the server measured Inter about 0.7 % wider than the browser ("Together with their families":
  774.43 px vs 768.81 px at 60 px; "AVAT" 162.92 vs 149.62). Root cause: Inter keeps its kerning in a GPOS Extension
  (type 9) lookup, which opentype.js does not parse, and opentype's `getKerningValue` stops at the first lookup — so
  print measurement was unkerned and could wrap a line the editor kept on one line.
- **Fix:** `lib/customizer/v2/gpos-kerning.ts` reads GPOS pair kerning from the font bytes (all `kern` lookups summed,
  Extension subtables resolved, PairPos formats 1 and 2), attached when the server parses a font
  (`server-fonts.ts` for preflight/checkout and `production-assets.ts` for print). After the fix the server's widths
  equal Chrome's to 0.01 px.
- **Tests:** `gpos-kerning.test.ts` (5, including the unkerned reproduction); browser `render-parity.spec.ts` 3/3.
- **Limits:** pixel-level comparison of the rasterised output (resvg PNG vs browser) was not done — text in an
  SVG-as-image cannot use the page's web fonts, so geometry assertions were used instead. Only Latin pair kerning is
  covered; contextual alternates/ligatures that change widths are not modelled (none of the tested fonts' Latin text
  is affected).

## Additional defect found — layers moved to the first page on save — CONFIRMED FIXED

- **Found while building the Task 15 fixture:** `normalizeCustomizerTemplate` keyifies page ids (`inside-left` →
  `inside_left`) but left layers pointing at the original id, then reassigned every such layer to the **first page**.
  The studio itself creates hyphenated ids for repeated labels (`pageIdFromLabel` → `front_copy-2`), and the
  normalizer's own fallback id (`page-3`) was renamed on a second pass — so duplicated/added pages could lose their
  content to Front on save.
- **Fix:** page references (layers, `defaultPage`, guides) follow the id mapping; the studio's duplicate ids and the
  fallback ids use `_` so they are already in stored form (document fallback aligned).
- **Tests:** `lib/customizer/__tests__/page-id-integrity.test.ts` (3: the reproduction, studio-generated ids are
  stable, fallback ids stable across passes).
- **Remaining risk:** designs already saved through the old path have had such layers moved to the first page on the
  server; that data cannot be reconstructed automatically.

## Additional defect fixed — customer text presets could never be applied — CONFIRMED FIXED

- **Initial condition:** recorded in the repository as a known defect (`test.fail` in
  `e2e/customizer-text-editing.spec.ts`): in the customer editor, "Add Heading" / "Add Subheading" / "Add Body Text"
  did nothing.
- **Root cause (traced in the browser):** the inline text editor ends editing on any pointer-down outside itself
  (document capture phase). The Text tool's empty auto-inserted text is then discarded, its "Selected item" controls
  above the preset list disappear, and the list jumps ~490 px up between press and release, so the release lands on the
  panel background and no click fires.
- **Fix:** `app/components/customizer/TextStyleList.tsx` (shared by both Add Text panels) captures the pointer on press
  and applies the style on release when the pointer hasn't moved (>10 px is treated as a scroll); keyboard activation
  still uses click, and a click that follows a handled release is ignored.
- **Tests:** the `test.fail` marker is removed; the test now types into the inserted heading and asserts exactly one
  new object drawn at the heading size (94 px) with no stray empty text. Text specs 12/12 pass.

## Task 18 — Browser regression suite — CONFIRMED (with recorded exceptions)

- **Setup:** repository stub mode (no real Supabase). Isolated server per run (`E2E_PORT`, `NEXT_DIST_DIR`,
  `E2E_STUB_SUPABASE_PORT`), Node 22, Chromium, one worker. The 10 specs that require a seeded non-production Supabase
  (`requireSeededAcceptance`: admin-security-render, checkout-adversarial, checkout-order-integrity,
  customer-customizer, customer-journey-multitab, google-fonts, iconify-elements, staging-shared-browser-privacy,
  storefront-staging, unified-elements) were **not run** — there is no staging project (BLOCKED, see Task 19).
- **Runs:** the full runnable suite is 398 tests in 61 spec files. Part 1 was interrupted after 85 passes when the
  dev server crashed inside Turbopack (its cache in `.next/e2e-stub` lost a file while another agent's Playwright run
  used the same folder and port). Part 2 (every spec from the crash point on, plus the new history matrix) on an
  isolated server: **331 passed, 2 failed, 1 skipped**.
- **Every failure resolved and re-run:**
  - `admin-crop-button` › crop after orientation/resize/rotation/duplicate (part 1, during the instability) — passes
    on re-run (6/6).
  - `admin-panels-responsive` @1280×720 — real 3 px toolbar overflow → fixed (Task 14), 5/5.
  - `admin-recovery-matrix` (part 1 tail) — the server crash; all pass in part 2.
  - `customizer-performance` › 200 layers — failed once under suite load (4 workspace renders during a drag); passes
    in isolation (4/4). Recorded as load-sensitive, not fixed.
  - `svg-recolour` › customer recolour — the spec targeted the pre-restyle inline colour group; the earlier
    uncommitted toolbar restyle made it a popover. Spec updated to the popover (same assertions); 3/3.
  - `customizer-text-editing` › text preset — the known defect above, now fixed; 5/5.
  - `admin-toolbar-responsive` › narrow workspace — outdated premise (bars now fit at 1024 px); exercises scrolling
    with a side panel open instead; 6/6.
- **New specs added in this work (all passing):** admin-page-background (6), page-safe-area (2), admin-studio-exit (7),
  group-right-click (4), admin-uploads-thumbnails (3), render-parity (3), admin-pages-performance (3),
  admin-history-matrix (1, 12 commands), plus additions to admin-studio-recovery (+5), shape-paint (+1).
- **Not run:** WebKit / mobile-safari projects (`webkit-critical.spec.ts`), the seeded specs above, and the mandatory
  Admin → Customer → checkout journey against real accounts (needs staging).

## Task 19 — Staging and deployment — BLOCKED (environment), code-level checks done

- **Not verified:** real Supabase auth/RLS/Storage, Google OAuth, checkout, render worker, email, backups, Hostinger.
  Per the standing decision, the Supabase project in `.env.local` is production and was not used for any test. No
  staging project exists. Nothing here may be marked verified until a dedicated staging environment is tested.
- **Done:** production build passes (`npm run build` steps on Node 22; built in an isolated copy because `next build`
  clears `.next`, which would delete running dev servers' output). `npm audit`: 0 production vulnerabilities;
  `sharp@0.35.5` and `source-map-js@1.2.2` (not the reported 0.35.4 / 1.2.1); 5 high findings all in the dev-only
  ESLint chain (`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`) — not
  force-upgraded. Lint: 0 errors (60 pre-existing warnings, none in new files). `audit:customizer`: 403 files, 0 import
  cycles.
- **Database changes:** none. No migration was added or required; all fixes are application code. Stored documents stay
  compatible (page-id remapping and kerning only change how existing data is read and measured).
- **Deployment notes** (no secrets recorded): Node 22.x, `npm ci` → `npm run build` (needs `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at build time) → `npm start`. The new
  `/__e2e/render-parity` route is closed in production unless `ENABLE_CUSTOMIZER_E2E_FIXTURE=1`, which must stay unset
  live. The full environment, cron, health check, backup and canonical-domain procedures are in
  `docs/HOSTINGER_DEPLOYMENT.md` (moved there by other work in this tree).

---

# Final report

## 1. Executive summary

- **Fixed (with root cause, regression tests, browser verification):** 01 background removal, 02 page safe areas,
  03 new-design autosave and save states, 05 background upload failures, 06 upload thumbnail recovery, 07 exit
  protection, 08 transparent line stroke, 14 two toolbar/header sizing defects, 15 Pages-panel render cost, 17 server
  kerning mismatch — plus three defects found along the way: layers moved to the first page on save, customer text
  presets unusable, and a hook-order crash I introduced and fixed during Task 07.
- **Already correct, verified (coverage added):** 04 (right click — not reproducible; rule unified), 09, 10, 11, 12, 13,
  16 (no new UI).
- **Blocked:** 19 (no staging environment). Task 18's seeded specs and WebKit run are not done.

## 2. Targeted issue results

| ID | Issue | Root cause | Fix | Test result | Status |
|---|---|---|---|---|---|
| 01 | Background removal | Removal cleared only the URL; identity re-signed it back | One page-background command clears every reference | unit 13, browser 2 | CONFIRMED FIXED |
| 02 | Page safe area | Editors/server read template insets; preflight per page; normaliser dropped page insets | `safe-area.ts` resolver used everywhere | unit 12, browser 2 | CONFIRMED FIXED |
| 03 | New design autosave | No autosave without product id; silent failures | Draft created on autosave once named; truthful save states; retries; offline | unit 9, browser 6 new | CONFIRMED FIXED |
| 04 | Group right-click | Two resolution rules (not user-reachable today) | Shared resolver | unit 4, browser 4 | ALREADY CORRECT AND VERIFIED |
| 05 | Background upload errors | Unhandled rejection, no classification | Classified errors, progress, retry, apply only on success | unit 5, browser 4 | CONFIRMED FIXED |
| 06 | Thumbnail recovery | Failure flag never reset | URL-keyed tiles, re-sign, retry | unit 5, browser 3 | CONFIRMED FIXED |
| 07 | Exit protection | Back closed instantly; form/section exits unguarded | Exit dialog + dashboard guard | unit 3, browser 7 | CONFIRMED FIXED |
| 08 | Transparent line | `allowTransparent={!line}` | Allowed | unit 4, browser 1 | CONFIRMED FIXED |
| 09 | Selection/transforms | — | — | existing suite + history matrix | ALREADY CORRECT AND VERIFIED |
| 10 | Text engine | — | (02, 17 tightened it) | existing text specs | ALREADY CORRECT AND VERIFIED |
| 11 | Crop and masks | — | — | existing suite + mask matrix 17 | ALREADY CORRECT AND VERIFIED |
| 12 | Image reliability | — | — | existing reliability specs | ALREADY CORRECT AND VERIFIED |
| 13 | Undo/Redo | — | — | history matrix (12 commands) | ALREADY CORRECT AND VERIFIED |
| 14 | Toolbar responsiveness | 3 px overflow; clipped save chip | Narrower compact font picker; chips gated | responsive specs 11/11 | CONFIRMED FIXED |
| 15 | Layers/Pages performance | Every thumbnail re-rendered per edit | Memoised page thumbnails | renders/edit 42→4 (20 pages) | CONFIRMED FIXED |
| 16 | Background fitting | Page bg = cover; Background layer has Fit/Fill | None (review) | unit 2 | ALREADY CORRECT AND VERIFIED |
| 17 | Renderer consistency | Server ignored GPOS Extension kerning | GPOS kerning reader | unit 5, browser 3 | CONFIRMED FIXED |
| 18 | Browser suite | — | Spec updates noted above | 331 + 85 passed; exceptions above | NOT FULLY VERIFIED (seeded/WebKit not run) |
| 19 | Staging/deployment | — | — | build, audit, lint only | BLOCKED |

## 3. Test evidence

- **TypeScript:** PASS (`tsc --noEmit`, Node 22).
- **Lint:** PASS — 0 errors, 60 warnings (pre-existing).
- **Unit/integration (Vitest):** PASS — 2,826 passed, 0 failed, 13 skipped. (Five deployment-doc tests briefly failed
  after `HOSTINGER_DEPLOYMENT.md` moved to `docs/`; they now read the new path.)
- **Customizer audit:** PASS (403 files, 0 cycles).
- **Playwright (Chromium, stub mode):** 85 + 331 passed across the two parts; every failure re-run and resolved as
  listed; 1 load-sensitive performance test passes in isolation. Seeded specs and WebKit: NOT RUN.
- **Rendering parity:** PASS (`render-parity.spec.ts`, 3 card sizes).
- **Security:** `npm audit` production 0; dev-only ESLint chain 5 high. RLS/Storage on real Supabase: NOT RUN.
- **Production build:** PASS.

## 4. Performance (measured, dev build, indicative)

Pages panel, one edit on Front: preview renders 6/22/42 → 4/4/4 for 2/10/20 pages; page switch 286/323/492 ms →
182/287/378 ms. Customer drag at 20–200 layers: one commit per drag (existing harness). Memory growth: not measured.

## 5. Database changes

None.

## 6. External requirements

A dedicated staging Supabase (auth, RLS, Storage, OAuth), seeded accounts for the 10 seeded specs, a staging checkout
and render-worker run, then Hostinger smoke tests.

## 7. Remaining issues

- **Defects not fixed:** designs saved before the fixes may keep a stale background id (Task 01) or have had layers
  moved to Front (page ids) — not recoverable automatically. Read-only production check 2026-10-09: neither live
  product's draft has a stale background id.
- **Fixed 2026-10-09 (Week 1) — two editors, one draft:** a product save now carries the draft revision
  (`expectedTemplateUpdatedAt`) its editor last loaded or saved. A draft changed since (another tab or person) is
  refused with 409 `conflict` before anything is written; the template write is a compare-and-swap on the stored
  `updated_at`, so a save landing between check and write is caught too. The studio never retries a conflict and stops
  autosaving; the work stays in local recovery; the designer chooses **Keep my version** (explicit overwrite) or
  **Reload to see theirs** (no leave-page prompt; the design is offered back). Files: `lib/customizer/draft-revision.ts`,
  `lib/customizer/store.ts`, `lib/products/index.ts`, `app/api/admin/products/[id]/route.ts`,
  `product-upload-form.tsx`, `AdminDesignBuilder.tsx`, `studio-save.ts`. Tests: `draft-save-conflict.test.ts` (6, real
  schema + trigger, incl. the race), `studio-save-status.test.ts` (+1), `e2e/admin-studio-draft-conflict.spec.ts` (2);
  regression: studio save/publish, recovery and exit specs 24/24.
- **Environment blockers:** staging, seeded specs, WebKit run.
- **Optional:** Fit/Fill toolbar for the Background layer (needs product approval); consecutive arrow nudges are
  separate undo steps (could be coalesced).

## 8. Readiness verdict

- **A. Admin Customizer stable enough for serious design work?** NOT FULLY VERIFIED — every targeted admin defect is
  fixed and the admin browser suite passes in stub mode, but nothing has run against real Supabase/Storage.
- **B. Customer Customizer stable enough for controlled staging tests?** YES — the customer editor's browser suite
  passes in stub mode and its known preset defect is fixed; staging is exactly where it should be tested next.
- **C. Verified for real production customers?** NO — staging, RLS/Storage, checkout and Hostinger are unverified.
