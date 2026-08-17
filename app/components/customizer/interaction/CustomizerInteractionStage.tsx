"use client";

/**
 * The shared Konva interaction layer for BOTH customizers (spec §7, §40, §41).
 *
 * What this is:
 *   a transparent, precisely aligned Konva stage that sits on top of the
 *   artwork the shared SVG renderer draws, and owns selection, hit testing,
 *   dragging, transform handles, marquee and smart guides.
 *
 * What this is NOT:
 *   a renderer, and not a document. The artwork underneath is still
 *   `CustomizerPreview` — the same component that produces thumbnails, review
 *   screens and the server SVG — so what the customer edits is by construction
 *   what gets printed (spec §10, Strategy A). Konva nodes here are invisible
 *   PROXIES whose geometry mirrors the Husnalogy layers; nothing Konva computes
 *   is ever stored. Every gesture ends by handing NORMALISED Husnalogy geometry
 *   back to the owner, which is the only thing that touches the document.
 *
 * Performance contract (spec §4, §49):
 *   EVERY continuous gesture — drag, resize, rotate — is TRANSIENT. Konva owns
 *   the visual, the artwork follows by writing one SVG transform per frame, and
 *   the Husnalogy document is written exactly ONCE, on release, as one history
 *   step. No React render happens while the pointer is moving.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Label, Layer, Line, Rect, Stage, Tag, Text, Transformer } from "react-konva";
import type Konva from "konva";

import {
  buildSnapTargets,
  layerHalfExtents,
  snapMove,
  type SmartGuide,
} from "@/lib/customizer/v2/snapping";
import {
  resolveMarqueeSelection,
  resolvePointerDownSelection,
  resolvePointerUpSelection,
} from "@/lib/customizer/v2/selection";
import { selectionBounds, type SelectionRect } from "@/lib/customizer/v2/selection-geometry";
import { hitTestMarquee, resolveSelectionTarget } from "@/lib/customizer/v2/interaction/hit-test";
import {
  konvaAnchors,
  resolveHandleMetrics,
  resolveHitExtents,
  resolveVisibleHandles,
  type HandleId,
} from "@/lib/customizer/v2/interaction/handles";
import {
  geometryPatch,
  isEmptyPatch,
  normalizeKonvaGeometry,
  normalizeTextScale,
} from "@/lib/customizer/v2/interaction/konva-adapter";
import { applySelectionDelta, rotatePoint, ROTATION_SNAP_STEP } from "@/lib/customizer/v2/interaction/gesture-math";
import { resolvePointerOwner, type ToolMode } from "@/lib/customizer/v2/interaction/tool-mode";
import type { LayerCapabilities } from "@/lib/customizer/v2/interaction/capabilities";
import {
  applyTransientTransform,
  clearTransientTransforms,
  createFrameScheduler,
} from "@/lib/customizer/v2/interaction/transient-preview";

/* -------------------------------------------------------------------------- */
/* Husnalogy brand palette. Gold is the single accent; nothing glows.          */
/* -------------------------------------------------------------------------- */
const GOLD = "#D4AF37";
const CHARCOAL = "#303839";
const WHITE = "#FFFFFF";

export type InteractionNode = {
  id: string;
  type: string;
  /** RESOLVED geometry — auto-width text already measured. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  hidden?: boolean;
  groupId?: string | null;
  capabilities: LayerCapabilities;
  /** Single-line auto-sized text has no independent height (spec §14). */
  singleLineAutoSize?: boolean;
  /** Text style values needed to normalise a font-scaling corner drag. */
  fontSize?: number;
  letterSpacing?: number;
  minFontSize?: number;
  maxFontSize?: number;
  /** Grid slots, in document coordinates (spec §28). */
  slots?: Array<{ id: string; x: number; y: number; width: number; height: number }>;
};

export type GestureCommit = {
  id: string;
  patch: Record<string, unknown>;
};

export type InteractionStageProps = {
  /** Document page size, in document pixels. */
  documentWidth: number;
  documentHeight: number;
  /** Document pixels -> CSS pixels. */
  scale: number;
  /** Permission-filtered, geometry-resolved interaction targets. */
  nodes: readonly InteractionNode[];
  selectedIds: readonly string[];
  editingGroupId?: string | null;
  /** While the DOM text editor is open the canvas must not fight it (spec §37). */
  textEditingId?: string | null;
  /**
   * The canvas tool. Drives pointer PRIORITY through the shared resolver, so
   * "who owns this pointer-down" is answered in one place for both surfaces
   * rather than by the order of early returns in each handler (spec §37, §44).
   */
  toolMode?: ToolMode;
  /** Disables every gesture (preview mode, crop mode, pan mode). */
  disabled?: boolean;
  /** Snapping configuration, or null to disable (spec §16). */
  snapping?: {
    enabled: boolean;
    safeArea?: { left?: number; top?: number; right?: number; bottom?: number } | null;
    guides?: ReadonlyArray<{ axis?: string; position?: number; hidden?: boolean; pageId?: string }> | null;
    pageId?: string | null;
    /** Every layer on the page, so neighbours attract even when not selectable. */
    neighbours?: readonly any[];
  } | null;
  /** The element containing the rendered SVG, for transient gesture previews. */
  previewRootRef?: React.RefObject<HTMLElement | null>;

  onSelectionChange: (ids: string[]) => void;
  /** One history entry per gesture (spec §45). */
  onGestureStart?: () => void;
  onGestureCommit: (changes: GestureCommit[]) => void;
  onDoubleClickNode?: (id: string) => void;
  onContextMenuNode?: (id: string, position: { x: number; y: number }) => void;
  onGridSlotSelect?: (layerId: string, slotId: string) => void;
};

/**
 * Whether the primary pointer is coarse (finger/stylus) rather than a mouse.
 *
 * Read through `useSyncExternalStore` so it stays correct when the input method
 * changes mid-session — a detachable tablet switching between keyboard dock and
 * tablet mode — and so the server render and the first client render agree
 * (the server snapshot is `false`, the mouse default, which is what SSR HTML
 * should describe).
 */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(pointer: coarse)").matches
      : false),
    () => false,
  );
}

type DragSession = {
  leadId: string;
  members: Array<{ id: string; x: number; y: number; width: number; height: number; rotation: number }>;
  startX: number;
  startY: number;
  moved: boolean;
  collapseOnRelease: boolean;
  lastX: number;
  lastY: number;
};

export default function CustomizerInteractionStage({
  documentWidth,
  documentHeight,
  scale,
  nodes,
  selectedIds,
  editingGroupId = null,
  textEditingId = null,
  toolMode,
  disabled = false,
  snapping = null,
  previewRootRef,
  onSelectionChange,
  onGestureStart,
  onGestureCommit,
  onDoubleClickNode,
  onContextMenuNode,
  onGridSlotSelect,
}: InteractionStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const proxyRefs = useRef(new Map<string, Konva.Rect>());
  const guideLayerRef = useRef<Konva.Layer>(null);
  const guideNodesRef = useRef<Konva.Line[]>([]);
  const marqueeRef = useRef<Konva.Rect>(null);
  const dragRef = useRef<DragSession | null>(null);
  const marqueeSessionRef = useRef<null | {
    startX: number;
    startY: number;
    additive: boolean;
    original: string[];
    moved: boolean;
    x: number;
    y: number;
  }>(null);
  const transformStartRef = useRef<Map<string, InteractionNode>>(new Map());
  const angleLabelRef = useRef<Konva.Label>(null);
  const angleTextRef = useRef<Konva.Text>(null);
  /**
   * True for the whole of a drag or transform. Guards every effect that would
   * otherwise reach into Konva mid-gesture — reattaching the Transformer or
   * resetting a node's geometry while the pointer is down is what makes a
   * handle jump out from under the cursor.
   */
  const gestureActiveRef = useRef(false);
  /** Set when a gesture is abandoned, so its own `dragend` commits nothing. */
  const abortedRef = useRef(false);
  const activeTouchesRef = useRef(new Set<number>());
  // Lazily initialised: `useRef(createFrameScheduler())` would build and throw
  // away a scheduler on every single render.
  const schedulerRef = useRef<ReturnType<typeof createFrameScheduler> | null>(null);
  if (!schedulerRef.current) schedulerRef.current = createFrameScheduler();
  // Hover is the only piece of interaction state that legitimately belongs in
  // React: it changes at human speed, not at pointer speed.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  /**
   * Desktop cursor feedback (spec §39). Written straight onto the stage
   * container: routing a cursor change through React state would re-render the
   * whole stage every time the pointer crossed an object boundary.
   *
   * Never applied while a gesture is live, so the cursor cannot flicker back to
   * `default` because the pointer strayed outside the object being dragged.
   */
  const setStageCursor = useCallback((cursor: string) => {
    if (gestureActiveRef.current) return;
    const container = stageRef.current?.container();
    if (container && container.style.cursor !== cursor) container.style.cursor = cursor;
  }, []);

  // Touch devices get larger handles (spec §38). A finger is a far blunter
  // pointer than a mouse, and a 10px anchor that is comfortable with a cursor
  // is smaller than the contact patch of a fingertip — the customer would end
  // up dragging the object instead of resizing it. `pointer: coarse` is the
  // right signal rather than a width breakpoint: a large touchscreen is still
  // touch, and a small window on a laptop is still a mouse.
  const coarsePointer = useCoarsePointer();
  const metrics = useMemo(
    () => resolveHandleMetrics(scale, coarsePointer ? "touch" : "mouse"),
    [scale, coarsePointer],
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selection = useMemo(() => selectedIds.filter((id) => nodeById.has(id)), [selectedIds, nodeById]);

  const interactive = !disabled && !textEditingId;
  // The resting tool when the owner does not track one explicitly. `disabled`
  // already covers pan and crop on both surfaces, so "select" is the honest
  // default rather than a guess.
  const tool: ToolMode = toolMode ?? (textEditingId ? "text-edit" : "select");

  /* ---------------------------------------------------------------------- */
  /* Snapping                                                                */
  /* ---------------------------------------------------------------------- */

  const snapTargetsFor = useCallback(
    (excludeIds: readonly string[]) => {
      if (!snapping?.enabled) return null;
      return buildSnapTargets({
        pageWidth: documentWidth,
        pageHeight: documentHeight,
        safeArea: snapping.safeArea,
        guides: snapping.guides as any,
        pageId: snapping.pageId,
        objects: (snapping.neighbours ?? nodes) as any[],
        excludeIds,
      });
    },
    [snapping, documentWidth, documentHeight, nodes],
  );

  /**
   * Guides are drawn by mutating Konva line nodes directly rather than through
   * React state. A guide changes on every frame of a drag; routing that through
   * `setState` would re-render the whole stage 60 times a second, which is the
   * cost this layer exists to remove.
   */
  const paintGuides = useCallback(
    (guides: readonly SmartGuide[]) => {
      const layer = guideLayerRef.current;
      if (!layer) return;
      const lines = guideNodesRef.current;
      lines.forEach((line, index) => {
        const guide = guides[index];
        if (!guide) {
          line.visible(false);
          return;
        }
        line.visible(true);
        line.strokeWidth(metrics.strokeWidth);
        line.points(
          guide.type === "v"
            ? [guide.at, guide.start, guide.at, guide.end]
            : [guide.start, guide.at, guide.end, guide.at],
        );
      });
      layer.batchDraw();
    },
    [metrics.strokeWidth],
  );

  const clearGuides = useCallback(() => paintGuides([]), [paintGuides]);

  /* ---------------------------------------------------------------------- */
  /* Transformer attachment                                                  */
  /* ---------------------------------------------------------------------- */

  const primary = selection.length === 1 ? nodeById.get(selection[0]) ?? null : null;
  const multiSelected = selection.length > 1;

  const selectionCapabilities = useMemo<LayerCapabilities | null>(() => {
    if (!selection.length) return null;
    return selection.reduce<LayerCapabilities | null>((accumulated, id) => {
      const node = nodeById.get(id);
      if (!node) return null;
      if (!accumulated) return node.capabilities;
      return {
        selectable: accumulated.selectable && node.capabilities.selectable,
        movable: accumulated.movable && node.capabilities.movable,
        resizable: accumulated.resizable && node.capabilities.resizable,
        rotatable: accumulated.rotatable && node.capabilities.rotatable,
        editableText: false,
        scalesFontOnCorner: false,
        deletable: accumulated.deletable && node.capabilities.deletable,
        duplicable: accumulated.duplicable && node.capabilities.duplicable,
      };
    }, null);
  }, [selection, nodeById]);

  const visibleHandles: HandleId[] = useMemo(() => {
    if (!selectionCapabilities?.resizable || !interactive) return [];
    if (multiSelected) return resolveVisibleHandles({ resizable: true, isText: false, singleLineAutoSize: false });
    return resolveVisibleHandles({
      resizable: true,
      isText: primary?.type === "text",
      singleLineAutoSize: Boolean(primary?.singleLineAutoSize),
    });
  }, [selectionCapabilities, interactive, multiSelected, primary]);

  /**
   * Attach the Transformer to the selected proxies.
   *
   * The dependency list is deliberately keyed on the selection IDENTITY rather
   * than on `nodes`. `nodes` gets a new array identity on every document
   * change, and re-running `transformer.nodes(...)` mid-gesture detaches and
   * reattaches the Transformer — which drops the active anchor and makes the
   * handle jump out from under the pointer. The guard is belt and braces: a
   * live gesture never reattaches, whatever caused the re-render.
   */
  const selectionKey = selection.join("|");
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    if (gestureActiveRef.current) return;
    if (!interactive || !selection.length) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    const targets = selection
      .map((id) => proxyRefs.current.get(id))
      .filter((node): node is Konva.Rect => Boolean(node));
    transformer.nodes(targets);
    transformer.getLayer()?.batchDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, interactive, visibleHandles]);

  useEffect(() => () => schedulerRef.current!.cancel(), []);

  /**
   * Abandon a live gesture and put everything back exactly as it was.
   *
   * Used when a second finger appears mid-drag (spec §13). The customer who
   * rests one finger on the card and then brings a second down means "pinch to
   * zoom" — they do not mean "move this photo 4mm and keep it". Committing that
   * accidental movement is worse than doing nothing, and it is the kind of edit
   * a customer does not notice until the card is printed.
   *
   * `aborted` is what stops Konva's own `dragend` (fired by `stopDrag`) from
   * committing on the way out.
   */
  const abortGesture = useCallback(() => {
    const session = dragRef.current;
    if (!session && !gestureActiveRef.current) return;
    abortedRef.current = true;
    schedulerRef.current!.cancel();

    for (const [id, before] of transformStartRef.current) {
      const proxy = proxyRefs.current.get(id);
      if (!proxy) continue;
      if (proxy.isDragging()) proxy.stopDrag();
      proxy.position({ x: before.x, y: before.y });
      proxy.rotation(Number(before.rotation) || 0);
      proxy.scaleX(1);
      proxy.scaleY(1);
    }
    clearTransientTransforms(previewRootRef?.current);
    clearGuides();
    if (angleLabelRef.current?.visible()) angleLabelRef.current.visible(false);

    dragRef.current = null;
    marqueeSessionRef.current = null;
    if (marqueeRef.current?.visible()) marqueeRef.current.visible(false);
    transformStartRef.current = new Map();
    gestureActiveRef.current = false;
    stageRef.current?.batchDraw();
  }, [clearGuides, previewRootRef]);

  /**
   * Touch bookkeeping, on the stage container in the CAPTURE phase.
   *
   * It has to be a native listener rather than a Konva handler: Konva routes a
   * pointer to one target and a node handler stops propagation, so the second
   * finger might never reach a Stage-level React prop. Capture-phase listeners
   * see every pointer, which is exactly what a "how many fingers are down"
   * question needs.
   */
  useEffect(() => {
    const container = stageRef.current?.container();
    if (!container) return;
    const touches = activeTouchesRef.current;

    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touches.add(event.pointerId);
      // The second finger converts the gesture into a viewport pinch, which the
      // workspace owns. Hand it over cleanly rather than fighting for it.
      if (touches.size >= 2) abortGesture();
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touches.delete(event.pointerId);
    };

    container.addEventListener("pointerdown", onDown, true);
    container.addEventListener("pointerup", onUp, true);
    container.addEventListener("pointercancel", onUp, true);
    return () => {
      container.removeEventListener("pointerdown", onDown, true);
      container.removeEventListener("pointerup", onUp, true);
      container.removeEventListener("pointercancel", onUp, true);
      touches.clear();
    };
  }, [abortGesture]);

  /* ---------------------------------------------------------------------- */
  /* Selection                                                               */
  /* ---------------------------------------------------------------------- */

  const additiveFrom = (event: Konva.KonvaEventObject<PointerEvent | MouseEvent>) => {
    const source = event.evt as PointerEvent & { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };
    return Boolean(source?.shiftKey || source?.ctrlKey || source?.metaKey);
  };

  const handleNodePointerDown = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>, node: InteractionNode) => {
      if (!interactive) return;
      // A right click selects without arming a drag, so the context menu always
      // acts on the object under the cursor (spec §32).
      const button = (event.evt as PointerEvent)?.button;
      if (button === 2) {
        if (!selection.includes(node.id)) onSelectionChange([node.id]);
        return;
      }
      if (button !== 0 && button !== undefined) return;
      // One ordered rule decides the owner, shared with the admin canvas.
      if (resolvePointerOwner({ tool, onObject: true }) !== "object") return;
      event.cancelBubble = true;

      // Clicking a group member selects the group unless it has been entered.
      const targetId = resolveSelectionTarget(node.id, nodes, editingGroupId);
      const target = nodeById.get(targetId ?? node.id) ?? node;

      const decision = resolvePointerDownSelection({
        current: selection,
        id: target.id,
        additive: additiveFrom(event),
      });
      onSelectionChange(decision.selection);
      if (!decision.allowDrag) return;

      const members = decision.selection
        .map((id) => nodeById.get(id))
        .filter((item): item is InteractionNode => Boolean(item));
      // All-or-nothing: one immovable member makes the whole drag illegal.
      const movable = members.length === decision.selection.length && members.every((item) => item.capabilities.movable);
      dragRef.current = {
        leadId: target.id,
        members: movable
          ? members.map((item) => ({
              id: item.id,
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
              rotation: Number(item.rotation) || 0,
            }))
          : [],
        startX: target.x,
        startY: target.y,
        lastX: target.x,
        lastY: target.y,
        moved: false,
        collapseOnRelease: decision.collapseOnRelease,
      };
    },
    [interactive, tool, selection, nodes, nodeById, editingGroupId, onSelectionChange],
  );

  /* ---------------------------------------------------------------------- */
  /* Dragging — transient, zero document writes until release                */
  /* ---------------------------------------------------------------------- */

  const handleDragStart = useCallback(() => {
    if (!interactive) return;
    const session = dragRef.current;
    if (!session || !session.members.length) return;
    session.moved = true;
    gestureActiveRef.current = true;
    transformStartRef.current = new Map(
      session.members.map((member) => [member.id, nodeById.get(member.id)!]).filter(([, node]) => Boolean(node)) as any,
    );
    onGestureStart?.();
  }, [interactive, nodeById, onGestureStart]);

  const handleDragMove = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      const session = dragRef.current;
      if (!session || !session.members.length) return;
      const node = event.target as Konva.Rect;
      const lead = session.members.find((member) => member.id === session.leadId);
      if (!lead) return;

      // Snap the LEAD object; every follower takes the same effective delta so
      // the arrangement stays rigid (spec §16, §18).
      const targets = snapTargetsFor(session.members.map((member) => member.id));
      const { halfWidth, halfHeight } = layerHalfExtents({
        x: node.x(),
        y: node.y(),
        width: lead.width,
        height: lead.height,
        rotation: lead.rotation,
      });
      const snapped = targets
        ? snapMove({
            x: node.x(),
            y: node.y(),
            halfWidth,
            halfHeight,
            targets,
            tolerance: metrics.snapTolerance,
            enabled: true,
          })
        : { x: Math.round(node.x()), y: Math.round(node.y()), guides: [] as SmartGuide[] };

      node.position({ x: snapped.x, y: snapped.y });
      session.lastX = snapped.x;
      session.lastY = snapped.y;

      const moves = applySelectionDelta(session.members, session.leadId, snapped.x, snapped.y, lead.x, lead.y);

      schedulerRef.current!.schedule(() => {
        paintGuides(snapped.guides);
        const root = previewRootRef?.current;
        for (const move of moves) {
          const member = session.members.find((item) => item.id === move.id);
          if (!member) continue;
          // Followers have no Konva drag of their own, so move their proxies too
          // or the selection frame would tear away from the artwork.
          if (move.id !== session.leadId) proxyRefs.current.get(move.id)?.position({ x: move.x, y: move.y });
          applyTransientTransform(root, move.id, { dx: move.x - member.x, dy: move.y - member.y });
        }
        stageRef.current?.batchDraw();
      });
    },
    [snapTargetsFor, metrics.snapTolerance, paintGuides, previewRootRef],
  );

  const handleDragEnd = useCallback(() => {
    // The gesture was abandoned (a second finger arrived): Konva still fires
    // dragend on the way out, and it must not write anything.
    if (abortedRef.current) {
      abortedRef.current = false;
      return;
    }
    const session = dragRef.current;
    schedulerRef.current!.flush();
    clearGuides();
    if (!session || !session.members.length) return;

    const lead = session.members.find((member) => member.id === session.leadId);
    if (!lead) return;
    const moves = applySelectionDelta(session.members, session.leadId, session.lastX, session.lastY, lead.x, lead.y);

    // The transient preview is dropped in the SAME turn the real geometry is
    // committed, so the artwork never flashes back to its old position.
    clearTransientTransforms(previewRootRef?.current, session.members.map((member) => member.id));

    const changes = moves
      .map((move) => {
        const member = session.members.find((item) => item.id === move.id)!;
        const patch: Record<string, number> = {};
        if (Math.round(member.x) !== move.x) patch.x = move.x;
        if (Math.round(member.y) !== move.y) patch.y = move.y;
        return { id: move.id, patch };
      })
      .filter((change) => !isEmptyPatch(change.patch));

    dragRef.current = null;
    gestureActiveRef.current = false;
    // A gesture that ended where it started is a click, not a drag: committing
    // it would push an empty step onto the undo stack (spec §45).
    if (changes.length) onGestureCommit(changes);
  }, [clearGuides, previewRootRef, onGestureCommit]);

  /**
   * Pointer up without a drag. This is the click half of the "press an object
   * inside a multi-selection" rule: the whole selection was held so the drag
   * could move it, and collapses to one object only if nothing moved.
   */
  const handleNodePointerUp = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>, node: InteractionNode) => {
      const session = dragRef.current;
      if (!session) return;
      const moved = session.moved;
      dragRef.current = null;
      if (moved || !session.collapseOnRelease) return;
      const next = resolvePointerUpSelection({
        current: selection,
        id: session.leadId,
        moved: false,
        collapseOnRelease: true,
      });
      if (next) onSelectionChange(next);
    },
    [selection, onSelectionChange],
  );

  /* ---------------------------------------------------------------------- */
  /* Transform (resize / rotate) via the Konva Transformer                   */
  /* ---------------------------------------------------------------------- */

  const handleTransformStart = useCallback(() => {
    gestureActiveRef.current = true;
    transformStartRef.current = new Map(
      selection.map((id) => [id, nodeById.get(id)!]).filter(([, node]) => Boolean(node)) as any,
    );
    onGestureStart?.();
  }, [selection, nodeById, onGestureStart]);

  /**
   * A small angle readout while rotating (spec §10). Drawn imperatively on the
   * overlay layer for the same reason the guides are: it changes every frame,
   * and pushing that through React would re-render the stage 60 times a second.
   */
  const paintAngleReadout = useCallback(() => {
    const label = angleLabelRef.current;
    if (!label) return;
    const activeAnchor = transformerRef.current?.getActiveAnchor?.() ?? "";
    const primaryId = selection[selection.length - 1];
    const proxy = primaryId ? proxyRefs.current.get(primaryId) : null;
    if (activeAnchor !== "rotater" || !proxy) {
      if (label.visible()) {
        label.visible(false);
        label.getLayer()?.batchDraw();
      }
      return;
    }
    const text = angleTextRef.current;
    if (!text) return;
    const angle = ((Math.round(proxy.rotation()) % 360) + 360) % 360;
    text.fontSize(11 / Math.max(Math.abs(scale), 1e-6));
    text.text(`${angle}°`);
    label.position({ x: proxy.x(), y: proxy.y() - metrics.rotateOffset * 2.4 });
    label.offsetX(label.width() / 2);
    label.visible(true);
    label.getLayer()?.batchDraw();
  }, [selection, scale, metrics.rotateOffset]);

  /**
   * Convert every transforming node from Konva's scale representation into
   * Husnalogy geometry (spec §8). Text corner drags become a real `fontSize`
   * change so glyphs are never stretched (spec §23).
   */
  const collectTransformChanges = useCallback((): GestureCommit[] => {
    const changes: GestureCommit[] = [];
    const activeAnchor = transformerRef.current?.getActiveAnchor?.() ?? "";
    const isCornerDrag = activeAnchor.includes("-") && !activeAnchor.includes("center") && !activeAnchor.includes("middle");

    for (const id of selection) {
      const before = transformStartRef.current.get(id);
      const proxy = proxyRefs.current.get(id);
      if (!before || !proxy) continue;

      const raw = {
        x: proxy.x(),
        y: proxy.y(),
        width: before.width,
        height: before.height,
        rotation: proxy.rotation(),
        scaleX: proxy.scaleX(),
        scaleY: proxy.scaleY(),
      };

      if (before.type === "text" && before.capabilities.scalesFontOnCorner && isCornerDrag) {
        const scaled = normalizeTextScale({
          node: raw,
          fontSize: Number(before.fontSize) || 48,
          letterSpacing: Number(before.letterSpacing) || 0,
          minFontSize: Number(before.minFontSize) || 4,
          maxFontSize: Number(before.maxFontSize) || 500,
        });
        changes.push({
          id,
          patch: {
            x: scaled.x,
            y: scaled.y,
            width: scaled.width,
            height: scaled.height,
            rotation: scaled.rotation,
            textStyle: { fontSize: scaled.fontSize, letterSpacing: scaled.letterSpacing },
          },
        });
        continue;
      }

      const normalized = normalizeKonvaGeometry(raw);
      const patch = geometryPatch(before, normalized);
      if (!isEmptyPatch(patch)) changes.push({ id, patch: patch as Record<string, unknown> });
    }
    return changes;
  }, [selection]);

  /**
   * A live transform is TRANSIENT: Konva owns the visual, the document is not
   * touched until the gesture ends (spec §4).
   *
   * This used to commit to the document on every frame, which was the single
   * worst interaction bug in the editor. Committing mid-gesture changed
   * `nodes`, which re-rendered each proxy with its NEW width while Konva still
   * held the in-flight `scaleX` — so the scale was re-applied on top of a size
   * that had already absorbed it, and the object grew away from the pointer.
   * The same re-render reattached the Transformer, dropping the active anchor.
   * The result was a resize that accelerated, jittered and lost the handle.
   *
   * Now the artwork follows by writing ONE transform attribute per frame onto
   * the SVG group the renderer already emits, and the real geometry — with the
   * real text wrapping — lands exactly once, on release. That is also what
   * makes the gesture cheap: no React render at all while the pointer moves.
   */
  const paintTransformPreview = useCallback(() => {
    const root = previewRootRef?.current;
    if (!root) return;
    for (const id of selection) {
      const before = transformStartRef.current.get(id);
      const proxy = proxyRefs.current.get(id);
      if (!before || !proxy) continue;
      applyTransientTransform(root, id, {
        dx: proxy.x() - before.x,
        dy: proxy.y() - before.y,
        rotation: proxy.rotation(),
        baseRotation: Number(before.rotation) || 0,
        pivotX: before.x,
        pivotY: before.y,
        scaleX: Math.abs(proxy.scaleX()) || 1,
        scaleY: Math.abs(proxy.scaleY()) || 1,
      });
    }
  }, [selection, previewRootRef]);

  const handleTransform = useCallback(() => {
    schedulerRef.current!.schedule(() => {
      paintTransformPreview();
      paintAngleReadout();
    });
  }, [paintTransformPreview, paintAngleReadout]);

  const handleTransformEnd = useCallback(() => {
    if (abortedRef.current) {
      abortedRef.current = false;
      return;
    }
    schedulerRef.current!.cancel();
    const changes = collectTransformChanges();
    // Reset the transient Konva scale in the same turn as the commit, so no
    // node ever carries scale into the next gesture (spec §8).
    for (const id of selection) {
      const proxy = proxyRefs.current.get(id);
      if (!proxy) continue;
      proxy.scaleX(1);
      proxy.scaleY(1);
    }
    // Drop the preview in the same turn as the commit: the renderer is about to
    // draw the real geometry, and leaving the transform on would double it.
    clearTransientTransforms(previewRootRef?.current, selection);
    if (angleLabelRef.current?.visible()) {
      angleLabelRef.current.visible(false);
      angleLabelRef.current.getLayer()?.batchDraw();
    }
    transformStartRef.current = new Map();
    gestureActiveRef.current = false;
    if (changes.length) onGestureCommit(changes);
  }, [collectTransformChanges, selection, previewRootRef, onGestureCommit]);

  /* ---------------------------------------------------------------------- */
  /* Marquee                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Double click: enter the object (spec §16, §20, §31).
   *
   * A photo grid has TWO editing levels, and the old model got the hierarchy
   * backwards: every slot carried its own invisible hit target on top of the
   * grid, so a single click always landed on a slot. Trying to move a grid
   * selected a photo instead — the exact complaint in §16 — and the container
   * was effectively undraggable.
   *
   * Now the grid is one interaction target. A single click selects and moves
   * the container, like every other object; a DELIBERATE double click reaches
   * the slot under the pointer. "Edit Photos" in the toolbar remains the
   * discoverable route to the same place. This also removes N invisible Konva
   * nodes per grid from the hit graph (spec §38).
   */
  const handleDoubleClick = useCallback(
    (node: InteractionNode) => {
      if (node.type === "grid" && node.slots?.length && onGridSlotSelect) {
        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition();
        if (pointer) {
          const safeScale = Math.max(Math.abs(scale), 1e-6);
          const point = { x: pointer.x / safeScale, y: pointer.y / safeScale };
          // Slots are laid out in the grid's own frame, so un-rotate the
          // pointer before asking which one it landed in.
          const local = node.rotation
            ? rotatePoint(point.x, point.y, node.x, node.y, -(Number(node.rotation) || 0))
            : point;
          const slot = node.slots.find(
            (candidate) =>
              Math.abs(local.x - candidate.x) <= candidate.width / 2 &&
              Math.abs(local.y - candidate.y) <= candidate.height / 2,
          );
          if (slot) {
            onSelectionChange([node.id]);
            onGridSlotSelect(node.id, slot.id);
            return;
          }
        }
      }
      onDoubleClickNode?.(node.id);
    },
    [scale, onGridSlotSelect, onSelectionChange, onDoubleClickNode],
  );

  const stagePoint = useCallback(() => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    const safeScale = Math.max(Math.abs(scale), 1e-6);
    return { x: pointer.x / safeScale, y: pointer.y / safeScale };
  }, [scale]);

  const handleStagePointerDown = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      if (!interactive) return;
      // A marquee may only begin from genuinely empty design space (spec §37).
      if (event.target !== event.target.getStage()) return;
      if ((event.evt as PointerEvent)?.button !== 0) return;
      if (resolvePointerOwner({ tool }) !== "marquee") return;
      const point = stagePoint();
      if (!point) return;
      marqueeSessionRef.current = {
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
        additive: additiveFrom(event),
        original: selection.slice(),
        moved: false,
      };
    },
    [interactive, tool, stagePoint, selection],
  );

  const handleStagePointerMove = useCallback(() => {
    const session = marqueeSessionRef.current;
    if (!session) return;
    const point = stagePoint();
    if (!point) return;
    session.x = point.x;
    session.y = point.y;
    if (!session.moved && Math.hypot(point.x - session.startX, point.y - session.startY) * scale < 4) return;
    session.moved = true;
    schedulerRef.current!.schedule(() => {
      const rect = marqueeRef.current;
      if (!rect) return;
      rect.visible(true);
      rect.strokeWidth(metrics.strokeWidth);
      rect.position({ x: Math.min(session.startX, session.x), y: Math.min(session.startY, session.y) });
      rect.size({
        width: Math.abs(session.x - session.startX),
        height: Math.abs(session.y - session.startY),
      });
      rect.getLayer()?.batchDraw();
    });
  }, [stagePoint, scale, metrics.strokeWidth]);

  const handleStagePointerUp = useCallback(() => {
    const session = marqueeSessionRef.current;
    marqueeSessionRef.current = null;
    schedulerRef.current!.flush();
    const rect = marqueeRef.current;
    if (rect) {
      rect.visible(false);
      rect.getLayer()?.batchDraw();
    }
    if (!session) return;
    const found = session.moved
      ? hitTestMarquee(
          { left: session.startX, top: session.startY, right: session.x, bottom: session.y },
          nodes,
          { editingGroupId, scale },
        )
      : [];
    onSelectionChange(
      resolveMarqueeSelection({
        original: session.original,
        found,
        additive: session.additive,
        moved: session.moved,
      }),
    );
  }, [nodes, editingGroupId, scale, onSelectionChange]);

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  const displayWidth = documentWidth * scale;
  const displayHeight = documentHeight * scale;

  return (
    <Stage
      ref={stageRef}
      width={Math.max(1, displayWidth)}
      height={Math.max(1, displayHeight)}
      scaleX={scale}
      scaleY={scale}
      listening={interactive}
      onPointerDown={handleStagePointerDown}
      onPointerMove={handleStagePointerMove}
      onPointerUp={handleStagePointerUp}
      style={{
        position: "absolute",
        inset: 0,
        // Pointer events are owned entirely by the Konva stage while it is
        // interactive; when it is not, clicks fall through to the DOM beneath.
        pointerEvents: interactive ? "auto" : "none",
        touchAction: "none",
      }}
    >
      {/* Interaction proxies. Invisible, but present in the hit graph — this is
          the layer Konva hit-tests and the Transformer attaches to. */}
      <Layer listening={interactive}>
        {nodes.map((node) => {
          if (node.hidden || !node.capabilities.selectable) return null;
          const extents = resolveHitExtents(node.width, node.height, scale);
          // Draggable as soon as the object is movable — NOT only once it is
          // selected. Gating on selection meant the prop only flipped to true
          // on the render AFTER pointer-down, by which time Konva had already
          // decided there was no drag to start: the customer had to click once
          // to select and press again to move. Press-and-drag in one motion is
          // the single most basic thing a canvas has to get right (spec §6).
          const draggable = interactive && node.capabilities.movable && textEditingId !== node.id;
          return (
            <Rect
              key={node.id}
              ref={(instance) => {
                if (instance) proxyRefs.current.set(node.id, instance);
                else proxyRefs.current.delete(node.id);
              }}
              name={node.id}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              offsetX={node.width / 2}
              offsetY={node.height / 2}
              rotation={Number(node.rotation) || 0}
              // Konva hit-tests against the fill; opacity 0 keeps it invisible
              // while leaving it fully targetable.
              fill={CHARCOAL}
              opacity={0}
              // Hairline objects get a usable target without changing artwork.
              hitStrokeWidth={Math.max(0, extents.height - Math.abs(node.height))}
              draggable={draggable}
              // A movable object whose SELECTION is not movable as a set (one
              // locked member) stays pinned: Konva would otherwise drag the
              // node visually while the commit path correctly refuses to write
              // it, and the artwork would snap back on release.
              dragBoundFunc={function dragBound(this: Konva.Node, position) {
                const session = dragRef.current;
                if (session && !session.members.length) {
                  return { x: this.absolutePosition().x, y: this.absolutePosition().y };
                }
                return position;
              }}
              onMouseEnter={() => {
                setHoveredId(node.id);
                setStageCursor(node.capabilities.movable ? "move" : "pointer");
              }}
              onMouseLeave={() => {
                setHoveredId((current) => (current === node.id ? null : current));
                setStageCursor("default");
              }}
              onPointerDown={(event) => handleNodePointerDown(event, node)}
              onPointerUp={(event) => handleNodePointerUp(event, node)}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDblClick={() => handleDoubleClick(node)}
              onDblTap={() => handleDoubleClick(node)}
              onContextMenu={(event) => {
                event.evt.preventDefault();
                const source = event.evt as MouseEvent;
                onContextMenuNode?.(node.id, { x: source.clientX, y: source.clientY });
              }}
              />
          );
        })}
      </Layer>

      {/* Selection chrome + guides. Never listens: it must not steal a click
          from the artwork underneath it (spec §50). */}
      <Layer ref={guideLayerRef} listening={false}>
        {/* Multi-selection members get a hairline so the customer can see WHAT
            is in the set. The frame itself is drawn once, by the Transformer —
            a single selection therefore shows exactly one rectangle instead of
            the three that used to overlap here (spec §8). */}
        {selection.length > 1
          ? selection.map((id) => {
              const node = nodeById.get(id);
              if (!node) return null;
              return (
                <Rect
                  key={`member-${id}`}
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  offsetX={node.width / 2}
                  offsetY={node.height / 2}
                  rotation={Number(node.rotation) || 0}
                  stroke={GOLD}
                  opacity={0.45}
                  strokeWidth={metrics.strokeWidth}
                  listening={false}
                />
              );
            })
          : null}

        {/* Hover affordance: a whisper of an outline on the object under the
            cursor, so editable content is discoverable without permanently
            boxing every layer on the page (spec §40). Never on touch, which
            has no hover. */}
        {hoveredId && !selection.includes(hoveredId) && !coarsePointer
          ? (() => {
              const node = nodeById.get(hoveredId);
              if (!node) return null;
              return (
                <Rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  offsetX={node.width / 2}
                  offsetY={node.height / 2}
                  rotation={Number(node.rotation) || 0}
                  stroke={GOLD}
                  opacity={0.4}
                  strokeWidth={metrics.strokeWidth}
                  listening={false}
                />
              );
            })()
          : null}

        {/* A fixed pool of guide lines, shown and positioned imperatively during
            a drag. Allocating nodes per frame would garbage-collect mid-gesture. */}
        {[0, 1, 2, 3].map((index) => (
          <Line
            key={`guide-${index}`}
            ref={(instance) => {
              if (instance) guideNodesRef.current[index] = instance;
            }}
            points={[0, 0, 0, 0]}
            stroke={GOLD}
            strokeWidth={metrics.strokeWidth}
            visible={false}
            listening={false}
          />
        ))}

        <Rect
          ref={marqueeRef}
          x={0}
          y={0}
          width={0}
          height={0}
          fill="rgba(212,175,55,0.10)"
          stroke={GOLD}
          strokeWidth={metrics.strokeWidth}
          visible={false}
          listening={false}
        />

        {/* Angle readout while rotating (spec §10). A Konva Label sizes its own
            charcoal chip around the text, so the number stays readable over any
            artwork without a shadow or a glow. Positioned and shown
            imperatively — it changes on every frame of the gesture. */}
        <Label ref={angleLabelRef} visible={false} listening={false}>
          <Tag fill={CHARCOAL} cornerRadius={3 / Math.max(Math.abs(scale), 1e-6)} />
          <Text
            ref={angleTextRef}
            text=""
            fontFamily="system-ui, sans-serif"
            fontStyle="bold"
            fill={WHITE}
            padding={4 / Math.max(Math.abs(scale), 1e-6)}
          />
        </Label>
      </Layer>

      {/* Transform handles. Their own layer so a resize redraw never touches the
          proxy hit graph. */}
      <Layer>
        <Transformer
          ref={transformerRef}
          enabledAnchors={konvaAnchors(visibleHandles)}
          rotateEnabled={Boolean(selectionCapabilities?.rotatable) && interactive}
          resizeEnabled={Boolean(selectionCapabilities?.resizable) && interactive}
          rotationSnaps={[0, ROTATION_SNAP_STEP, 2 * ROTATION_SNAP_STEP, 3 * ROTATION_SNAP_STEP,
            4 * ROTATION_SNAP_STEP, 5 * ROTATION_SNAP_STEP, 6 * ROTATION_SNAP_STEP,
            7 * ROTATION_SNAP_STEP, 8 * ROTATION_SNAP_STEP, 9 * ROTATION_SNAP_STEP,
            10 * ROTATION_SNAP_STEP, 11 * ROTATION_SNAP_STEP, 12 * ROTATION_SNAP_STEP,
            13 * ROTATION_SNAP_STEP, 14 * ROTATION_SNAP_STEP, 15 * ROTATION_SNAP_STEP,
            16 * ROTATION_SNAP_STEP, 17 * ROTATION_SNAP_STEP, 18 * ROTATION_SNAP_STEP,
            19 * ROTATION_SNAP_STEP, 20 * ROTATION_SNAP_STEP, 21 * ROTATION_SNAP_STEP,
            22 * ROTATION_SNAP_STEP, 23 * ROTATION_SNAP_STEP]}
          rotationSnapTolerance={4}
          // Husnalogy chrome: a thin gold frame with white square handles. No
          // shadows, no glow — the design has to stay readable underneath.
          anchorSize={metrics.size}
          anchorStroke={GOLD}
          anchorFill={WHITE}
          anchorStrokeWidth={metrics.strokeWidth}
          anchorCornerRadius={metrics.cornerRadius}
          borderStroke={GOLD}
          borderStrokeWidth={metrics.strokeWidth}
          rotateAnchorOffset={metrics.rotateOffset}
          ignoreStroke
          shouldOverdrawWholeArea={false}
          flipEnabled={false}
          keepRatio={false}
          boundBoxFunc={(oldBox, newBox) => {
            // Never let a transform collapse an object to nothing.
            const minimum = 24 * scale;
            if (Math.abs(newBox.width) < minimum || Math.abs(newBox.height) < minimum) return oldBox;
            return newBox;
          }}
          onTransformStart={handleTransformStart}
          onTransform={handleTransform}
          onTransformEnd={handleTransformEnd}
        />
      </Layer>
    </Stage>
  );
}
