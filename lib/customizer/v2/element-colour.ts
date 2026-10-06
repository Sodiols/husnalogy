/**
 * Recolouring SVG elements (Customizer Point 7).
 *
 * Every SVG element can be recoloured — single-colour or multicolour, filled or
 * stroked. The renderer (CustomizerPreview and the server SVG alike) already
 * does it with one alpha-preserving filter: `feFlood` paints the chosen colour
 * and `feComposite in2="SourceAlpha" operator="in"` keeps it only where the
 * artwork is opaque. So:
 *
 *  - a multicolour SVG becomes the selected colour, as one colour;
 *  - transparent and semi-transparent areas keep exactly their alpha — nothing
 *    invisible is painted;
 *  - geometry is untouched (the SVG itself is never rewritten).
 *
 * `tintColor: ""` is ORIGINAL: no filter, the artwork's own colours.
 *
 * The control used to appear only for assets the upload classified as
 * "single colour" (`tintable`), which hid it for every multicolour SVG. That
 * classification now only decides the colour an element STARTS with.
 */

import { normalizePaintValue } from "./paint";

const SVG_PATH = /\.svgz?$/i;

const pathOf = (value: unknown) => String(value || "").split(/[?#]/)[0];

/** Whether an element layer's artwork is an SVG (and so offers a colour control). */
export function isSvgElement(layer: any): boolean {
  if (!layer || layer.type !== "element") return false;
  const mime = String(layer.mimeType || layer.assetReference?.mimeType || "").toLowerCase();
  if (mime) return mime === "image/svg+xml";
  if (String(layer.src || "").startsWith("data:image/svg+xml")) return true;
  return [layer.originalPath, layer.editorPath, layer.path, layer.originalFilename, layer.src].some((value) => SVG_PATH.test(pathOf(value)));
}

/** "" for Original, otherwise a stored hex colour; anything else is refused (null). */
export function normalizeTintColour(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  const paint = normalizePaintValue(value);
  // Transparent is not a tint: a fully transparent element is just hidden.
  return paint && paint !== "none" ? paint : null;
}
