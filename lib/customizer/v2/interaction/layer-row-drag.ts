/**
 * Live drag geometry for a layers list.
 *
 * The admin Layers panel lets a row be picked up and dragged; while it moves,
 * the rows it passes slide out of its way. This module is the pure part of
 * that: which rows travel with the dragged one, which sibling slots exist, and
 * — for a pointer offset — how far each other row shifts and which layer's
 * slot the drag would take on release.
 *
 * A drag only reorders WITHIN the dragged layer's own parent (the same rule as
 * `isValidLayerDrop`), so only its siblings take part. An open group travels
 * and shifts as one block with the child rows listed under it.
 */

export type LayerRowLike = { layer: { id: string; groupId?: string | null }; depth: number };
export type RowRect = { top: number; bottom: number };

type Block = { ownerId: string; rowIds: string[]; top: number; bottom: number };

export type LayerRowDragPlan = {
  sourceId: string;
  /** Row ids that move with the pointer: the dragged row and its open children. */
  block: string[];
  /** Sibling blocks top to bottom, the dragged one included. */
  blocks: Block[];
  sourceIndex: number;
  /** Height of the dragged block plus the gap that follows it. */
  span: number;
};

export function planLayerRowDrag(rows: readonly LayerRowLike[], sourceId: string, rects: Record<string, RowRect>): LayerRowDragPlan | null {
  const sourceRow = rows.find((row) => row.layer.id === sourceId);
  if (!sourceRow) return null;
  const parent = String(sourceRow.layer.groupId || "");
  const depth = sourceRow.depth;

  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const row of rows) {
    const rect = rects[row.layer.id];
    const sibling = row.depth === depth && String(row.layer.groupId || "") === parent;
    if (sibling) {
      if (!rect) return null;
      current = { ownerId: row.layer.id, rowIds: [row.layer.id], top: rect.top, bottom: rect.bottom };
      blocks.push(current);
    } else if (current && row.depth > depth) {
      // A child row listed under an open sibling group moves with that group.
      current.rowIds.push(row.layer.id);
      if (rect) current.bottom = Math.max(current.bottom, rect.bottom);
    } else {
      current = null;
    }
  }
  const sourceIndex = blocks.findIndex((block) => block.ownerId === sourceId);
  if (sourceIndex < 0 || blocks.length < 2) return null;
  const source = blocks[sourceIndex];
  const next = blocks[sourceIndex + 1];
  const previous = blocks[sourceIndex - 1];
  const gap = next ? next.top - source.bottom : previous ? source.top - previous.bottom : 0;
  return { sourceId, block: source.rowIds, blocks, sourceIndex, span: source.bottom - source.top + Math.max(0, gap) };
}

/**
 * Where the drag stands for a pointer offset `offset` (px, positive = down).
 *
 * `dy` is clamped so the row cannot be pulled far past the list's ends.
 * `targetId` is the sibling whose slot the dragged layer takes — exactly the
 * `targetId` of `reorderLayersByDrop` — or null when it would not move.
 */
export function resolveLayerRowDrop(plan: LayerRowDragPlan, offset: number) {
  const { blocks, sourceIndex, span } = plan;
  const source = blocks[sourceIndex];
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const height = source.bottom - source.top;
  const dy = Math.min(Math.max(offset, first.top - source.top - height / 2), last.bottom - source.bottom + height / 2);
  const centre = (source.top + source.bottom) / 2 + dy;

  // The new index is how many other sibling blocks now sit above the dragged one.
  let index = 0;
  blocks.forEach((block, i) => {
    if (i !== sourceIndex && (block.top + block.bottom) / 2 < centre) index += 1;
  });

  const shifts: Record<string, number> = {};
  blocks.forEach((block, i) => {
    let shift = 0;
    if (index > sourceIndex && i > sourceIndex && i <= index) shift = -span;
    if (index < sourceIndex && i >= index && i < sourceIndex) shift = span;
    if (shift) for (const id of block.rowIds) shifts[id] = shift;
  });

  const targetId = index === sourceIndex ? null : blocks[index].ownerId;
  return { dy, index, shifts, targetId };
}
