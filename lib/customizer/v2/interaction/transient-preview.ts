/**
 * Transient gesture preview (spec §9 "Transient interaction state", §49).
 *
 * The reason to reach for Konva at all is that a drag must not cost a document
 * update per pointer event. In the old workspace every `pointermove` called
 * `onLayerTransform(..., "move")`, which set React state, which re-derived the
 * page's effective layers, re-measured every text object on a canvas context
 * and re-rendered the whole SVG. That is the lag.
 *
 * The fix is to separate WHAT THE USER SEES during a gesture from WHAT THE
 * DOCUMENT SAYS. While a gesture is live:
 *
 *   - Konva owns the handles, outlines and guides (its own layer, its own draw).
 *   - The artwork follows by writing ONE `transform` attribute onto the SVG
 *     group the shared renderer already emits for that layer.
 *   - The Husnalogy document is not touched at all.
 *
 * On release the gesture commits normalised geometry once, React re-renders the
 * real thing, and the transient transform is removed in the same frame.
 *
 * The attribute path covers transforms that do not change LAYOUT — translation
 * and rotation. A resize can change text wrapping, so it is NOT previewed as a
 * scale here; it publishes real in-progress geometry to the per-layer
 * `TransientGeometryStore` below, which re-renders only the resized layers
 * through the production renderer. Neither path touches the document.
 */

export type TransientTransform = {
  /** Translation in DOCUMENT units. */
  dx?: number;
  dy?: number;
  /** Absolute rotation in degrees, applied about (pivotX, pivotY). */
  rotation?: number;
  pivotX?: number;
  pivotY?: number;
  /** Rotation the layer already carries, which the override replaces. */
  baseRotation?: number;
  /** Live resize factors, about the pivot. 1 means unchanged. */
  scaleX?: number;
  scaleY?: number;
};

const SCALE_EPSILON = 1e-4;

/** The SVG group the shared renderer emits for a layer, if it is mounted. */
export function findLayerNode(root: Element | null | undefined, layerId: string): SVGGraphicsElement | null {
  if (!root || !layerId) return null;
  const escaped = String(layerId).replace(/["\\]/g, "\\$&");
  return root.querySelector<SVGGraphicsElement>(`[data-layer-id="${escaped}"]`);
}

/**
 * The SVG transform string for a transient gesture, in the renderer's own
 * coordinate space (document units, applied to the layer group).
 *
 * Rotation is expressed as "undo what the layer already has, then apply the new
 * angle" so it composes with the rotation the renderer baked into the layer's
 * own children — the alternative would be double-rotating every object.
 */
export function transientTransformString(transform: TransientTransform): string {
  const parts: string[] = [];
  const dx = Number(transform?.dx) || 0;
  const dy = Number(transform?.dy) || 0;
  if (dx || dy) parts.push(`translate(${dx} ${dy})`);

  const pivotX = Number(transform?.pivotX) || 0;
  const pivotY = Number(transform?.pivotY) || 0;
  const base = Number(transform?.baseRotation) || 0;
  const scaleX = Number.isFinite(Number(transform?.scaleX)) ? Number(transform!.scaleX) : 1;
  const scaleY = Number.isFinite(Number(transform?.scaleY)) ? Number(transform!.scaleY) : 1;
  const scaled = Math.abs(scaleX - 1) > SCALE_EPSILON || Math.abs(scaleY - 1) > SCALE_EPSILON;
  const rotation =
    typeof transform?.rotation === "number" && Number.isFinite(transform.rotation) ? transform.rotation : null;
  const rotationDelta = rotation === null ? 0 : rotation - base;

  // A pure rotation needs one term. A resize needs the full sandwich, because
  // the renderer has ALREADY baked the layer's own rotation into its children:
  // the scale has to be applied in the object's UNROTATED frame or a rotated
  // box would shear instead of resizing along its own axes.
  //
  //   rotate(new)  scale(sx, sy)  rotate(-base)      [read right-to-left]
  //
  // all about the object's centre, with the translation applied last.
  if (scaled) {
    if (rotationDelta || base) parts.push(`rotate(${rotationDelta + base} ${pivotX} ${pivotY})`);
    parts.push(`translate(${pivotX} ${pivotY})`);
    parts.push(`scale(${scaleX} ${scaleY})`);
    parts.push(`translate(${-pivotX} ${-pivotY})`);
    if (base) parts.push(`rotate(${-base} ${pivotX} ${pivotY})`);
  } else if (rotationDelta) {
    parts.push(`rotate(${rotationDelta} ${pivotX} ${pivotY})`);
  }

  return parts.join(" ");
}

/**
 * Apply a transient transform to one layer's rendered group.
 *
 * Writing the attribute directly is deliberate: this runs inside a pointer
 * handler at up to 120Hz, and routing it through React would reintroduce
 * exactly the re-render this exists to avoid.
 */
export function applyTransientTransform(
  root: Element | null | undefined,
  layerId: string,
  transform: TransientTransform,
): void {
  const node = findLayerNode(root, layerId);
  if (!node) return;
  const value = transientTransformString(transform);
  if (value) node.setAttribute("transform", value);
  else node.removeAttribute("transform");
}

/**
 * Remove every transient transform. Called on gesture end, on cancel, and
 * whenever the interaction layer unmounts, so a stale preview can never survive
 * into the committed view.
 */
export function clearTransientTransforms(root: Element | null | undefined, layerIds?: Iterable<string>): void {
  if (!root) return;
  if (layerIds) {
    for (const layerId of layerIds) findLayerNode(root, layerId)?.removeAttribute("transform");
    return;
  }
  const nodes = root.querySelectorAll<SVGGraphicsElement>("[data-layer-id][transform]");
  nodes.forEach((node) => node.removeAttribute("transform"));
}

/**
 * Coalesce gesture work to one call per animation frame.
 *
 * Pointer events can arrive faster than the display refreshes (120Hz+ pointers,
 * coalesced move events); doing layout work per event is wasted effort that
 * only makes the gesture feel worse.
 */
export function createFrameScheduler(): {
  schedule: (task: () => void) => void;
  flush: () => void;
  cancel: () => void;
} {
  let handle: number | null = null;
  let pending: (() => void) | null = null;

  const run = () => {
    handle = null;
    const task = pending;
    pending = null;
    task?.();
  };

  // Resolved per call rather than captured once. A scheduler can be created
  // during a server render or before the host has installed its own frame
  // implementation, and capturing the fallback at construction time would pin
  // it to `setTimeout` for the rest of the session.
  const raf = (callback: FrameRequestCallback): number =>
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(callback)
      : (setTimeout(() => callback(Date.now()), 16) as unknown as number);
  const cancelRaf = (id: number): void => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
    else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  };

  return {
    schedule(task: () => void) {
      pending = task;
      if (handle === null) handle = raf(run);
    },
    /** Run any queued work NOW — used on gesture end so nothing is dropped. */
    flush() {
      if (handle !== null) {
        cancelRaf(handle);
        handle = null;
      }
      const task = pending;
      pending = null;
      task?.();
    },
    cancel() {
      if (handle !== null) {
        cancelRaf(handle);
        handle = null;
      }
      pending = null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Localized transient geometry (spec §19–§23 of the hardening brief)          */
/* -------------------------------------------------------------------------- */

/** In-progress values for one layer, merged over its committed values. */
export type GeometryOverride = Record<string, unknown>;

/**
 * Per-layer, subscribable home for geometry that a live gesture needs RENDERED
 * but that must not reach the document.
 *
 * Why not React state: resize, rotation and crop used to publish every frame
 * through `useState` on the workspace. Each publish re-rendered the workspace,
 * the whole preview and every layer in it — on a busy card, dozens of text
 * layouts re-derived 60 times a second to move one object.
 *
 * With this store a publish notifies ONLY the layers whose override changed.
 * The workspace and the preview shell do not render at all; the affected layer
 * re-renders through the production renderer, so text still wraps and photos
 * still re-fit exactly as they will once committed.
 */
export type TransientGeometryStore = {
  /** Replace every live override (null clears them all). */
  set: (overrides: Record<string, GeometryOverride> | null) => void;
  get: (layerId: string) => GeometryOverride | null;
  subscribe: (layerId: string, listener: () => void) => () => void;
  /** Number of layers currently carrying an override. */
  size: () => number;
};

export function createTransientGeometryStore(): TransientGeometryStore {
  let current = new Map<string, GeometryOverride>();
  const listeners = new Map<string, Set<() => void>>();

  const notify = (layerId: string) => {
    listeners.get(layerId)?.forEach((listener) => listener());
  };

  return {
    set(overrides) {
      const next = new Map<string, GeometryOverride>(overrides ? Object.entries(overrides) : []);
      const changed = new Set<string>();
      for (const [layerId, value] of next) if (current.get(layerId) !== value) changed.add(layerId);
      for (const layerId of current.keys()) if (!next.has(layerId)) changed.add(layerId);
      current = next;
      changed.forEach(notify);
    },
    get: (layerId) => current.get(layerId) ?? null,
    subscribe(layerId, listener) {
      let set = listeners.get(layerId);
      if (!set) {
        set = new Set();
        listeners.set(layerId, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (!set!.size) listeners.delete(layerId);
      };
    },
    size: () => current.size,
  };
}
