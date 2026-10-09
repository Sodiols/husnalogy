# Print quality — final corrections and verification (2026-10-09)

Follows [PRINT_QUALITY_AUDIT.md](PRINT_QUALITY_AUDIT.md). Everything here was
measured on this machine (Node 22.23.3, sharp 0.35.5, @resvg/resvg-js,
Chromium from Playwright). Production data was only **read** (row counts,
object downloads, hashes); nothing in production was changed, no worker was
run, nothing was pushed.

## 1. Checksums now describe the bytes actually stored

| Record | Before | Now (new uploads) |
|---|---|---|
| `customer_asset_library.checksum` | SHA-256 of the **uploaded** bytes, while the stored `original` was a re-encode → never matched | SHA-256 of the stored sanitized `original` |
| Customer master | not kept | `metadata.master = { path, checksum, size, mimeType }` — SHA-256 of the exact upload |
| `customizer_assets.checksum` (studio) | SHA-256 of the raw upload = stored original (matched) | SHA-256 of the stored sanitized `original`; master's own hash in `metadata.master` |
| Response / `assetReference.checksum` | upload hash | stored original's hash |

Downstream audit: no code compares a customer reference's `checksum` with
downloaded bytes. Order pinning (`production-assets.ts`) hashes the bytes it
copies and verifies those on every render — unaffected. Studio duplicate
detection now matches **both** the sanitized hash (new rows) and the upload
hash (legacy rows), so re-uploading a legacy file still finds it (tested).

Existing records (read-only check of production, 2026-10-09):

| Library | Rows | Recorded hash = stored object | Notes |
|---|---|---|---|
| Customer | 1 | **0 of 1** | legacy re-encoded original; left unchanged (item 4); no metadata `originalPolicy` → identifiable as legacy |
| Studio | 14 | 14 of 14 | 0 with EXIF, 0 with GPS, 0 with an orientation tag, 1 with an ICC profile |

## 2. Effective PPI uses the real print density

`effectiveImagePpi` now takes the page's **measured** pixels per inch
(`canvas px ÷ card inches`, per axis, lower axis wins) instead of the declared
DPI; preflight and the live customer warning both pass it. Regression: a
template declaring 300 DPI on a 1000 × 1400 px, 5 × 7 in canvas (really
200 px/in) — a 1000 × 1250 px photo in a 1000 × 1250 px frame is reported at
**200 PPI** (was 300); preflight flags it against a 250 PPI minimum; the
customer warning agrees; declared-DPI-only would have missed it
(`print-resolution.test.ts`, 5 tests). Publishing still refuses a canvas whose
shape differs from the card (stretch) and warns on a density mismatch.

## 3. One original-image policy for studio and customer uploads

`lib/uploads/master-original.ts`, used by both upload routes:

* **Master** — the exact upload, byte for byte, private bucket, own SHA-256.
  Server-only: its path lives only in row metadata, and every delivery path
  reads path columns from the trusted row — verified that owner, staff and
  production-worker signing never return it.
* **Original** (what production, snapshots, the owner and staff use) —
  sanitized, full resolution: JPEG compressed picture kept byte for byte
  (metadata segments and appended bytes removed, ICC + orientation kept,
  verified pixel-identical — was a q95 re-encode, 39.0 dB PSNR); PNG/WebP
  re-encoded losslessly with ICC profile and 16-bit depth kept.
* **Previews** (editor, thumbnail) — sanitized derivatives as before.
* No browser-reachable file carries camera/GPS metadata (tested by scanning
  every stored object except the master). Deletes remove the master too
  (path accepted only inside the asset's own folder).
* SVG: unsafe markup is never stored, so the sanitized SVG is its master.
* Storage cost: customer and studio raster uploads now store one extra file
  (the master), roughly doubling original storage per photo.

## 4. Existing data preserved

No migration. No Storage object rewritten, moved or deleted. Old rows keep
working: missing `metadata.master` is handled everywhere (delete, signing),
legacy studio originals are still the raw upload and still print correctly
(render-time orientation/colour normalization), legacy studio duplicates are
still detected. Published versions, saved customizations and order snapshots
are untouched; the only template-model addition is the optional
`settings.printQuality`, absent from old documents (serialization unchanged,
tested).

## 5. Verification commands and results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx -y node@22 node_modules/typescript/bin/tsc --noEmit` | **pass** (0 errors) |
| Lint | `npx -y node@22 node_modules/eslint/bin/eslint.js .` | **pass** — 0 errors, 60 warnings, none new (all pre-existing `<img>`/hook warnings) |
| Unit + integration | `npx -y node@22 node_modules/vitest/vitest.mjs run` | **pass** — 2,954 passed, 25 skipped; 204 files passed, 3 skipped (hosted staging; backup drill without PostgreSQL 17 tools; visual parity, run separately below) |
| Production build | `next build --webpack` from a same-drive copy with `NEXT_PUBLIC_SITE_URL=https://husnalogy.com` | **pass** — compiled in 58 s, 56/56 pages |
| Visual parity | `HUSNALOGY_VISUAL_PARITY=1 npx vitest run lib/customizer/v2/__tests__/visual-parity.browser.test.ts` | **pass** (§6) |
| Playwright (stub mode, Chromium, 1 worker) | all 65 spec files except the 10 that need a seeded staging project | **420 passed, 2 failed, 1 skipped** of 423 (57.5 min). Both failures re-run green: `customizer-crop-matrix` › rapid crop changes (passed on re-run with its whole spec), `seo-metadata` › contact form network failure (passed); a different contact-form test then failed once on a 15 s `/thank-you` redirect wait and the whole `seo-metadata` spec passed 21/21 twice more — flaky dev-server compilation, contact form untouched by this work. Skipped: `image-optimizer` (needs real catalogue images). |
| New browser spec | `e2e/customizer-photo-quality.spec.ts` | **2/2 pass** — warning shown for a 400 × 300 photo in the 560 px frame (≈ 161 PPI), absent for 4000 × 3000 |

Note: the Playwright run compiled the working tree, which at the time also held another session's uncommitted toolbar/colour-input edits (not part of this work and not committed here); none of the failures were in those areas.

## 6. Visual comparisons — editor (Chromium) vs production (resvg)

Same page SVG; browser side uses each photo's editor variant (what both
editors draw), production side the original through render-ready
normalization + resvg; byte-identical fonts; Chromium with sRGB output,
grayscale antialiasing, no hinting. Images and `visual-parity.json`:
[validation/2026-10-09-print-quality/](validation/2026-10-09-print-quality/).

| Fixture | Mean abs. error (0–255) | PSNR | Pixels within 32 levels | Before the fix |
|---|---|---|---|---|
| Portrait phone photo (EXIF orientation 6) | 0.68 | 48.2 dB | 100 % | MAE 57.8, 10.6 dB, 19.3 % — printed sideways |
| Display-P3 photo (saturated colours) | 1.06 | 43.3 dB | 100 % | MAE 9.4, 22.9 dB, 78.6 % — colours shifted |
| Transparent PNG over a coloured page | 0.22 | 47.1 dB | 99.97 % | — |
| Cropped photo (crop + zoom + offset, arch mask) | 0.41 | 49.4 dB | 100 % | — |
| Small invitation type at 300 DPI: 42, 25, 21, 17 px ≈ 10, 6, 5, 4 pt (Cormorant Garamond regular/italic/semibold, Inter) | 0.91 | 32.5 dB | 99.1 % | — |

Typography: ink bounds within **1 px** (same glyphs, positions and line
breaks); production text carries **4.6 % more ink** (grayscale antialiasing in
tiny-skia vs Skia) — slightly heavier at 4–6 pt, within the 6 % tolerance.
The residual photo error is the editor variant's WebP q88 compression.

## 7. Physical output (print-output-physical.test.ts, print-spec.test.ts)

| Card | PDF page (pt) | Page raster (px) | Embedded image px ÷ page inches | PNG density | Orientation |
|---|---|---|---|---|---|
| 5 × 7 in, 0.125 in bleed | 378 × 522 (5.25 × 7.25 in) | 1575 × 2175 | 300.0 × 300.0 | 300 × 300 ppi (pHYs) | portrait, marker top-left |
| 7 × 5 in, 0.125 in bleed | 522 × 378 (7.25 × 5.25 in) | 2175 × 1575 | 300.0 × 300.0 | 300 × 300 ppi | landscape, marker top-left |

Two pages each, one image per page. New: print PNGs carry their physical
density (`pHYs`, inserted without re-encoding — they used to open at 72 DPI),
and `render_outputs.dpi` records the measured pixels per inch.

**PDF text is rasterized, not vector.** Each PDF page is a single image; the
PDF contains no fonts (asserted). Text and shapes are as sharp as the card's
pixel density (300 px/in for the live products). A vector PDF needs a second
renderer and its own parity suite — not done.

## 8. Remaining limitations

* Raster print PDF (above); no CMYK conversion, no PDF/X; output is sRGB and
  printed colour will not exactly match a monitor.
* Small text prints about 4–5 % heavier than the browser shows (measured).
* The legacy customer asset row keeps its mismatched checksum and re-encoded
  original; it is identifiable (no `originalPolicy`) but not rewritten.
* Legacy studio originals are the raw uploads (none of the 14 carries EXIF/GPS
  today); new uploads follow the policy.
* Admin site-media uploads (`lib/uploads/admin-media.ts`, product photos) are
  outside the customizer pipeline and unchanged (they already strip metadata).
* Per-product print-quality thresholds exist in the model; there is no admin
  screen for them yet (defaults: 300 PPI excellent, 200 PPI minimum, warn only).
* Not run: the 10 seeded Playwright specs and real-Supabase staging tests (no
  staging project); the production worker against real storage.
