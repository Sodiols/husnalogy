# Print quality audit — design pipeline (2026-10-09)

Stage 1 of the high-fidelity task. Everything below was read from the code or
measured with the project's own libraries (sharp 0.35.5, @resvg/resvg-js) on
this machine. Live data was only read (counts and sizes), never changed.

## 1. The pipeline as it is

| Step | Code | What happens to quality |
|---|---|---|
| Admin/designer upload | `app/api/admin/customizer/assets/route.ts` | Original stored **byte for byte** (`assets/<id>/original/<name>`), SHA-256 of those bytes in `customizer_assets.checksum`; editor (≤ `ASSET_EDITOR_MAX_PX`) and thumbnail variants built with sharp: EXIF orientation applied, converted to sRGB, metadata stripped. SVG is sanitized first and the sanitized file is the stored original. |
| Customer upload | `app/api/customizer/upload/route.ts` | The stored "original" is **re-encoded**: rotated, metadata stripped (colour converted to sRGB), JPEG re-compressed at quality 95 (PNG/WebP lossless). The recorded `checksum` is of the uploaded bytes, which are **not** what is stored. Width/height returned and stored are the **unrotated** values. |
| Editing (both editors) | `lib/customizer/v2/*`, Konva canvases | Documents store asset references and transform parameters only, never pixels. Editors draw the editor variant. Image placement comes from one shared function, `resolveImageDrawBoxFromTransform` (`image-crop.ts`), used by `AdminCanvas`, `CustomizerPreview`, `CustomizerWorkspace` and the server `svg.ts`. Coordinates are document pixels at the template DPI, independent of screen zoom. |
| Draft / publish / snapshot | `store.ts`, `versions.ts`, `snapshot-compose.ts` | Template versions are immutable; order snapshots pin the exact version and the original asset bytes. |
| Production render | `lib/customizer/v2/server/render.ts` | Page → deterministic SVG (`svg.ts`) → **resvg** → PNG at the canvas size + bleed. Print jobs inline the **original** asset bytes (`assetVariant = "original"`). Fonts: the exact Google Font files, no system fonts, a missing font fails the job (no silent substitution). |
| Print PDF | `buildPrintPdf` (same file) | Page size = trim + bleed in points from inches; each page is **one embedded PNG** — text and shapes are rasterized at the template DPI. |
| Mockups | `server/mockup-render.ts` | sharp compositing of the rendered pages onto admin mockup images. |

## 2. Answers to the required questions

| Question | Answer |
|---|---|
| Are originals stored? | Admin: yes, unchanged, hashed. Customer: **no** — a re-encoded copy is stored (§3 D3). |
| Compressed/resized on upload? | Only previews. Originals are never resized. Customer JPEG originals are re-compressed (q95). |
| Do previews replace originals? | No. Separate storage paths; documents reference assets, not preview URLs. |
| Does serialization lose quality? | No. Only references and transform numbers are saved. |
| Does production use originals? | Yes for print PNG/PDF (and snapshots pin them). Previews/mockups use editor variants by design. |
| Text vector or raster? | Raster in every output (resvg PNG; the PDF embeds that PNG). |
| PDF vector or image? | Image: one full-page raster per page at the template DPI, correct physical size incl. bleed. |
| Does any conversion degrade photos? | Customer JPEG re-compression (q95, small). Rasterization resamples photos to the output grid (inherent to a raster PDF). |
| EXIF orientation respected? | Editors: yes. **Production: no** for originals that carry an orientation tag (§3 D1). |
| Colour profiles? | Previews and customer originals are converted to sRGB. **Production ignores embedded profiles** of admin originals (§3 D2). Output PNG/PDF are untagged sRGB; no CMYK conversion; no PDF/X. |
| Crop/mask reproduced accurately? | Same draw-box and mask-path functions in browser and server; covered by `image-crop-render.test.ts`, `parity.test.ts`, `e2e/render-parity.spec.ts`. |
| Same geometry Admin vs Customer? | Yes — shared `svg.ts`, `image-crop.ts`, `text-layout.ts`, `masks.ts`. |
| Coordinates independent of screen? | Yes — document pixels at template DPI; zoom is a view transform (`zoom.ts`, `zoom.test.ts`, `canvas-fit-zoom.test.ts`). |
| Fonts browser vs production? | Same Google Font files; server measures with the real font metrics (opentype.js); missing fonts fail the render. |
| Page size → print units? | Raster = canvas px + bleed px; PDF pt = (inches + bleed px ÷ DPI) × 72. Consistent only when canvas px = inches × DPI — the settings screen derives it and warns, but **publishing does not check it** (§3 D6). Live templates: both exactly 300 px/in. |

## 3. Proven defects

| # | Defect | Evidence | Severity |
|---|---|---|---|
| D1 | resvg ignores EXIF orientation. A photo stored sideways with an orientation tag (every portrait phone JPEG) prints **unrotated**, and `preserveAspectRatio` then fits the wrong aspect ratio into the frame. Editors show it upright, so the customer approves a design that is not printed. Affects admin/designer originals (stored unchanged) and any future unchanged original. | 200×100 JPEG, orientation 6, drawn into 100×200: resvg output left=red/right=blue (unrotated); browser/sharp: top=red/bottom=blue. | **Critical** |
| D2 | resvg ignores embedded ICC profiles. Display-P3 (iPhone), Adobe RGB and CMYK photos print with the wrong colours. | P3 JPEG of sRGB (40,200,59): resvg draws (97,197,81); colour-managed: (40,200,59). | **High** |
| D3 | Customer "originals" are not originals: re-encoded (JPEG q95), metadata and profile gone; the stored checksum describes bytes that were never stored. | `upload/route.ts` lines 119–129, 70. | Medium |
| D4 | Customer upload reports unrotated width/height for orientations 5–8 (portrait phone photos), while every stored file is rotated. Grid-slot resolution checks read these numbers. | `upload/route.ts` returns `width, height` from raw metadata. | Medium |
| D5 | The effective-resolution check never runs for photo layers: no caller passes image dimensions, so customers are never told a photo is too small. Its formula also ignores the crop rectangle and contain-fit. Checkout passes `blockOnLowResolution: true`, so simply feeding it dimensions would start **refusing orders**. | `runPreflight` callers: `preflight/route.ts`, `snapshot-compose.ts`, `checkout-customizations.ts` — none pass `imageDimensions`. | High (customer quality) |
| D6 | Publishing does not check that the canvas matches the physical size. A canvas whose aspect ratio differs from the card's is stretched to the PDF page. | `validateCustomizerTemplateDetailed` checks limits only; `buildPrintPdf` scales the PNG to inch-derived page size. | Medium (safeguard) |
| D7 | Mockup base and overlay images are composited with sharp without applying EXIF orientation. | `mockup-render.ts` — no `.rotate()`. | Low (preview only) |

Not defects (checked): previews never replace originals; transforms are
stored, not pixels; print jobs use originals; template versions and order
snapshots are immutable; no font substitution; shared geometry; zoom does not
write geometry.

## 4. Design limits (documented, not changed now)

* **Raster print PDF.** Text and vectors are rasterized at the template DPI
  (300 for the live products) inside a PDF of the exact physical size. A
  vector PDF needs a second renderer (text as glyph outlines, clipping,
  masks, filters, blend modes reproduced in PDF operators) that would have to
  match resvg exactly — the parity risk the brief warns against, a month before
  launch. Recommended as a separate project with its own parity suite.
* **Colour.** Output is sRGB. No CMYK conversion and no PDF/X; printed colour
  will not exactly match a monitor.

## 5. Implementation plan (this task)

1. D1 + D2 + D7: normalize every raster image at render time — apply EXIF
   orientation and convert to sRGB at **full resolution** (in memory; stored
   originals untouched). Untagged sRGB images pass through byte-identical.
2. D3 + D4: customer uploads keep the uploaded bytes as the immutable original
   (private bucket; SHA-256 of exactly those bytes), oriented dimensions.
3. D5: one exact effective-PPI function from the shared draw box and fit mode;
   dimensions supplied to every preflight; warnings by product threshold,
   never blocking unless the product says so; a plain-language warning in the
   Customer Customizer that updates while the photo is resized or cropped.
4. D6: shared print specification (trim, bleed, raster size, PDF page size)
   used by the PDF builder, plus publish checks.
