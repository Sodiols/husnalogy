// Shared mask path generator (spec §12). ONE implementation used by the
// interactive canvas, the shared SVG preview, server preview rendering, and
// print rendering — so a frame clips identically on every surface.
//
// All generators return an SVG path `d` string in absolute canvas coordinates
// for a frame whose top-left corner is (x, y) with the given width/height.

import type { MaskShape } from "./types";

function clampRadius(radius: number, width: number, height: number): number {
  const max = Math.min(width, height) / 2;
  if (!Number.isFinite(radius) || radius < 0) return 0;
  return Math.min(radius, max);
}

function rectanglePath(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
}

function roundedRectPath(x: number, y: number, w: number, h: number, radius: number): string {
  const r = clampRadius(radius, w, h);
  if (r <= 0) return rectanglePath(x, y, w, h);
  return [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

function ellipsePath(x: number, y: number, w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  // Two arcs make a full ellipse.
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

function circlePath(x: number, y: number, w: number, h: number): string {
  const d = Math.min(w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = d / 2;
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

// A true arch: semi-ellipse cap on top (full width), straight sides, flat or
// arched bottom. The classic wedding-stationery arch is arch-top.
function archPath(x: number, y: number, w: number, h: number, top: boolean, bottom: boolean): string {
  const rx = w / 2;
  // Cap height: the arch cap uses up to half the height, at most rx (so the
  // cap is never taller than a semicircle would allow gracefully).
  const capLimit = bottom && top ? h / 2 : h;
  const capRy = Math.min(rx, capLimit * (bottom && top ? 1 : 0.5));

  const topRy = top ? capRy : 0;
  const bottomRy = bottom ? capRy : 0;

  const parts: string[] = [];
  parts.push(`M ${x} ${y + topRy}`);
  if (top) {
    parts.push(`A ${rx} ${topRy} 0 0 1 ${x + w} ${y + topRy}`);
  } else {
    parts.push(`L ${x} ${y}`, `H ${x + w}`, `L ${x + w} ${y + topRy}`);
  }
  parts.push(`V ${y + h - bottomRy}`);
  if (bottom) {
    parts.push(`A ${rx} ${bottomRy} 0 0 1 ${x} ${y + h - bottomRy}`);
  } else {
    parts.push(`L ${x + w} ${y + h}`, `H ${x}`, `L ${x} ${y + h - bottomRy}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

function polygonPath(
  x: number,
  y: number,
  w: number,
  h: number,
  points: Array<{ x: number; y: number }>,
): string {
  if (!Array.isArray(points) || points.length < 3) return rectanglePath(x, y, w, h);
  const abs = points.map((p) => `${x + Math.min(1, Math.max(0, Number(p.x) || 0)) * w} ${y + Math.min(1, Math.max(0, Number(p.y) || 0)) * h}`);
  return `M ${abs[0]} L ${abs.slice(1).join(" L ")} Z`;
}

// Scale a custom path authored against a viewBox into the frame rect. Only
// numeric scaling of coordinates is safe for arbitrary path data, so custom
// paths are wrapped in an SVG transform by callers instead; here we return the
// raw d plus the transform pieces.
export type MaskPathResult = {
  d: string;
  // When set, the path must be wrapped in a transform (custom viewBox paths).
  transform?: string;
};

export function getMaskPath(
  mask: MaskShape | undefined | null,
  frame: { x: number; y: number; width: number; height: number },
): MaskPathResult {
  const { x, y, width: w, height: h } = frame;
  const kind = mask?.kind || "rectangle";

  switch (kind) {
    case "rounded": {
      const radius = mask && "radius" in mask ? Number(mask.radius) : Math.min(w, h) * 0.08;
      return { d: roundedRectPath(x, y, w, h, radius || Math.min(w, h) * 0.08) };
    }
    case "circle":
      return { d: circlePath(x, y, w, h) };
    case "oval":
      return { d: ellipsePath(x, y, w, h) };
    case "arch":
      return { d: archPath(x, y, w, h, true, true) };
    case "arch-top":
      return { d: archPath(x, y, w, h, true, false) };
    case "arch-bottom":
      return { d: archPath(x, y, w, h, false, true) };
    case "polygon":
      return { d: polygonPath(x, y, w, h, mask && "points" in mask ? mask.points : []) };
    case "path": {
      if (mask && "d" in mask && mask.d && mask.viewBoxWidth > 0 && mask.viewBoxHeight > 0) {
        const sx = w / mask.viewBoxWidth;
        const sy = h / mask.viewBoxHeight;
        return { d: mask.d, transform: `translate(${x} ${y}) scale(${sx} ${sy})` };
      }
      return { d: rectanglePath(x, y, w, h) };
    }
    case "rectangle":
    default:
      return { d: rectanglePath(x, y, w, h) };
  }
}

// Map legacy V1 maskShape strings onto V2 MaskShape objects. V1 knew
// rectangle | rounded | circle | arch — "arch" always meant the top arch.
export function maskShapeFromLegacy(value: string | undefined | null, width = 0, height = 0): MaskShape {
  switch (String(value || "").toLowerCase()) {
    case "rounded":
      return { kind: "rounded", radius: Math.min(width, height) * 0.08 };
    case "circle":
      return { kind: "circle" };
    case "oval":
      return { kind: "oval" };
    case "arch":
    case "arch-top":
      return { kind: "arch-top" };
    case "arch-bottom":
      return { kind: "arch-bottom" };
    case "arch-full":
      return { kind: "arch" };
    default:
      return { kind: "rectangle" };
  }
}

// The legacy renderer keeps passing plain strings around; give it a helper so
// existing call sites can adopt real arch clipping without a full V2 migration.
export function getLegacyMaskPath(
  maskShape: string | undefined | null,
  frame: { x: number; y: number; width: number; height: number },
): MaskPathResult {
  return getMaskPath(maskShapeFromLegacy(maskShape, frame.width, frame.height), frame);
}
