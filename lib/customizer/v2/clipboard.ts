/**
 * Cloning layers safely — duplicate, copy and paste (spec §18, §32).
 *
 * All three commands answer the same two questions, and they answered them
 * differently:
 *
 *   1. WHAT gets cloned. Duplicate expanded a selected group into the group
 *      plus every descendant; copy stored only the selected rows. Copying a
 *      group therefore captured the container and none of its contents.
 *   2. How the clones REFER to each other. Duplicate built an id map and
 *      rewrote `groupId` / `childIds` through it; paste forced `groupId: ""`
 *      on everything and left `childIds` pointing at the ORIGINALS. A pasted
 *      group was a container whose children were somebody else's, which
 *      `validateGroupRelationships` reports as GROUP_PARENT_MISSING and which
 *      makes moving either group drag the other one's contents.
 *
 * Both answers live here now, as pure functions over plain layers, so the three
 * commands cannot drift apart again and the rules are testable without React.
 *
 * Minting the new ids stays with the caller: the customer editor and the admin
 * builder use different id factories and different normalisers, and this module
 * has no business choosing between them. It only needs the clones back in the
 * SAME ORDER as the sources so it can pair them up.
 */

export type CloneSource = {
  id: string;
  type?: string;
  groupId?: string | null;
  childIds?: string[];
};

/**
 * The full set of layers a clone of `ids` must cover: the requested layers plus
 * every descendant of any group among them, in the array's own order so the
 * clones keep their stacking relationship.
 *
 * Deliberately order-preserving rather than selection-ordered — a clone that
 * reshuffles its members is a clone that does not look like what was copied.
 */
export function expandCloneSelection<T extends CloneSource>(
  layers: readonly T[],
  ids: readonly string[],
): T[] {
  const requested = new Set(ids.filter(Boolean).map(String));
  if (!requested.size) return [];

  // Walk down from every requested group. Iterating to a fixed point handles
  // nesting at any depth; `seen` makes a corrupt parent cycle terminate rather
  // than hang the editor.
  const included = new Set(requested);
  const seen = new Set<string>();
  let queue = Array.from(requested);
  while (queue.length) {
    const parentId = queue.shift() as string;
    if (seen.has(parentId)) continue;
    seen.add(parentId);
    for (const layer of layers) {
      if (String(layer?.groupId || "") !== parentId) continue;
      if (included.has(layer.id)) continue;
      included.add(layer.id);
      queue.push(layer.id);
    }
  }

  return layers.filter((layer) => layer && included.has(layer.id));
}

/**
 * Point the clones at each other instead of at their sources.
 *
 * `clones[i]` must be the clone of `sources[i]` — that pairing is the whole
 * input, because the new ids were minted by the caller.
 *
 * A `groupId` whose parent was NOT part of the clone set resolves to "" rather
 * than to the original parent: the copy becomes a top-level object. Adopting it
 * into the source's group would silently change a group the customer did not
 * touch, and is the behaviour every editor has for pasting part of a group.
 */
export function relinkClones<T extends CloneSource>(
  sources: readonly CloneSource[],
  clones: readonly T[],
): T[] {
  const idMap = new Map<string, string>();
  sources.forEach((source, index) => {
    const clone = clones[index];
    if (source?.id && clone?.id) idMap.set(String(source.id), String(clone.id));
  });

  return clones.map((clone, index) => {
    const source = sources[index];
    const next: T = { ...clone };
    next.groupId = idMap.get(String(source?.groupId || "")) || "";
    if (Array.isArray(source?.childIds)) {
      // Only children that were themselves cloned may be listed. A stale id
      // here is what makes a pasted group reach into the original.
      next.childIds = source.childIds
        .map((childId) => idMap.get(String(childId)))
        .filter((childId): childId is string => Boolean(childId));
    }
    return next;
  });
}

/**
 * Every id a clone set introduces, for callers that want to select the result.
 * Returns the clones of the originally requested ids only, so selecting after a
 * duplicate lands on the objects the customer picked rather than on every
 * descendant that came along with them.
 */
export function clonedIdsFor(
  sources: readonly CloneSource[],
  clones: readonly CloneSource[],
  requestedIds: readonly string[],
): string[] {
  const requested = new Set(requestedIds.filter(Boolean).map(String));
  const result: string[] = [];
  sources.forEach((source, index) => {
    if (!requested.has(String(source?.id))) return;
    const clone = clones[index];
    if (clone?.id) result.push(String(clone.id));
  });
  return result;
}
