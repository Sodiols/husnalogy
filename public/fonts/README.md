# Local font assets

The Customizer V2 browser, SVG, PNG, and PDF renderers use the font files in
this directory. The current Cormorant Garamond and Inter files are open-font
assets distributed under the SIL Open Font License 1.1. Keep the original
source and license records with the deployment artefacts.

Do not add a commercial font here unless the project owner has a licence that
explicitly permits web embedding and server-side output generation. After any
font change, update `lib/customizer/v2/fonts.ts` and run
`npm run validate:fonts` before publishing a template.
