// Pair kerning read straight from a font's GPOS table, the way browsers and
// HarfBuzz/rustybuzz (resvg) apply it.
//
// The server measures text with opentype.js to decide where print output
// wraps. opentype.js does not parse GPOS Extension lookups (type 9) and stops
// at the first kerning lookup that covers a glyph, so fonts that keep their
// kerning in Extension lookups — Inter among them — were measured as if
// unkerned: about 0.7 % wider than the studio's canvas measured the same words
// ("AVAT" 13 px wider at 60 px). A line that just fitted in the editor could
// then wrap in print. This reader covers what Latin pair kerning needs:
//
//   - every lookup referenced by any `kern` feature, in lookup order, each
//     applied once and their adjustments summed;
//   - PairPos format 1 (glyph pairs) and format 2 (class pairs), directly or
//     wrapped in an Extension (type 9) subtable;
//   - within one lookup, the first subtable that applies to the pair wins.
//
// Only the horizontal advance (XAdvance of the first glyph's value record) is
// read; that is what changes a line's measured width.

export type KerningFn = (leftGlyphIndex: number, rightGlyphIndex: number) => number;

type View = DataView;

const tag = (view: View, offset: number) =>
  String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

/** Bytes a ValueRecord with this format occupies, and where XAdvance sits in it (or -1). */
function valueRecordLayout(format: number): { size: number; xAdvance: number } {
  let size = 0;
  let xAdvance = -1;
  for (let bit = 0; bit < 8; bit += 1) {
    if (!(format & (1 << bit))) continue;
    if (bit === 2) xAdvance = size;
    size += 2;
  }
  return { size, xAdvance };
}

function coverageIndex(view: View, offset: number, glyph: number): number {
  const format = view.getUint16(offset);
  if (format === 1) {
    const count = view.getUint16(offset + 2);
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const value = view.getUint16(offset + 4 + mid * 2);
      if (value === glyph) return mid;
      if (value < glyph) low = mid + 1;
      else high = mid - 1;
    }
    return -1;
  }
  if (format === 2) {
    const count = view.getUint16(offset + 2);
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const record = offset + 4 + mid * 6;
      const start = view.getUint16(record);
      const end = view.getUint16(record + 2);
      if (glyph < start) high = mid - 1;
      else if (glyph > end) low = mid + 1;
      else return view.getUint16(record + 4) + glyph - start;
    }
  }
  return -1;
}

function glyphClass(view: View, offset: number, glyph: number): number {
  const format = view.getUint16(offset);
  if (format === 1) {
    const start = view.getUint16(offset + 2);
    const count = view.getUint16(offset + 4);
    return glyph >= start && glyph < start + count ? view.getUint16(offset + 6 + (glyph - start) * 2) : 0;
  }
  if (format === 2) {
    const count = view.getUint16(offset + 2);
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const record = offset + 4 + mid * 6;
      const start = view.getUint16(record);
      const end = view.getUint16(record + 2);
      if (glyph < start) high = mid - 1;
      else if (glyph > end) low = mid + 1;
      else return view.getUint16(record + 4);
    }
  }
  return 0;
}

/** One PairPos subtable's adjustment for the pair, or null when it does not apply. */
function pairAdjustment(view: View, subtable: number, left: number, right: number): number | null {
  const format = view.getUint16(subtable);
  const covered = coverageIndex(view, subtable + view.getUint16(subtable + 2), left);
  if (covered < 0) return null;
  const valueFormat1 = view.getUint16(subtable + 4);
  const valueFormat2 = view.getUint16(subtable + 6);
  const first = valueRecordLayout(valueFormat1);
  const second = valueRecordLayout(valueFormat2);
  if (format === 1) {
    const pairSetCount = view.getUint16(subtable + 8);
    if (covered >= pairSetCount) return null;
    const pairSet = subtable + view.getUint16(subtable + 10 + covered * 2);
    const count = view.getUint16(pairSet);
    const recordSize = 2 + first.size + second.size;
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const record = pairSet + 2 + mid * recordSize;
      const secondGlyph = view.getUint16(record);
      if (secondGlyph === right) return first.xAdvance >= 0 ? view.getInt16(record + 2 + first.xAdvance) : 0;
      if (secondGlyph < right) low = mid + 1;
      else high = mid - 1;
    }
    return null;
  }
  if (format === 2) {
    const class1 = glyphClass(view, subtable + view.getUint16(subtable + 8), left);
    const class2 = glyphClass(view, subtable + view.getUint16(subtable + 10), right);
    const class1Count = view.getUint16(subtable + 12);
    const class2Count = view.getUint16(subtable + 14);
    if (class1 >= class1Count || class2 >= class2Count) return 0;
    const recordSize = first.size + second.size;
    const record = subtable + 16 + (class1 * class2Count + class2) * recordSize;
    return first.xAdvance >= 0 ? view.getInt16(record + first.xAdvance) : 0;
  }
  return null;
}

/**
 * A kerning function for the font in `bytes` (TrueType/OpenType), or null when
 * it has no GPOS `kern` feature. Malformed tables yield null rather than a
 * half-read kerning: the caller then falls back to opentype.js.
 */
export function readGposPairKerning(bytes: ArrayBuffer | ArrayBufferView): KerningFn | null {
  try {
    const view = ArrayBuffer.isView(bytes)
      ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new DataView(bytes);
    const tableCount = view.getUint16(4);
    let gpos = -1;
    for (let index = 0; index < tableCount; index += 1) {
      const record = 12 + index * 16;
      if (tag(view, record) === "GPOS") gpos = view.getUint32(record + 8);
    }
    if (gpos < 0) return null;
    const featureList = gpos + view.getUint16(gpos + 6);
    const lookupList = gpos + view.getUint16(gpos + 8);

    const lookupIndexes: number[] = [];
    const featureCount = view.getUint16(featureList);
    for (let index = 0; index < featureCount; index += 1) {
      const record = featureList + 2 + index * 6;
      if (tag(view, record) !== "kern") continue;
      const feature = featureList + view.getUint16(record + 4);
      const count = view.getUint16(feature + 2);
      for (let item = 0; item < count; item += 1) {
        const lookup = view.getUint16(feature + 4 + item * 2);
        if (!lookupIndexes.includes(lookup)) lookupIndexes.push(lookup);
      }
    }
    if (!lookupIndexes.length) return null;
    lookupIndexes.sort((a, b) => a - b);

    // Each lookup → its PairPos subtables (Extension wrappers resolved).
    const lookupCount = view.getUint16(lookupList);
    const lookups: number[][] = [];
    for (const lookupIndex of lookupIndexes) {
      if (lookupIndex >= lookupCount) continue;
      const lookup = lookupList + view.getUint16(lookupList + 2 + lookupIndex * 2);
      const type = view.getUint16(lookup);
      const subtableCount = view.getUint16(lookup + 4);
      const subtables: number[] = [];
      for (let index = 0; index < subtableCount; index += 1) {
        const subtable = lookup + view.getUint16(lookup + 6 + index * 2);
        if (type === 2) subtables.push(subtable);
        else if (type === 9 && view.getUint16(subtable + 2) === 2) subtables.push(subtable + view.getUint32(subtable + 4));
      }
      if (subtables.length) lookups.push(subtables);
    }
    if (!lookups.length) return null;

    const cache = new Map<number, number>();
    return (left, right) => {
      if (!Number.isInteger(left) || !Number.isInteger(right)) return 0;
      const key = left * 65536 + right;
      const known = cache.get(key);
      if (known !== undefined) return known;
      let total = 0;
      for (const subtables of lookups) {
        for (const subtable of subtables) {
          const value = pairAdjustment(view, subtable, left, right);
          if (value === null) continue;
          total += value;
          break;
        }
      }
      if (cache.size > 20_000) cache.clear();
      cache.set(key, total);
      return total;
    };
  } catch {
    return null;
  }
}

/** Attach the GPOS kerning reader to a parsed opentype.js font (used by the server measurer). */
export function withGposKerning<T extends object>(font: T, bytes: ArrayBuffer | ArrayBufferView): T & { gposKerning?: KerningFn } {
  const kerning = readGposPairKerning(bytes);
  if (kerning) (font as any).gposKerning = kerning;
  return font as T & { gposKerning?: KerningFn };
}
