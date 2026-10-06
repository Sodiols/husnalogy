/**
 * Shape and line paints (Customizer Point 5).
 *
 * A shape's `fill` and a shape's or line's `stroke` are either a colour or
 * TRANSPARENT. Transparent is not white: it is the renderer's "no paint", and
 * the one canonical value for it is `"none"` — exactly what SVG draws as no
 * paint, so the editor canvas, the server SVG and the print render agree by
 * construction.
 *
 * `"transparent"` (CSS) is accepted as a synonym and normalised to `"none"`.
 * An EMPTY value keeps its historical meaning: an empty stroke has always been
 * "no border"; an empty fill was never stored (normalisers default it), so
 * existing designs render exactly as before.
 */

export const TRANSPARENT_PAINT = "none";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** True for every spelling of "no paint", including the legacy empty value. */
export function isTransparentPaint(value: unknown): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "" || text === "none" || text === "transparent";
}

/** True only for an EXPLICIT transparent choice ("none"/"transparent"). */
export function isExplicitTransparentPaint(value: unknown): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "none" || text === "transparent";
}

/**
 * A paint a customer or admin may store: a hex colour (lower-cased) or the
 * canonical transparent value. Anything else — CSS functions, `url(#…)`
 * references, named colours — is refused (null).
 */
export function normalizePaintValue(value: unknown): string | null {
  if (isExplicitTransparentPaint(value)) return TRANSPARENT_PAINT;
  const text = String(value ?? "").trim();
  return HEX.test(text) ? text.toLowerCase() : null;
}

/**
 * Canonicalise a stored paint without changing anything that already renders:
 * transparent synonyms become "none"; every other value is kept as it was.
 */
export function canonicalPaint(value: unknown): string {
  if (isExplicitTransparentPaint(value)) return TRANSPARENT_PAINT;
  return typeof value === "string" ? value.trim() : "";
}

/** The SVG paint attribute for a stored value — what every renderer draws. */
export function svgPaint(value: unknown): string {
  return isTransparentPaint(value) ? TRANSPARENT_PAINT : String(value).trim();
}
