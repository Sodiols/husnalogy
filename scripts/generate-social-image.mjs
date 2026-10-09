/**
 * Generates the default social sharing image: public/og/husnalogy-share.png.
 *
 * 1200 x 630 PNG built only from approved brand material: the existing
 * Husnalogy wordmark (public/Brand Kit/Logo-5.png), the brand palette and the
 * bundled brand fonts. Gotham is not shipped with the site, so the supporting
 * line uses the site's own body face (Inter), as the website itself does.
 *
 * Run after a brand asset changes:  node scripts/generate-social-image.mjs
 * The output is committed; nothing generates it at build or request time.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public/og/husnalogy-share.png");

const WIDTH = 1200;
const HEIGHT = 630;
const INK = "#303839";
const NEUTRAL = "#F4ECEC";
const GOLD = "#D4AF37";

const LOGO_WIDTH = 620;
const logo = await sharp(resolve(root, "public/Brand Kit/Logo-5.png")).resize({ width: LOGO_WIDTH * 2 }).png().toBuffer();
const { height: logoPixelHeight } = await sharp(logo).metadata();
const logoHeight = Math.round(logoPixelHeight / 2);
const logoTop = 168;
const ruleY = logoTop + logoHeight + 44;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${NEUTRAL}"/>
  <rect x="36" y="36" width="${WIDTH - 72}" height="${HEIGHT - 72}" fill="none" stroke="${INK}" stroke-opacity="0.14" stroke-width="1"/>
  <image x="${(WIDTH - LOGO_WIDTH) / 2}" y="${logoTop}" width="${LOGO_WIDTH}" height="${logoHeight}" xlink:href="data:image/png;base64,${logo.toString("base64")}"/>
  <line x1="${WIDTH / 2 - 36}" y1="${ruleY}" x2="${WIDTH / 2 + 36}" y2="${ruleY}" stroke="${GOLD}" stroke-width="1.5"/>
  <text x="${WIDTH / 2}" y="${ruleY + 52}" text-anchor="middle" font-family="Cormorant Garamond" font-style="italic" font-size="34" fill="${INK}">Wedding invitations, stationery and personalized gifts</text>
  <text x="${WIDTH / 2}" y="${HEIGHT - 78}" text-anchor="middle" font-family="Inter" font-weight="500" font-size="15" letter-spacing="4.5" fill="${INK}" fill-opacity="0.62">HUSNALOGY.COM</text>
</svg>`;

const fontDir = resolve(root, "app/brand-fonts");
const rendered = new Resvg(svg, {
  fitTo: { mode: "width", value: WIDTH },
  font: {
    fontFiles: [
      resolve(fontDir, "CormorantGaramond-400-italic.ttf"),
      resolve(fontDir, "Inter-500.ttf"),
    ],
    loadSystemFonts: false,
    defaultFontFamily: "Inter",
  },
}).render();

const png = await sharp(rendered.asPng()).png({ compressionLevel: 9, palette: false }).toBuffer();
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, png);
const meta = await sharp(readFileSync(output)).metadata();
console.log(`Wrote ${output} (${meta.width}x${meta.height}, ${png.length} bytes)`);
