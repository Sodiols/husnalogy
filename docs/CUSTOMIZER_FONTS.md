# Customizer fonts — Google Fonts architecture

The customizer offers the **complete Google Fonts library**. There is no
hardcoded font list, and no customizer font files are bundled in the repo.

> **Do not add font files to the repository for the customizer.** The previous
> architecture required every selectable font to be manually registered in
> `lib/customizer/v2/fonts.ts` and committed as TTFs under `public/fonts/`.
> Both are gone. Adding a font there now does nothing.

## Environment

```bash
GOOGLE_FONTS_API_KEY=          # SERVER ONLY — never NEXT_PUBLIC_
```

Get a key from the [Google Fonts Developer API](https://developers.google.com/fonts/docs/developer_api).

The key is read only in server code (`process.env.GOOGLE_FONTS_API_KEY`) and is
never sent to the browser, embedded in HTML, returned by an API, or logged.
`npm run validate:fonts` fails the build if it ever leaks into a client
component or a `NEXT_PUBLIC_` variable.

Without the key the storefront still works normally: the font selector reports
*"Google Fonts are temporarily unavailable."* and production rendering fails
loudly instead of substituting a different typeface.

## Data flow

```
Google Fonts Developer API
        │  (server, API key, cached ~24h)
        ▼
lib/customizer/v2/server/google-fonts-catalog.ts
        │
        ├──▶ GET /api/customizer/fonts ──▶ browser selector   (sanitized: no URLs, no key)
        ├──▶ save validation  (lib/customizer/save-validation.ts)
        ├──▶ publish preflight (lib/customizer/v2/preflight.ts)
        └──▶ production renderer (lib/customizer/v2/server/render.ts)
```

One cached catalog backs every consumer — validation never makes its own
Google call.

## Modules

| File | Responsibility |
|---|---|
| `lib/customizer/v2/google-fonts.ts` | Pure model: normalization, search, variant parsing, weight resolution, dependency collection, allowlist rule. No network — fully unit tested. |
| `lib/customizer/v2/server/google-fonts-catalog.ts` | Fetches + caches the catalog. Serves a stale cache during a Google outage. |
| `lib/customizer/v2/server/google-font-files.ts` | Downloads and disk-caches individual font files. **SSRF guard**: only `https://fonts.gstatic.com` / `fonts.googleapis.com`. |
| `lib/customizer/v2/server/server-fonts.ts` | Parses fetched files with `opentype.js` for exact server text measurement. |
| `app/api/customizer/fonts/route.ts` | Sanitized catalog endpoint (rate limited, validated query params). |
| `app/components/customizer/useGoogleFonts.ts` | Browser catalog hook + `ensureGoogleFontLoaded` loader + recent fonts. |
| `app/components/customizer/GoogleFontSelector.tsx` | The shared searchable selector — **one** implementation for admin and customer. |
| `app/components/customizer/GoogleFontMultiSelect.tsx` | Admin `allowedCustomerFonts` picker. |

## Performance rules

Opening the customizer downloads **no font files**. A face is fetched only when:

1. the design already uses it (`ensureDesignFontsLoaded` on mount),
2. the user selects it, or
3. a dropdown row scrolls into view (preview, regular cut only).

`ensureGoogleFontLoaded(family, weight, style)` de-duplicates across every
consumer via a shared in-memory set, so two toolbars and the canvas never fetch
the same face twice. Search results are capped (60 rows) so the dropdown never
renders thousands of live previews.

On the server, a render downloads **only the variants that document uses** and
caches them on disk (`os.tmpdir()/husnalogy-google-fonts`), keyed by
family + variant + source URL. Concurrent jobs requesting the same variant share
one download.

## Weights and italic are dynamic

Weight options come from the selected family's real variants, not a fixed
300–800 list. Playfair Display offers Regular/Bold only; Montserrat offers its
full range. Italic is disabled when the family ships no italic cut. Switching
family snaps an unsupported weight to the nearest available one **in the same
patch**, so it stays one undo step.

## Production rendering never substitutes

If a family cannot be resolved, or its file cannot be downloaded, the render
throws `FONT_FILE_MISSING`. The job is marked failed, stays retryable, and the
error is visible to Admin. Production output never silently changes the
customer's chosen typeface.

## Legacy templates

Templates saved under the old system may reference system fonts (Georgia,
Times New Roman, Arial, Courier New). These are **not** Google Fonts:

- The document still opens and the family value is preserved — nothing is
  silently rewritten.
- Publish preflight reports `unknown-font` (severity `error`), so an admin must
  pick a Google Font before republishing.
- Production rendering refuses rather than substituting.

Families that *are* genuine Google Fonts (Inter, Cormorant Garamond) keep
working with no migration at all — they resolve straight from the catalog.

## Website typography is separate

`app/brand-fonts/` holds the site's own display/body faces, loaded via
`next/font/local` in `app/layout.tsx`. Those are **not** customizer fonts and
must not be confused with them. Changing the customizer font system must never
alter site typography.

## Testing

`npm run validate:fonts` checks the architecture without calling Google, so
builds stay deterministic. Render tests use
`lib/customizer/v2/__tests__/google-fonts-test-harness.ts`, which seeds the
catalog and serves real font bytes from local files — the whole pipeline runs
for real with no network.
