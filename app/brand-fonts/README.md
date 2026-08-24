# Husnalogy brand fonts

These files back the **website's own typography only** — the `--font-cormorant`
(display) and `--font-inter` (body) variables declared with `next/font/local`
in `app/layout.tsx` and consumed through `--font-display` / `--font-body` in
`app/globals.css`.

They are deliberately **not** in `public/`: `next/font/local` reads them at
build time and self-hosts fingerprinted copies under `/_next/static/media/`,
so they never need to be publicly served from a stable path.

## These are not customizer fonts

The customizer no longer uses bundled font files at all. Every selectable
design font comes from the Google Fonts Developer API at runtime — see
`lib/customizer/v2/google-fonts.ts` and `docs/CUSTOMIZER_FONTS.md`.

Do not add customizer fonts here, and do not reintroduce a hardcoded font list.

Licence: SIL Open Font License 1.1 (both families are Google Fonts).
