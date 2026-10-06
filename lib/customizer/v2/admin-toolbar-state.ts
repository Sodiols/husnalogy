// The Design Studio's contextual toolbar: which toolbar a selection gets, and
// which Alignment-panel actions it can use.
//
// Both answers are pure functions of the selected layers, so the toolbar, the
// Alignment panel and their tests agree, and the result never depends on the
// order the objects were selected in.

import { findClipMaskPair } from "./clipping-mask";

type AnyLayer = Record<string, any>;

/**
 * - text / shape / line / image: exactly one object of that kind
 * - object: one other object (decorative element, QR code, photo grid…)
 * - group: one group
 * - mask: exactly one photo plus one shape that can clip it (ranks above multi)
 * - multi: any other selection of two or more
 */
export type AdminToolbarKind = "text" | "shape" | "line" | "image" | "object" | "group" | "mask" | "multi";

export function adminToolbarKind(layers: readonly AnyLayer[]): AdminToolbarKind | null {
  const present = layers.filter(Boolean);
  if (!present.length) return null;
  if (present.length > 1) return findClipMaskPair(present) ? "mask" : "multi";
  const [layer] = present;
  switch (layer.type) {
    case "text":
      return "text";
    case "shape":
      return layer.shape === "line" ? "line" : "shape";
    case "image":
    case "frame":
      return "image";
    case "group":
      return "group";
    default:
      return "object";
  }
}

/** Where alignment and distribution measure from (the panel's Selection / Artboard radios). */
export type AlignmentTarget = "selection" | "artboard";

export type PanelAction = { enabled: boolean; reason: string };

export type AlignmentPanelAvailability = {
  /** Selection is meaningful only for two or more objects; one object always aligns to the artboard. */
  selectionTarget: PanelAction;
  align: PanelAction;
  distribute: PanelAction;
  flip: PanelAction;
  scale: PanelAction;
  rotate: PanelAction;
};

/**
 * Which Alignment-panel actions a selection can use. Distributing within the
 * selection needs three objects (the outer two stay put); across the artboard,
 * two are enough because the card edges are the fixed ends.
 */
export function alignmentPanelAvailability(input: {
  selectionCount: number;
  canTransform: boolean;
  distributeTarget: AlignmentTarget;
}): AlignmentPanelAvailability {
  const { selectionCount, canTransform, distributeTarget } = input;
  const none: PanelAction = { enabled: false, reason: "Select an object first." };
  const locked: PanelAction = { enabled: false, reason: "Unlock the selection first." };
  const gate = (allowed: boolean, blocked: string, reason: string): PanelAction => {
    if (selectionCount < 1) return none;
    if (!canTransform) return locked;
    return allowed ? { enabled: true, reason } : { enabled: false, reason: blocked };
  };
  const distributeMin = distributeTarget === "artboard" ? 2 : 3;
  return {
    selectionTarget:
      selectionCount >= 2
        ? { enabled: true, reason: "Align to the edges of the selected objects" }
        : { enabled: false, reason: "One object always aligns to the artboard." },
    align: gate(true, "", "Align"),
    distribute: gate(
      selectionCount >= distributeMin,
      distributeMin === 3 ? "Select at least three objects to distribute within the selection." : "Select at least two objects to distribute across the artboard.",
      "Space the objects evenly",
    ),
    flip: gate(true, "", "Mirror the selection"),
    scale: gate(true, "", "Resize the selection"),
    rotate: gate(true, "", "Rotate the selection"),
  };
}

/** One click of Scale Smaller / Scale Larger. */
export const SCALE_STEP = 1.1;
/** One click of the Alignment panel's rotate buttons. */
export const ROTATE_STEP = 90;
/** A shape's line weight, in canvas pixels. */
export const LINE_WEIGHT_RULES = { minimum: 0, maximum: 200, step: 1, largeStep: 5 } as const;
