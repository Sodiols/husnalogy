/**
 * Colours for the studio's Background panel.
 *
 * A page's background colour is `page.backgroundColor`, a hex. Its NO-COLOUR
 * state is the empty value: every renderer (studio canvas, customer editor,
 * server/print SVG) then draws the card's paper white, and the template
 * normaliser stores it as "#ffffff". There is no transparent page in the
 * document model — a printed card always has paper behind it — so "no colour"
 * is that default, never a separate transparent paint.
 */

/** The page background's stored value when no colour is applied. */
export const NO_BACKGROUND_COLOR = "";
/** What the renderers and the normaliser draw for it. */
export const DEFAULT_BACKGROUND_COLOR = "#ffffff";

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc", "ABC", "#AABBCC" → "#aabbcc"; anything else → null. */
export function normalizeHexInput(input: unknown): string | null {
  const match = HEX.exec(String(input ?? "").trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].split("").map((digit) => digit + digit).join("") : match[1];
  return `#${digits.toLowerCase()}`;
}

/** True when the page shows no colour of its own (the paper default). */
export function isNoBackgroundColor(value: unknown): boolean {
  const hex = normalizeHexInput(value);
  return !hex || hex === DEFAULT_BACKGROUND_COLOR;
}

/**
 * The swatch grid: neutrals, then blues, purples, pinks and reds, oranges and
 * yellows, greens and teals — the spread of the reference panel.
 */
export const BACKGROUND_SWATCHES: ReadonlyArray<string> = [
  "#ffffff", "#e6e6e6", "#cccccc", "#999999", "#666666",
  "#3f3f3f", "#000000", "#8fd3f4", "#00aeef", "#005a86", "#9b8fca",
  "#2e3192", "#0d0548", "#b39bc8", "#662d91", "#32004b", "#f6a5c9",
  "#ec008c", "#7d0049", "#f5a98b", "#ed1c24", "#790000", "#fdcf9a",
  "#f7941d", "#7f4b06", "#fde2a2", "#fdb913", "#7f6000", "#fff7a2",
  "#fff200", "#827b00", "#b9deaa", "#39b54a", "#005e20", "#9cd8c2",
  "#00a874", "#005b3c", "#8ed8e1", "#00b0c8", "#005d6a",
];

const COLOUR_KEYS = ["color", "fill", "stroke", "tintColor", "foregroundColor", "backgroundColor", "borderColor"];

/**
 * The design's ORIGINAL palette, deterministically: the page backgrounds (in
 * page order), then the colours its layers use, most-used first (ties in
 * stacking order). Taken from the design as it was opened, so applying a
 * colour never reshuffles the row. No hardcoded colours.
 */
export function designPalette(template: any, limit = 6): string[] {
  const seen = new Map<string, { count: number; order: number }>();
  let order = 0;
  const add = (value: unknown, weight = 1) => {
    const hex = normalizeHexInput(value);
    if (!hex) return;
    const entry = seen.get(hex);
    if (entry) entry.count += weight;
    else seen.set(hex, { count: weight, order: order++ });
  };
  for (const page of template?.pages || []) add(page?.backgroundColor || DEFAULT_BACKGROUND_COLOR, 1000);
  const layers = [...(template?.layers || [])].sort((a: any, b: any) => (Number(a?.zIndex) || 0) - (Number(b?.zIndex) || 0));
  for (const layer of layers) {
    for (const key of COLOUR_KEYS) add(layer?.[key]);
    for (const key of COLOUR_KEYS) add(layer?.textStyle?.[key]);
    for (const key of COLOUR_KEYS) add(layer?.qrStyle?.[key]);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)
    .slice(0, limit)
    .map(([hex]) => hex);
}
