/**
 * One natural order for colour swatches, shared by the studio's colour popover
 * and the customer customizer's allowed colours: white, black, the other
 * neutrals from light to dark, then the colours around the wheel from red
 * (red, orange, gold, green, blue, purple, pink). Duplicates (compared as
 * normalised hex) and invalid values are dropped; each colour keeps the exact
 * spelling it was given, because that is the value a swatch applies.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normaliseSwatch(value: string): string | null {
  const match = HEX.exec(String(value || "").trim());
  if (!match) return null;
  const raw = match[1].toLowerCase();
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return `#${full}`;
}

function hsl(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const chroma = d;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, l, chroma };
}

/** Colours this close to grey (whites, blush, greys, charcoal, black) read as neutrals. */
const NEUTRAL_CHROMA = 0.1;

function rank(hex: string): [number, number, number] {
  if (hex === "#ffffff") return [0, 0, 0];
  if (hex === "#000000") return [1, 0, 0];
  const { h, l, chroma } = hsl(hex);
  // Very dark or very light colours carry little hue either.
  if (chroma < NEUTRAL_CHROMA || l < 0.08 || l > 0.97) return [2, -l, 0];
  // Around the wheel from red in 30° bands (crimson just under 360° counts as
  // red); within one band, light before dark.
  const hue = h >= 345 ? h - 360 : h;
  return [3, Math.round(hue / 30), -l];
}

export function orderSwatches(colours: ReadonlyArray<string>, options: { includeBasics?: boolean } = {}): string[] {
  const seen = new Set<string>();
  const list: Array<{ value: string; hex: string }> = [];
  const add = (value: string) => {
    const hex = normaliseSwatch(value);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      list.push({ value: String(value).trim(), hex });
    }
  };
  colours.forEach(add);
  if (options.includeBasics) {
    add("#ffffff");
    add("#000000");
  }
  return list
    .map((entry, index) => ({ ...entry, index, key: rank(entry.hex) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.index - b.index)
    .map((entry) => entry.value);
}
