/**
 * Stable identity for every interactive Konva node (spec §51).
 *
 * Konva reconciles by node, React reconciles by key, and both must agree with
 * the Husnalogy document. Array indices cannot do that job: deleting layer 2
 * would silently hand layer 3's identity — its selection, its transformer, its
 * in-flight gesture — to a different object.
 *
 * So identity is always derived from the Husnalogy layer id. Grid slots, which
 * have no layer id of their own, get a deterministic composite.
 *
 * These strings live only in the browser interaction graph. They are never
 * persisted: the document continues to store `layerId` and `slots[].id`
 * separately, exactly as it does today.
 */

export const GRID_SLOT_SEPARATOR = "::";

export type InteractionNodeId = string;

export function layerNodeId(layerId: string): InteractionNodeId {
  return String(layerId);
}

export function gridSlotNodeId(layerId: string, slotId: string): InteractionNodeId {
  return `${layerId}${GRID_SLOT_SEPARATOR}${slotId}`;
}

export type ParsedNodeId =
  | { kind: "layer"; layerId: string }
  | { kind: "grid-slot"; layerId: string; slotId: string };

export function parseNodeId(nodeId: string): ParsedNodeId | null {
  const raw = String(nodeId || "");
  if (!raw) return null;
  const index = raw.indexOf(GRID_SLOT_SEPARATOR);
  if (index < 0) return { kind: "layer", layerId: raw };
  const layerId = raw.slice(0, index);
  const slotId = raw.slice(index + GRID_SLOT_SEPARATOR.length);
  if (!layerId || !slotId) return null;
  return { kind: "grid-slot", layerId, slotId };
}

/** The document layer a node belongs to, whether it is a layer or a slot. */
export function owningLayerId(nodeId: string): string | null {
  const parsed = parseNodeId(nodeId);
  return parsed ? parsed.layerId : null;
}
