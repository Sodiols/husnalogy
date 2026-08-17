// Shared snapping + smart guides for the customer customizer and the admin
// design builder (spec §12 "Snapping and smart guides").
//
// The previous implementation on both surfaces collected a list of target
// coordinates (page centre, page edges, safe-area edges, other layers' centres
// and — in the customer workspace — their edges) and then compared them against
// exactly ONE number: the dragged object's CENTRE.
//
// That is not edge snapping, it is centre snapping against a mixed bag of
// lines, and it produced three concrete defects:
//
//   1. Aligning two objects by their left edges was impossible. The only thing
//      that could ever land on another object's left edge was the dragged
//      object's centre, which visually overlaps rather than aligns.
//   2. Snapping to a page edge parked the object half off the page, because its
//      centre — not its edge — was placed on x=0.
//   3. Safe-area snapping had the same half-off-the-margin behaviour, which is
//      actively harmful on a print product where the safe area is the promise
//      that artwork will not be trimmed.
//
// Real editors compare EVERY edge and centre of the moving box against every
// candidate line. That is what this module does, and being pure it is testable
// without a DOM, which the old inline implementations were not.
//
// Nothing here draws anything or touches the document: it returns a delta plus
// the guide segments to paint on the interaction overlay. Guides are overlay
// only and never reach `buildPageSvg`, so they cannot enter print output.

import { transformedLayerBounds, type SelectionRect } from "./selection-geometry";

/** What produced a candidate line. Drives guide styling and tie-breaking. */
export type SnapTargetKind =
  | "page-center"
  | "page-edge"
  | "safe-area"
  | "object-center"
  | "object-edge"
  | "guide";

export type SnapTarget = {
  /** Position along the snapping axis, in document units. */
  position: number;
  kind: SnapTargetKind;
  /**
   * Extent along the OTHER axis. Lets the caller draw a guide that spans the
   * objects being aligned instead of a full-bleed line across the page.
   */
  start?: number;
  end?: number;
};

export type SnapTargets = { x: SnapTarget[]; y: SnapTarget[] };

/**
 * A guide to paint while dragging. `type`/`at` are deliberately named to match
 * the shape both canvases already render, so wiring this in does not require
 * rewriting their overlay markup.
 */
export type SmartGuide = {
  type: "v" | "h";
  at: number;
  kind: SnapTargetKind;
  /** Segment extent along the perpendicular axis, in document units. */
  start: number;
  end: number;
};

export type EdgeInsetsLike = {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
};

export type SnapObject = {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  hidden?: boolean;
  type?: string;
};

export type GuideLike = {
  axis?: "horizontal" | "vertical";
  position?: number;
  hidden?: boolean;
  pageId?: string;
};

export type BuildSnapTargetsInput = {
  pageWidth: number;
  pageHeight: number;
  /** Safe-area INSETS, matching `template.safeArea`. */
  safeArea?: EdgeInsetsLike | null;
  /** Persisted template guides. Hidden ones are ignored. */
  guides?: readonly GuideLike[] | null;
  /** Candidate neighbours. Hidden layers never attract. */
  objects?: readonly SnapObject[] | null;
  /** Ids excluded from object targets — everything being dragged. */
  excludeIds?: Iterable<string> | null;
  /** Restrict guides to one page when they carry a pageId. */
  pageId?: string | null;
};

const finite = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Every line the moving box may snap to, split per axis.
 *
 * A full-page background is skipped for the same reason the marquee skips it:
 * its edges coincide with the page edges, so it would double every page-edge
 * target and win ties for the wrong reason.
 */
export function buildSnapTargets(input: BuildSnapTargetsInput): SnapTargets {
  const pageWidth = finite(input?.pageWidth) ?? 0;
  const pageHeight = finite(input?.pageHeight) ?? 0;
  const x: SnapTarget[] = [];
  const y: SnapTarget[] = [];

  const pageSpanY = { start: 0, end: pageHeight };
  const pageSpanX = { start: 0, end: pageWidth };

  if (pageWidth > 0) {
    x.push({ position: pageWidth / 2, kind: "page-center", ...pageSpanY });
    x.push({ position: 0, kind: "page-edge", ...pageSpanY });
    x.push({ position: pageWidth, kind: "page-edge", ...pageSpanY });
  }
  if (pageHeight > 0) {
    y.push({ position: pageHeight / 2, kind: "page-center", ...pageSpanX });
    y.push({ position: 0, kind: "page-edge", ...pageSpanX });
    y.push({ position: pageHeight, kind: "page-edge", ...pageSpanX });
  }

  const safe = input?.safeArea;
  if (safe) {
    const left = finite(safe.left) ?? 0;
    const top = finite(safe.top) ?? 0;
    const right = finite(safe.right) ?? 0;
    const bottom = finite(safe.bottom) ?? 0;
    if (left > 0) x.push({ position: left, kind: "safe-area", ...pageSpanY });
    if (right > 0) x.push({ position: pageWidth - right, kind: "safe-area", ...pageSpanY });
    if (top > 0) y.push({ position: top, kind: "safe-area", ...pageSpanX });
    if (bottom > 0) y.push({ position: pageHeight - bottom, kind: "safe-area", ...pageSpanX });
  }

  for (const guide of input?.guides ?? []) {
    if (!guide || guide.hidden) continue;
    const position = finite(guide.position);
    if (position === null) continue;
    if (input?.pageId && guide.pageId && guide.pageId !== input.pageId) continue;
    if (guide.axis === "vertical") x.push({ position, kind: "guide", ...pageSpanY });
    else if (guide.axis === "horizontal") y.push({ position, kind: "guide", ...pageSpanX });
  }

  const excluded = new Set<string>();
  for (const id of input?.excludeIds ?? []) if (id) excluded.add(String(id));

  for (const object of input?.objects ?? []) {
    if (!object || object.hidden) continue;
    if (object.type === "background") continue;
    if (object.id && excluded.has(String(object.id))) continue;
    const bounds = transformedLayerBounds(object);
    if (![bounds.left, bounds.right, bounds.top, bounds.bottom].every(Number.isFinite)) continue;
    const spanY = { start: bounds.top, end: bounds.bottom };
    const spanX = { start: bounds.left, end: bounds.right };
    x.push({ position: bounds.left, kind: "object-edge", ...spanY });
    x.push({ position: (bounds.left + bounds.right) / 2, kind: "object-center", ...spanY });
    x.push({ position: bounds.right, kind: "object-edge", ...spanY });
    y.push({ position: bounds.top, kind: "object-edge", ...spanX });
    y.push({ position: (bounds.top + bounds.bottom) / 2, kind: "object-center", ...spanX });
    y.push({ position: bounds.bottom, kind: "object-edge", ...spanX });
  }

  return { x, y };
}

// A centre landing on a centre is the alignment people mean most often, so it
// wins ties against an edge that happens to sit the same distance away.
const KIND_PRIORITY: Record<SnapTargetKind, number> = {
  "page-center": 5,
  "object-center": 4,
  guide: 3,
  "safe-area": 2,
  "object-edge": 1,
  "page-edge": 1,
};
const MOVING_LINE_PRIORITY = { center: 2, start: 1, end: 1 } as const;

type MovingLine = "start" | "center" | "end";

type AxisMatch = {
  delta: number;
  target: SnapTarget;
  movingLine: MovingLine;
};

/**
 * Best match on ONE axis: every line of the moving box (leading edge, centre,
 * trailing edge) against every candidate line. Ties break toward centres, then
 * toward the smaller absolute movement, so the result is deterministic.
 */
function bestAxisMatch(
  low: number,
  high: number,
  targets: readonly SnapTarget[],
  tolerance: number,
): AxisMatch | null {
  if (!Number.isFinite(low) || !Number.isFinite(high) || !(tolerance > 0)) return null;
  const center = (low + high) / 2;
  const lines: Array<{ line: MovingLine; value: number }> = [
    { line: "start", value: low },
    { line: "center", value: center },
    { line: "end", value: high },
  ];

  let best: AxisMatch | null = null;
  for (const target of targets) {
    const position = Number(target?.position);
    if (!Number.isFinite(position)) continue;
    for (const { line, value } of lines) {
      const delta = position - value;
      const distance = Math.abs(delta);
      if (distance > tolerance) continue;
      if (!best) {
        best = { delta, target, movingLine: line };
        continue;
      }
      const bestDistance = Math.abs(best.delta);
      if (distance < bestDistance - 1e-9) {
        best = { delta, target, movingLine: line };
        continue;
      }
      if (distance > bestDistance + 1e-9) continue;
      const score = KIND_PRIORITY[target.kind] * 10 + MOVING_LINE_PRIORITY[line];
      const bestScore = KIND_PRIORITY[best.target.kind] * 10 + MOVING_LINE_PRIORITY[best.movingLine];
      if (score > bestScore) best = { delta, target, movingLine: line };
    }
  }
  return best;
}

export type SnapBoundsInput = {
  /** Axis-aligned bounds of the moving object at its unsnapped position. */
  bounds: SelectionRect;
  targets: SnapTargets;
  /** Snap radius in DOCUMENT units — callers divide screen pixels by scale. */
  tolerance: number;
};

export type SnapBoundsResult = {
  dx: number;
  dy: number;
  guides: SmartGuide[];
};

/**
 * The correction that pulls `bounds` onto the nearest candidate lines, plus the
 * guides to draw. Returns a zero delta and no guides when nothing is in range,
 * so callers can apply the result unconditionally.
 */
export function snapBounds({ bounds, targets, tolerance }: SnapBoundsInput): SnapBoundsResult {
  const left = Number(bounds?.left);
  const right = Number(bounds?.right);
  const top = Number(bounds?.top);
  const bottom = Number(bounds?.bottom);
  const guides: SmartGuide[] = [];

  const matchX = bestAxisMatch(left, right, targets?.x ?? [], tolerance);
  const matchY = bestAxisMatch(top, bottom, targets?.y ?? [], tolerance);
  const dx = matchX ? matchX.delta : 0;
  const dy = matchY ? matchY.delta : 0;

  if (matchX) {
    // The guide spans the target's own extent unioned with where the moving box
    // ends up, so it visibly connects the two aligned objects.
    const movedTop = top + dy;
    const movedBottom = bottom + dy;
    guides.push({
      type: "v",
      at: matchX.target.position,
      kind: matchX.target.kind,
      start: Math.min(matchX.target.start ?? movedTop, movedTop),
      end: Math.max(matchX.target.end ?? movedBottom, movedBottom),
    });
  }
  if (matchY) {
    const movedLeft = left + dx;
    const movedRight = right + dx;
    guides.push({
      type: "h",
      at: matchY.target.position,
      kind: matchY.target.kind,
      start: Math.min(matchY.target.start ?? movedLeft, movedLeft),
      end: Math.max(matchY.target.end ?? movedRight, movedRight),
    });
  }

  return { dx, dy, guides };
}

export type SnapMoveInput = {
  /** Proposed CENTRE of the moving object, before snapping. */
  x: number;
  y: number;
  /** Axis-aligned half extents (rotation already accounted for). */
  halfWidth: number;
  halfHeight: number;
  targets: SnapTargets;
  tolerance: number;
  /** Set false to pass the position straight through (admin snap toggle). */
  enabled?: boolean;
};

export type SnapMoveResult = { x: number; y: number; guides: SmartGuide[] };

/**
 * Drop-in replacement for the old `applySnap(x, y)`: takes and returns the
 * object's centre, rounded to whole document pixels the way every transform in
 * this codebase stores geometry.
 */
export function snapMove({
  x,
  y,
  halfWidth,
  halfHeight,
  targets,
  tolerance,
  enabled = true,
}: SnapMoveInput): SnapMoveResult {
  const centerX = Number(x) || 0;
  const centerY = Number(y) || 0;
  if (!enabled) return { x: Math.round(centerX), y: Math.round(centerY), guides: [] };
  const halfW = Math.abs(Number(halfWidth) || 0);
  const halfH = Math.abs(Number(halfHeight) || 0);
  const { dx, dy, guides } = snapBounds({
    bounds: {
      left: centerX - halfW,
      right: centerX + halfW,
      top: centerY - halfH,
      bottom: centerY + halfH,
    },
    targets,
    tolerance,
  });
  return { x: Math.round(centerX + dx), y: Math.round(centerY + dy), guides };
}

/**
 * Axis-aligned half extents of a layer, honouring rotation. Callers pass the
 * RESOLVED layer (auto-width text already measured) so handles, guides and the
 * rendered glyphs agree.
 */
export function layerHalfExtents(layer: SnapObject): { halfWidth: number; halfHeight: number } {
  const bounds = transformedLayerBounds(layer);
  return {
    halfWidth: (bounds.right - bounds.left) / 2,
    halfHeight: (bounds.bottom - bounds.top) / 2,
  };
}
