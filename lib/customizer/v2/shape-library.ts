// The Shapes library: every shape the Elements panel offers, as REAL shape
// geometry (no raster thumbnails, no decorative-only entries).
//
// Two representations, one experience:
//  - native kinds (rectangle, rounded rectangle, circle, oval, triangle, arch,
//    polygon with normalized points) for everything the shape engine already
//    draws;
//  - `custom` shapes: an outline of absolute path commands (M L C Q Z) in a
//    100 x 100 box, scaled exactly into the layer's box by both renderers —
//    for curves, badges, brush strokes and other irregular outlines.
// Both kinds take fill, line colour and line weight, print as vectors, and can
// clip a photo (the mask engine draws the same outline).
//
// All geometry here is original and generated in code: regular polygons and
// stars from their definition, organic outlines from a fixed-seed jitter of a
// base contour (so they are identical on every machine and every render).

/** How a library shape is drawn, and its box proportion (width / height). */
export type LibraryShapeGeometry = { aspect: number } & (
  | { shape: "rectangle" | "circle" | "oval" | "triangle" | "arch" }
  /** Corner radius as a fraction of the shorter side (0.5 = fully rounded ends). */
  | { shape: "rounded-rectangle"; radiusFraction: number }
  | { shape: "polygon"; points: Array<{ x: number; y: number }> }
  | { shape: "custom"; pathData: string }
);

export type LibraryShape = LibraryShapeGeometry & {
  id: string;
  label: string;
  /** Extra words the Shapes search matches (case-insensitive). */
  keywords: string[];
};

export const CUSTOM_PATH_BOX = 100;

/* ---------------------------------------------------------- geometry ---- */

const r2 = (value: number) => Math.round(value * 100) / 100;
const n = (value: number) => String(r2(value));

/** Regular polygon or star, normalized to the unit box. */
function starPoints(tips: number, innerRatio: number, rotationDeg = -90, squash = 1): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const count = innerRatio >= 1 ? tips : tips * 2;
  for (let index = 0; index < count; index += 1) {
    const radius = innerRatio >= 1 || index % 2 === 0 ? 0.5 : 0.5 * innerRatio;
    const angle = ((rotationDeg + (360 / count) * index) * Math.PI) / 180;
    points.push({ x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle) * squash });
  }
  // Fill the box: rescale to the points' own extent.
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return points.map((point) => ({ x: r2(((point.x - minX) / (maxX - minX)) * 1000) / 1000, y: r2(((point.y - minY) / (maxY - minY)) * 1000) / 1000 }));
}

/** A closed path through points, in the 100 box. */
function polyPath(points: Array<[number, number]>): string {
  return `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join(" L")} Z`;
}

/** A smooth closed curve through points (Catmull-Rom as cubic Béziers). */
function smoothPath(points: Array<[number, number]>, tension = 1): string {
  const count = points.length;
  let d = `M${n(points[0][0])} ${n(points[0][1])}`;
  for (let index = 0; index < count; index += 1) {
    const p0 = points[(index - 1 + count) % count];
    const p1 = points[index];
    const p2 = points[(index + 1) % count];
    const p3 = points[(index + 2) % count];
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += ` C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p2[0])} ${n(p2[1])}`;
  }
  return `${d} Z`;
}

/** A circle as four cubic Béziers (no arc commands), in the 100 box. */
function circlePath(cx: number, cy: number, rx: number, ry = rx): string {
  const k = 0.5523;
  return [
    `M${n(cx + rx)} ${n(cy)}`,
    `C${n(cx + rx)} ${n(cy + ry * k)} ${n(cx + rx * k)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)}`,
    `C${n(cx - rx * k)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + ry * k)} ${n(cx - rx)} ${n(cy)}`,
    `C${n(cx - rx)} ${n(cy - ry * k)} ${n(cx - rx * k)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)}`,
    `C${n(cx + rx * k)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - ry * k)} ${n(cx + rx)} ${n(cy)} Z`,
  ].join(" ");
}

/** Deterministic pseudo-random numbers (mulberry32), so organic shapes never change. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points around an ellipse with a scalloped (wavy) edge. */
function scallopPoints(lobes: number, depth: number, rx = 48, ry = 48, samples = 8): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const total = lobes * samples;
  for (let index = 0; index < total; index += 1) {
    const angle = (index / total) * Math.PI * 2;
    const wave = 1 - depth * (0.5 - 0.5 * Math.cos(angle * lobes));
    points.push([50 + rx * wave * Math.cos(angle), 50 + ry * wave * Math.sin(angle)]);
  }
  return points;
}

/** An organic outline: a base contour pushed in and out by a fixed-seed jitter. */
function organic(base: (t: number) => [number, number], options: { seed: number; samples: number; amount: number; smooth?: boolean }): string {
  const random = seeded(options.seed);
  const points: Array<[number, number]> = [];
  for (let index = 0; index < options.samples; index += 1) {
    const t = index / options.samples;
    const [x, y] = base(t);
    const push = (random() - 0.5) * 2 * options.amount;
    const dx = x - 50;
    const dy = y - 50;
    const length = Math.hypot(dx, dy) || 1;
    points.push([Math.min(100, Math.max(0, x + (dx / length) * push)), Math.min(100, Math.max(0, y + (dy / length) * push))]);
  }
  return options.smooth === false ? polyPath(points) : smoothPath(points);
}

/** A rounded-rectangle contour parameterised by t in [0,1). */
function roundedRectContour(x: number, y: number, w: number, h: number) {
  const perimeter = 2 * (w + h);
  return (t: number): [number, number] => {
    let distance = t * perimeter;
    if (distance < w) return [x + distance, y];
    distance -= w;
    if (distance < h) return [x + w, y + distance];
    distance -= h;
    if (distance < w) return [x + w - distance, y + h];
    distance -= w;
    return [x, y + h - distance];
  };
}

const ellipseContour = (rx: number, ry: number) => (t: number): [number, number] => [50 + rx * Math.cos(t * Math.PI * 2), 50 + ry * Math.sin(t * Math.PI * 2)];

/** Heart: two lobes and a point, as cubic Béziers in the 100 box. */
const HEART = "M50 96 C38 86 4 62 4 32 C4 14 17 4 30 4 C40 4 47 10 50 18 C53 10 60 4 70 4 C83 4 96 14 96 32 C96 62 62 86 50 96 Z";
/** A softer, rounder heart. */
const HEART_ROUND = "M50 94 C30 80 2 64 2 36 C2 16 16 4 31 4 C41 4 47 9 50 16 C53 9 59 4 69 4 C84 4 98 16 98 36 C98 64 70 80 50 94 Z";
/** A tilted, hand-drawn heart. */
const HEART_TILTED = "M44 96 C30 84 0 58 6 30 C9 14 24 4 37 7 C46 9 51 16 52 24 C57 15 66 9 76 11 C90 14 99 28 95 44 C89 68 60 84 44 96 Z";

/** Arch with a flat bottom. */
const ARCH_TOP = "M0 100 L0 50 C0 22 22 0 50 0 C78 0 100 22 100 50 L100 100 Z";
/** A rectangle whose bottom is a full half-circle. */
const ROUNDED_BOTTOM = "M0 0 L100 0 L100 50 C100 78 78 100 50 100 C22 100 0 78 0 50 Z";
/** Rounded top and rounded bottom ends (a tall pill-arch). */
const ARCH_DOUBLE = "M0 30 C0 13 22 0 50 0 C78 0 100 13 100 30 L100 70 C100 87 78 100 50 100 C22 100 0 87 0 70 Z";

/** A label with notched (inverted) corners, like a vintage ticket. */
function notchedRect(notch: number): string {
  const q = notch;
  return [
    `M${q} 0 L${100 - q} 0`,
    `Q${100 - q} ${q} 100 ${q}`,
    `L100 ${100 - q}`,
    `Q${100 - q} ${100 - q} ${100 - q} 100`,
    `L${q} 100`,
    `Q${q} ${100 - q} 0 ${100 - q}`,
    `L0 ${q}`,
    `Q${q} ${q} ${q} 0 Z`,
  ].join(" ");
}

/** A bracket-style decorative frame: straight sides with curled corners. */
const DECORATIVE_FRAME =
  "M14 0 L86 0 C86 8 92 14 100 14 L100 86 C92 86 86 92 86 100 L14 100 C14 92 8 86 0 86 L0 14 C8 14 14 8 14 0 Z";

/** A ribbon banner with forked tails. */
const RIBBON = "M0 20 L100 20 L90 50 L100 80 L0 80 L10 50 Z";
/** A pointed tag / label. */
const TAG = "M0 0 L78 0 L100 50 L78 100 L0 100 Z";

/** A wavy-edged rectangle. */
function wavyRect(): string {
  const top: Array<[number, number]> = [];
  const bottom: Array<[number, number]> = [];
  for (let index = 0; index <= 20; index += 1) {
    const x = index * 5;
    top.push([x, 8 + 6 * Math.sin((index / 20) * Math.PI * 4)]);
    bottom.push([x, 92 + 6 * Math.sin((index / 20) * Math.PI * 4 + Math.PI)]);
  }
  return polyPath([...top, ...bottom.reverse()]);
}

/** A brush stroke: a long bar with a ragged, tapering edge. */
function brushStroke(seed: number, slant = 0): string {
  const random = seeded(seed);
  const top: Array<[number, number]> = [];
  const bottom: Array<[number, number]> = [];
  for (let index = 0; index <= 28; index += 1) {
    const x = (index / 28) * 100;
    const taper = Math.sin((index / 28) * Math.PI) ** 0.35;
    const lift = slant * (x - 50) / 50;
    top.push([x, 50 - lift - 34 * taper + (random() - 0.5) * 9]);
    bottom.push([x, 50 - lift + 34 * taper + (random() - 0.5) * 9]);
  }
  const clamp = ([x, y]: [number, number]): [number, number] => [x, Math.min(100, Math.max(0, y))];
  return polyPath([...top, ...bottom.reverse()].map(clamp));
}

/** A splatter: an organic blot with satellite droplets. */
function splatter(): string {
  const random = seeded(73);
  let d = organic(ellipseContour(30, 28), { seed: 71, samples: 26, amount: 9 });
  for (let index = 0; index < 9; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = 36 + random() * 12;
    const radius = 2 + random() * 3.5;
    const cx = Math.min(100 - radius, Math.max(radius, 50 + distance * Math.cos(angle)));
    const cy = Math.min(100 - radius, Math.max(radius, 50 + distance * Math.sin(angle)));
    d += ` ${circlePath(cx, cy, radius)}`;
  }
  return d;
}

/** A cloud: overlapping round lobes over a flat base. */
const CLOUD =
  "M18 82 C6 82 0 72 4 62 C7 54 14 50 22 52 C22 36 36 26 50 30 C56 16 76 14 86 28 C94 30 100 40 98 52 C100 62 96 82 82 82 Z";

/** A speech bubble. */
const SPEECH = "M10 4 L90 4 C96 4 100 8 100 14 L100 62 C100 68 96 72 90 72 L40 72 L20 96 L24 72 L10 72 C4 72 0 68 0 62 L0 14 C0 8 4 4 10 4 Z";

/** A leaf. */
const LEAF = "M50 100 C18 82 2 50 14 18 C30 22 46 6 50 0 C54 6 70 22 86 18 C98 50 82 82 50 100 Z";

/** A crescent moon. */
const MOON = "M62 4 C36 10 18 32 18 54 C18 80 40 98 66 98 C78 98 88 94 96 86 C86 88 74 86 64 80 C46 70 38 50 42 32 C46 18 54 8 62 4 Z";

/* ----------------------------------------------------------- library ---- */

const sq = (id: string, label: string, keywords: string[], geometry: LibraryShapeGeometry): LibraryShape => ({ id, label, keywords, ...geometry });

/**
 * Shown in this order in the Shapes library. The first four are the Elements
 * overview's preview row.
 */
export const SHAPE_LIBRARY: readonly LibraryShape[] = [
  sq("rounded-bottom", "Rounded bottom rectangle", ["rounded", "bottom", "arch", "tab", "rectangle"], { shape: "custom", pathData: ROUNDED_BOTTOM, aspect: 0.62 }),
  sq("heart", "Heart", ["heart", "love", "valentine"], { shape: "custom", pathData: HEART, aspect: 1.1 }),
  sq("square", "Square", ["square", "rectangle", "box"], { shape: "rectangle", aspect: 1 }),
  sq("arch-top", "Arch", ["arch", "window", "doorway", "rounded top"], { shape: "custom", pathData: ARCH_TOP, aspect: 0.72 }),
  sq("star", "Star", ["star", "five", "rating"], { shape: "polygon", points: starPoints(5, 0.42), aspect: 1.05 }),
  sq("ticket", "Ticket label", ["ticket", "label", "notched", "vintage", "rectangle"], { shape: "custom", pathData: notchedRect(9), aspect: 0.72 }),
  sq("tag", "Pointed label", ["tag", "label", "pointed", "arrow", "sign"], { shape: "custom", pathData: TAG, aspect: 2.6 }),
  sq("decorative-frame", "Decorative frame", ["frame", "decorative", "ornament", "badge", "label"], { shape: "custom", pathData: DECORATIVE_FRAME, aspect: 0.8 }),
  sq("heart-round", "Round heart", ["heart", "love", "round"], { shape: "custom", pathData: HEART_ROUND, aspect: 1.12 }),
  sq("brush-stroke", "Brush stroke", ["brush", "paint", "stroke", "swash"], { shape: "custom", pathData: brushStroke(11, 14), aspect: 2.2 }),
  sq("ribbon", "Ribbon banner", ["ribbon", "banner", "label"], { shape: "custom", pathData: RIBBON, aspect: 3.2 }),
  sq("scalloped-frame", "Scalloped frame", ["scalloped", "frame", "badge", "decorative", "wavy"], { shape: "custom", pathData: smoothPath(scallopPoints(14, 0.07, 46, 48, 6)), aspect: 0.82 }),
  sq("diamond", "Diamond", ["diamond", "rhombus", "square"], { shape: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }], aspect: 1 }),
  sq("bar", "Vertical bar", ["bar", "rectangle", "vertical", "line"], { shape: "rectangle", aspect: 0.22 }),
  sq("arrow", "Arrow", ["arrow", "right", "direction", "pointer"], { shape: "polygon", points: [{ x: 0, y: 0.32 }, { x: 0.6, y: 0.32 }, { x: 0.6, y: 0 }, { x: 1, y: 0.5 }, { x: 0.6, y: 1 }, { x: 0.6, y: 0.68 }, { x: 0, y: 0.68 }], aspect: 1.6 }),
  sq("capsule", "Capsule", ["capsule", "pill", "oval", "rounded", "vertical"], { shape: "rounded-rectangle", radiusFraction: 0.5, aspect: 0.6 }),
  sq("circle", "Circle", ["circle", "round", "dot"], { shape: "circle", aspect: 1 }),
  sq("scalloped-oval", "Oval badge", ["oval", "badge", "scalloped", "seal"], { shape: "custom", pathData: smoothPath(scallopPoints(18, 0.06, 40, 48, 6)), aspect: 0.82 }),
  sq("rectangle", "Rectangle", ["rectangle", "horizontal", "box"], { shape: "rectangle", aspect: 2 }),
  sq("star-6", "Six-point star", ["star", "six", "hexagram"], { shape: "polygon", points: starPoints(6, 0.58), aspect: 1.15 }),
  sq("paint-circle", "Paint circle", ["paint", "brush", "circle", "round", "texture"], { shape: "custom", pathData: organic(ellipseContour(46, 46), { seed: 5, samples: 40, amount: 3.5 }), aspect: 1 }),
  sq("sparkle", "Sparkle star", ["star", "sparkle", "four", "twinkle", "shine"], { shape: "polygon", points: starPoints(4, 0.22), aspect: 0.82 }),
  sq("rounded-rectangle", "Rounded rectangle", ["rounded", "rectangle", "horizontal"], { shape: "rounded-rectangle", radiusFraction: 0.22, aspect: 1.9 }),
  sq("arch-double", "Rounded arch", ["arch", "rounded", "pill", "window"], { shape: "custom", pathData: ARCH_DOUBLE, aspect: 0.62 }),
  sq("blob", "Organic blob", ["blob", "organic", "irregular", "abstract"], { shape: "custom", pathData: smoothPath([[18, 30], [42, 12], [74, 14], [94, 40], [86, 72], [58, 90], [24, 82], [8, 56]]), aspect: 1.25 }),
  sq("star-round", "Rounded star", ["star", "rounded", "soft"], { shape: "custom", pathData: smoothPath(starPoints(5, 0.5).map((point) => [point.x * 100, point.y * 100] as [number, number]), 0.55), aspect: 1.05 }),
  sq("ticket-outline", "Notched card", ["card", "notched", "label", "rectangle"], { shape: "custom", pathData: notchedRect(14), aspect: 0.7 }),
  sq("oval", "Oval", ["oval", "ellipse", "egg"], { shape: "oval", aspect: 0.7 }),
  sq("paint-square", "Paint square", ["paint", "brush", "square", "texture", "rough"], { shape: "custom", pathData: organic(roundedRectContour(6, 6, 88, 88), { seed: 19, samples: 64, amount: 3.2, smooth: false }), aspect: 1 }),
  sq("hexagon", "Hexagon", ["hexagon", "six", "honeycomb"], { shape: "polygon", points: starPoints(6, 1, 0), aspect: 1.15 }),
  sq("pill", "Pill", ["pill", "capsule", "button", "rounded", "horizontal"], { shape: "rounded-rectangle", radiusFraction: 0.5, aspect: 2.4 }),
  sq("right-triangle", "Right triangle", ["triangle", "right", "corner"], { shape: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], aspect: 1 }),
  sq("rounded-square", "Rounded square", ["rounded", "square", "app"], { shape: "rounded-rectangle", radiusFraction: 0.18, aspect: 1 }),
  sq("stamp-oval", "Stamp oval", ["stamp", "oval", "scalloped", "badge", "seal"], { shape: "custom", pathData: smoothPath(scallopPoints(28, 0.04, 44, 48, 4)), aspect: 0.7 }),
  sq("brush-swash", "Paint swash", ["paint", "swash", "brush", "stroke"], { shape: "custom", pathData: brushStroke(29, -18), aspect: 2.4 }),
  sq("torn-strip", "Torn paper strip", ["torn", "paper", "strip", "banner", "rough"], { shape: "custom", pathData: organic(roundedRectContour(2, 22, 96, 56), { seed: 43, samples: 72, amount: 2.6, smooth: false }), aspect: 3 }),
  sq("splatter", "Splatter", ["splatter", "paint", "splash", "ink"], { shape: "custom", pathData: splatter(), aspect: 1 }),
  sq("burst", "Starburst", ["burst", "seal", "badge", "starburst", "sale"], { shape: "polygon", points: starPoints(16, 0.8), aspect: 1 }),
  sq("triangle", "Triangle", ["triangle"], { shape: "triangle", aspect: 1.1 }),
  sq("chevron", "Chevron", ["chevron", "arrow", "right"], { shape: "polygon", points: [{ x: 0, y: 0 }, { x: 0.55, y: 0 }, { x: 1, y: 0.5 }, { x: 0.55, y: 1 }, { x: 0, y: 1 }, { x: 0.45, y: 0.5 }], aspect: 0.9 }),
  sq("pentagon", "Pentagon", ["pentagon", "five"], { shape: "polygon", points: starPoints(5, 1), aspect: 1.05 }),
  sq("octagon", "Octagon", ["octagon", "eight", "badge"], { shape: "polygon", points: starPoints(8, 1, 22.5), aspect: 1 }),
  sq("heart-tilted", "Hand-drawn heart", ["heart", "love", "hand drawn", "tilted"], { shape: "custom", pathData: HEART_TILTED, aspect: 1.08 }),
  sq("wavy-rectangle", "Wavy rectangle", ["wavy", "rectangle", "wave", "banner"], { shape: "custom", pathData: wavyRect(), aspect: 1.6 }),
  sq("cloud", "Cloud", ["cloud", "weather", "sky"], { shape: "custom", pathData: CLOUD, aspect: 1.5 }),
  sq("speech-bubble", "Speech bubble", ["speech", "bubble", "chat", "quote"], { shape: "custom", pathData: SPEECH, aspect: 1.25 }),
  sq("leaf", "Leaf", ["leaf", "nature", "botanical"], { shape: "custom", pathData: LEAF, aspect: 0.72 }),
  sq("moon", "Crescent moon", ["moon", "crescent", "night", "eid"], { shape: "custom", pathData: MOON, aspect: 0.82 }),
  sq("full-arch", "Full arch", ["arch", "full", "window"], { shape: "arch", aspect: 0.66 }),
];

export const SHAPE_LIBRARY_BY_ID: ReadonlyMap<string, LibraryShape> = new Map(SHAPE_LIBRARY.map((entry) => [entry.id, entry]));

/** Case-insensitive search over names and keywords; every word must match. */
export function searchShapeLibrary(query: string, library: readonly LibraryShape[] = SHAPE_LIBRARY): LibraryShape[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...library];
  return library.filter((entry) => {
    const haystack = `${entry.label} ${entry.id} ${entry.keywords.join(" ")}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * The shape-layer fields that make a library shape, for a box of the given
 * longest side. The caller adds identity, position and paint.
 */
export function libraryShapeGeometry(entry: LibraryShape, longestSide: number): Record<string, unknown> {
  const width = entry.aspect >= 1 ? longestSide : Math.round(longestSide * entry.aspect);
  const height = entry.aspect >= 1 ? Math.round(longestSide / entry.aspect) : longestSide;
  const base = { name: entry.label, libraryShapeId: entry.id, width, height };
  switch (entry.shape) {
    case "rounded-rectangle":
      return { ...base, shape: "rounded-rectangle", borderRadius: Math.round(Math.min(width, height) * entry.radiusFraction) };
    case "polygon":
      return { ...base, shape: "polygon", points: entry.points.map((point) => ({ ...point })) };
    case "custom":
      return { ...base, shape: "custom", pathData: entry.pathData };
    default:
      return { ...base, shape: entry.shape };
  }
}

/* ------------------------------------------------- custom path drawing -- */

const PATH_TOKEN = /([MLCQZ])|(-?\d*\.?\d+(?:e-?\d+)?)/gi;
const PATH_ALLOWED = /^[MLCQZmlcqz0-9eE.,\s-]+$/;
const ARITY: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };

/**
 * A stored custom outline, validated: absolute M/L/C/Q/Z commands only, finite
 * numbers, coordinates inside the 100 box. Returns null for anything else, so
 * a corrupt or hostile value can never reach a renderer.
 */
export function sanitizeCustomPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 20_000 || !PATH_ALLOWED.test(value)) return null;
  const tokens = value.match(PATH_TOKEN) || [];
  const out: string[] = [];
  let index = 0;
  let commands = 0;
  while (index < tokens.length) {
    const command = tokens[index].toUpperCase();
    if (!(command in ARITY) || tokens[index] !== command) return null;
    index += 1;
    const arity = ARITY[command];
    const numbers = tokens.slice(index, index + arity).map(Number);
    if (numbers.length !== arity || numbers.some((number) => !Number.isFinite(number) || number < -CUSTOM_PATH_BOX / 2 || number > CUSTOM_PATH_BOX * 1.5)) return null;
    index += arity;
    commands += 1;
    out.push(arity ? `${command}${numbers.map(n).join(" ")}` : command);
  }
  return commands >= 3 && out[0].startsWith("M") ? out.join(" ") : null;
}

/** A custom outline drawn into a box: every coordinate mapped from the 100 box, so strokes stay true. */
export function customPathInBox(pathData: string, box: { x: number; y: number; width: number; height: number }): string {
  const sx = box.width / CUSTOM_PATH_BOX;
  const sy = box.height / CUSTOM_PATH_BOX;
  const tokens = pathData.match(PATH_TOKEN) || [];
  const out: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index].toUpperCase();
    index += 1;
    const arity = ARITY[command] ?? 0;
    const coords: string[] = [];
    for (let offset = 0; offset < arity; offset += 2) {
      coords.push(n(box.x + Number(tokens[index + offset]) * sx), n(box.y + Number(tokens[index + offset + 1]) * sy));
    }
    index += arity;
    out.push(arity ? `${command}${coords.join(" ")}` : command);
  }
  return out.join(" ");
}
