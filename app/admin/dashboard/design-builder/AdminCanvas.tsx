"use client";

// Interactive admin editing canvas. The base render is the SHARED renderer
// (CustomizerPreview) so what admin arranges is exactly what customers get.
// The overlay adds selection, drag, resize, rotation, snapping with alignment
// guides, and a live position/size readout.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import InlineCanvasTextEditor from "@/app/components/customizer/InlineCanvasTextEditor";
import {
  createCanvasMeasure,
  getTextResizeConstraints,
  isSingleLineAutoSizeText,
  layoutText,
  scaleSingleLineText,
  type MeasureFn,
  type SafeBounds,
} from "@/lib/customizer/v2/text-layout";
import { getFieldById, resolveLayerText } from "@/app/components/customizer/customizer-utils";
import {
  createPanGesture,
  isTypingTarget,
  MIDDLE_MOUSE_BUTTON,
  panCursor,
  panFromGesture,
  panHasPointerPriority,
  PAN_TOOL,
  shouldBeginPan,
  type PanBounds,
  type PanGesture,
} from "@/lib/customizer/v2/viewport-pan";
import {
  clientPointToDocument,
  marqueeSelectedLayerIds,
  pointInsideTransformedLayer,
  pointerExceededDragThreshold,
  resolveLayerSelectionGeometry,
  selectionBounds,
} from "@/lib/customizer/v2/selection-geometry";
import {
  resolveMarqueeSelection,
  resolvePointerDownSelection,
  resolvePointerUpSelection,
} from "@/lib/customizer/v2/selection";
import { isEmptyText } from "@/lib/customizer/v2/text-editing";
import { actualSizeZoom, computeWorkspaceFit, resolveWorkspacePadding } from "@/lib/customizer/v2/zoom";
import { layersForPage, selectableLayersForPage } from "./builder-utils";

const HANDLES: Array<{ id: string; cx: number; cy: number; cursor: string }> = [
  { id: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { id: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { id: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { id: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
  { id: "n", cx: 0.5, cy: 0, cursor: "ns-resize" },
  { id: "s", cx: 0.5, cy: 1, cursor: "ns-resize" },
  { id: "w", cx: 0, cy: 0.5, cursor: "ew-resize" },
  { id: "e", cx: 1, cy: 0.5, cursor: "ew-resize" },
];
const SINGLE_LINE_TEXT_HANDLES = HANDLES.filter((handle) => handle.id === "w" || handle.id === "e");

const SNAP_PX = 8; // screen pixels

type Guide = { type: "v" | "h"; at: number };

export default function AdminCanvas({
  template,
  pageId,
  values = {},
  selectedLayerId,
  selectedLayerIds = [],
  onSelectionChange,
  onLayerChange,
  onLayersChange,
  onBeginChange,
  editTextRequest,
  onTextEditStart,
  onTextDraftChange,
  onTextMultilineActivate,
  onTextCancel,
  onTextDiscard,
  onEditingTextChange,
  onExitTextTool,
  onTextCommit,
  zoom = 1,
  panX = 0,
  panY = 0,
  onPanChange,
  showSafeArea,
  showBleed,
  snapEnabled = true,
  activeTool = "select",
  guides: savedGuides = [],
  onGuideChange,
  editingGroupId = null,
  onEnterGroup,
  onExitGroup,
  onFitZoomChange,
}: any) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const dragRef = useRef<any>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const newTextIdsRef = useRef(new Set<string>());
  const textEditSessionRef = useRef<{
    layerId: string;
    text: string;
    textStyle: Record<string, any>;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const panRef = useRef<PanGesture | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [selectionBox, setSelectionBox] = useState<null | {
    startX: number;
    startY: number;
    x: number;
    y: number;
    additive: boolean;
  }>(null);
  const textMeasureRef = useRef<MeasureFn | null>(null);
  if (!textMeasureRef.current) textMeasureRef.current = createCanvasMeasure();

  const canvasW = template?.canvasWidthPx || 1500;
  const canvasH = template?.canvasHeightPx || 2100;

  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => {
      setContainerWidth(el.clientWidth);
      setContainerHeight(el.clientHeight);
    };
    update();
    // Same belt-and-braces measurement as CustomizerWorkspace: the first mount
    // measurement can precede the panels taking their space.
    const frame = requestAnimationFrame(update);
    const settle = window.setTimeout(update, 250);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // Zoom 1 == the complete page fitted inside the measured workspace, on BOTH
  // axes. The old base width was derived from the container width alone and
  // capped at 900px, so a 5x7 portrait card at "100%" was taller than any
  // normal workspace and only became fully visible around 70%.
  //
  // The workspace box is measured live, so collapsing the tool rail, the layers
  // panel or the inspector re-fits the page with no breakpoint involved.
  const workspaceFit = computeWorkspaceFit({
    availableWidth: containerWidth,
    availableHeight: containerHeight,
    canvasWidth: canvasW,
    canvasHeight: canvasH,
  });
  const fitPadding = workspaceFit?.padding ?? resolveWorkspacePadding(containerWidth, containerHeight);
  // Before the first measurement, fall back to a width-derived guess purely so
  // the very first frame is not zero-sized; it is replaced on the next tick.
  const baseWidth = workspaceFit?.baseWidth ?? Math.max(260, (containerWidth || 520) - 96);
  const displayW = baseWidth * zoom;
  const displayH = displayW * (canvasH / canvasW);
  const scale = displayW / canvasW;
  const snapTolerance = SNAP_PX / scale;

  // Publish the physical-scale zoom so the 1:1 control stays a distinct action
  // from Fit. Fit itself is simply zoom 1 now, so it needs no separate value.
  const documentDpi = Number(template?.dpi) || 300;
  const actualZoom = workspaceFit ? actualSizeZoom(workspaceFit.fitScale, documentDpi) : null;
  useEffect(() => {
    if (actualZoom === null) return;
    onFitZoomChange?.(actualZoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualZoom]);

  // Pan tool proper, or Space held down as a temporary override.
  const panToolActive = activeTool === PAN_TOOL || spacePanActive;
  const panBounds: PanBounds = {
    workspaceWidth: containerWidth,
    workspaceHeight: containerHeight,
    displayWidth: displayW,
    displayHeight: displayH,
  };

  const layers = layersForPage(template, pageId);
  const selectableLayers = selectableLayersForPage(template, pageId, editingGroupId);

  // Auto-width text may grow only up to the safe area.
  const safeBounds: SafeBounds = {
    left: Number(template?.safeArea?.left) || 0,
    top: Number(template?.safeArea?.top) || 0,
    right: canvasW - (Number(template?.safeArea?.right) || 0),
    bottom: canvasH - (Number(template?.safeArea?.bottom) || 0),
  };

  // The SAME resolver the renderers use, so the selection box, handles and the
  // rendered glyphs share one geometry — there is no second sizing calculation.
  const resolveLayerBox = (layer: any) => {
    const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
    const text = resolveLayerText(layer, field, values);
    return resolveLayerSelectionGeometry(layer, {
      text: String(text),
      measure: textMeasureRef.current!,
      safeBounds,
    });
  };
  const singleLineInteractionLayer = resolveLayerBox;

  const constrainTextSize = (layer: any, requestedWidth: number, requestedHeight: number) => {
    if (layer?.type !== "text") return { width: requestedWidth, height: requestedHeight };
    const style = layer.textStyle || {};
    const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
    const text = resolveLayerText(layer, field, values);
    const input = {
      text: String(text),
      width: Math.max(1, requestedWidth),
      height: Math.max(1, requestedHeight),
      fontFamily: style.fontFamily || "Cormorant Garamond",
      fontSize: Number(style.fontSize) || 48,
      minFontSize: Number(style.minFontSize) || undefined,
      fontWeight: style.fontWeight || "400",
      fontStyle: style.fontStyle === "italic" ? "italic" as const : "normal" as const,
      letterSpacing: Number(style.letterSpacing) || 0,
      lineHeight: Number(style.lineHeight) || 1.15,
      multiline: Boolean(style.multiline),
      fitMode: style.fitMode === "shrink" ? "shrink" as const : style.fitMode === "auto-height" ? "auto-height" as const : "fixed" as const,
    };
    let constraints = getTextResizeConstraints(input, textMeasureRef.current!);
    const width = Math.max(constraints.minWidth, requestedWidth);
    constraints = getTextResizeConstraints({ ...input, width }, textMeasureRef.current!);
    const height = style.fitMode === "auto-height"
      ? constraints.requiredHeight
      : Math.max(constraints.minHeight, requestedHeight);
    return { width: Math.ceil(width), height: Math.ceil(height) };
  };

  // A stored width that is merely smaller than the text is NOT a problem for an
  // auto-width layer — the box simply grows. The warning is reserved for text
  // that has already used up the safe area and still cannot fit.
  const textOverflowForLayer = (layer: any) => {
    if (layer?.type !== "text") return false;
    const style = layer.textStyle || {};
    const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
    const text = resolveLayerText(layer, field, values);
    const resolved = resolveLayerBox(layer);
    // Auto width absorbs the overflow until it hits the safe-area limit.
    if (resolved.autoWidthClamped === false) return false;
    const layout = layoutText({
      text: String(text),
      width: resolved.width,
      height: resolved.height,
      fontFamily: style.fontFamily || "Cormorant Garamond",
      fontSize: Number(style.fontSize) || 48,
      minFontSize: Number(style.minFontSize) || undefined,
      fontWeight: style.fontWeight || "400",
      fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
      letterSpacing: Number(style.letterSpacing) || 0,
      lineHeight: Number(style.lineHeight) || 1.15,
      multiline: Boolean(style.multiline),
      fitMode: resolved.autoWidthClamped && !style.multiline
        ? "shrink"
        : style.fitMode === "shrink" ? "shrink" : style.fitMode === "auto-height" ? "auto-height" : "fixed",
    }, textMeasureRef.current!);
    return layout.overflowWidth || layout.overflowHeight || layout.truncatedLines;
  };

  // Snap targets: page centre, page edges, safe-area edges, other layer centres.
  const buildSnapTargets = (excludeIds: string | string[]) => {
    const excluded = new Set(Array.isArray(excludeIds) ? excludeIds : [excludeIds]);
    const safe = template?.safeArea || {};
    const xs = [canvasW / 2, 0, canvasW, Number(safe.left || 0), canvasW - Number(safe.right || 0)];
    const ys = [canvasH / 2, 0, canvasH, Number(safe.top || 0), canvasH - Number(safe.bottom || 0)];
    layers.forEach((l: any) => {
      if (excluded.has(l.id) || l.hidden) return;
      xs.push(l.x);
      ys.push(l.y);
    });
    return { xs, ys };
  };

  const applySnap = (x: number, y: number, excludeIds: string | string[]) => {
    if (!snapEnabled) return { x, y, guides: [] as Guide[] };
    const { xs, ys } = buildSnapTargets(excludeIds);
    let outX = x;
    let outY = y;
    const activeGuides: Guide[] = [];
    let bestDx = snapTolerance;
    xs.forEach((target) => {
      const d = Math.abs(x - target);
      if (d < bestDx) {
        bestDx = d;
        outX = target;
      }
    });
    if (outX !== x) activeGuides.push({ type: "v", at: outX });
    let bestDy = snapTolerance;
    ys.forEach((target) => {
      const d = Math.abs(y - target);
      if (d < bestDy) {
        bestDy = d;
        outY = target;
      }
    });
    if (outY !== y) activeGuides.push({ type: "h", at: outY });
    return { x: Math.round(outX), y: Math.round(outY), guides: activeGuides };
  };

  const selectionIds: string[] = selectedLayerIds.length
    ? selectedLayerIds
    : selectedLayerId
      ? [selectedLayerId]
      : [];
  const resolvedSelectableLayers = selectableLayers.map((layer: any) => resolveLayerBox(layer));
  const multiBounds = selectionIds.length > 1
    ? selectionBounds(resolvedSelectableLayers, selectionIds)
    : null;
  const multiCanMove =
    selectionIds.length > 1 &&
    selectionIds.every((id) => {
      const target = selectableLayers.find((layer: any) => layer.id === id);
      return Boolean(target && !target.locked && target.adminEditable !== false);
    });

  const beginTextEditing = (layerId: string, created = false) => {
    if (editingTextId === layerId) return;
    const layer = selectableLayers.find((candidate: any) => candidate.id === layerId);
    if (!layer) return;
    const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
    textEditSessionRef.current = {
      layerId,
      text: String(resolveLayerText(layer, field, values)),
      textStyle: { ...(layer.textStyle || {}) },
      x: Number(layer.x) || 0,
      y: Number(layer.y) || 0,
      width: Number(layer.width) || 0,
      height: Number(layer.height) || 0,
    };
    if (created) newTextIdsRef.current.add(layerId);
    else onTextEditStart?.(layerId);
    setEditingTextId(layerId);
    onEditingTextChange?.(layerId);
  };

  const finishTextEditing = (layerId: string, text: string) => {
    const created = newTextIdsRef.current.delete(layerId);
    textEditSessionRef.current = null;
    setEditingTextId(null);
    onEditingTextChange?.(null);
    if (created && isEmptyText(text)) {
      onTextDiscard?.(layerId);
      return;
    }
    onTextCommit?.(layerId, text);
  };

  const cancelTextEditing = (layerId: string) => {
    const created = newTextIdsRef.current.delete(layerId);
    const session = textEditSessionRef.current;
    textEditSessionRef.current = null;
    setEditingTextId(null);
    onEditingTextChange?.(null);
    if (created) {
      onTextDiscard?.(layerId);
      return;
    }
    if (session?.layerId === layerId) onTextCancel?.(layerId, {
      text: session.text,
      textStyle: session.textStyle,
      x: session.x,
      y: session.y,
      width: session.width,
      height: session.height,
    });
  };

  // Text insertion is a one-shot toolbar action (spec §11): the builder creates
  // the layer, then asks the canvas to open its editor. `created` keeps the
  // "leave it empty and it disappears again" contract of a brand new object.
  useEffect(() => {
    if (!editTextRequest?.layerId) return;
    const layer = selectableLayers.find((candidate: any) => candidate.id === editTextRequest.layerId);
    if (!layer || layer.type !== "text" || layer.locked || layer.adminEditable === false) return;
    beginTextEditing(layer.id, Boolean(editTextRequest.created));
    // requestId deliberately re-opens the editor for the same layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTextRequest?.requestId]);

  /**
   * One pointer-down path for every object, whether it was hit directly or
   * through the combined selection frame. Plain clicks accumulate the
   * selection; an object that is already selected keeps the whole selection
   * intact so the drag moves it as one block, and is only removed again if the
   * gesture ends without movement (spec §2, §3, §7).
   */
  const beginObjectInteraction = (e: React.PointerEvent, layer: any) => {
    if (editingTextId && editingTextId !== layer.id) return;
    if (editingGroupId && String(layer.groupId || "") !== editingGroupId) onExitGroup?.(false);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const decision = resolvePointerDownSelection({ current: selectionIds, id: layer.id, additive });
    onSelectionChange?.(decision.selection);
    // Modifier clicks are selection toggles, never accidental drags.
    if (!decision.allowDrag) return;

    const immovable = layer.locked || layer.adminEditable === false;
    // Dragging a layer that is part of a multi-selection moves the whole
    // selection together (spec §7).
    const groupIds = decision.selection.includes(layer.id) && decision.selection.length > 1
      ? decision.selection
      : [layer.id];
    const selectedTargets = groupIds
      .map((id) => layers.find((candidate: any) => candidate.id === id))
      .filter(Boolean);
    // A multi-selection is one logical command: never move an allowed subset.
    const movable =
      !immovable &&
      selectedTargets.length === groupIds.length &&
      !selectedTargets.some((target: any) => target.locked || target.adminEditable === false);

    if (!movable) {
      // Still track the gesture so a click on a locked/undraggable object can
      // toggle itself back out of the selection on release.
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        mode: "select-click",
        layerId: layer.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        toggleOnRelease: decision.toggleOnRelease,
      };
      return;
    }

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const startPositions: Record<string, { x: number; y: number }> = {};
    for (const target of selectedTargets) {
      startPositions[target.id] = { x: target.x, y: target.y };
    }

    dragRef.current = {
      mode: Object.keys(startPositions).length > 1 ? "move-multi" : "move",
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: layer.x,
      startY: layer.y,
      startPositions,
      excludeIds: groupIds,
      toggleOnRelease: decision.toggleOnRelease,
    };
  };

  const onLayerPointerDown = (e: React.PointerEvent, layer: any) => {
    // Let the workspace pan instead — no stopPropagation, no selection change.
    if (panOwnsPointer(e)) return;
    e.stopPropagation();
    beginObjectInteraction(e, layer);
  };

  const onMultiSelectionPointerDown = (e: React.PointerEvent) => {
    if (panOwnsPointer(e) || !multiBounds || e.button !== 0) return;
    e.stopPropagation();
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = clientPointToDocument(e.clientX, e.clientY, rect, displayW, displayH, scale);
    // The frame spans the whole bounding box, including the gaps between
    // objects — resolve what is actually under the pointer first.
    const hit = resolvedSelectableLayers
      .filter((layer: any) => pointInsideTransformedLayer(point.x, point.y, layer))
      .at(-1);
    if (hit) {
      const target = selectableLayers.find((layer: any) => layer.id === hit.id);
      if (target) {
        beginObjectInteraction(e, target);
        return;
      }
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (!multiCanMove) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const startPositions: Record<string, { x: number; y: number }> = {};
    for (const id of selectionIds) {
      const target = selectableLayers.find((layer: any) => layer.id === id);
      if (target) startPositions[id] = { x: target.x, y: target.y };
    }
    dragRef.current = {
      mode: "move-multi",
      layerId: selectionIds[0],
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: multiBounds.x,
      startY: multiBounds.y,
      startPositions,
      excludeIds: selectionIds,
      // Empty space inside the frame is still empty canvas: a click that never
      // moves clears the selection (spec §4).
      clearOnRelease: true,
    };
  };

  const beginSurfaceInteraction = (event: React.PointerEvent) => {
    if (panOwnsPointer(event) || event.button !== 0 || editingTextId) return;
    if (event.target !== surfaceRef.current) return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = clientPointToDocument(event.clientX, event.clientY, rect, displayW, displayH, scale);
    if (activeTool !== "select") return;
    if (editingGroupId) {
      const group = layers.find((layer: any) => layer.id === editingGroupId);
      const resolvedGroup = group ? resolveLayerBox(group) : null;
      if (!resolvedGroup || !pointInsideTransformedLayer(point.x, point.y, resolvedGroup)) onExitGroup?.(false);
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    dragRef.current = {
      mode: "marquee",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      additive,
      originalSelection: selectionIds.slice(),
      began: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onHandlePointerDown = (e: React.PointerEvent, layer: any, handle: string) => {
    if (panOwnsPointer(e)) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const interactionLayer = singleLineInteractionLayer(layer);
    const textScale = interactionLayer.type === "text" && isSingleLineAutoSizeText(
      interactionLayer.textStyle,
      interactionLayer.resolvedText ?? interactionLayer.text,
    );
    dragRef.current = {
      mode: textScale ? "text-scale" : "resize",
      handle,
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: interactionLayer.x,
      startY: interactionLayer.y,
      startW: interactionLayer.width,
      startH: interactionLayer.height,
      layer: interactionLayer,
      shiftLock: false,
    };
  };

  const onRotatePointerDown = (e: React.PointerEvent, layer: any) => {
    if (panOwnsPointer(e)) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "rotate",
      layerId: layer.id,
      startRotation: Number(layer.rotation || 0),
      centerX: layer.x,
      centerY: layer.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === "select-click") {
      if (pointerExceededDragThreshold(drag.startClientX, drag.startClientY, e.clientX, e.clientY)) {
        drag.moved = true;
      }
      return;
    }
    if (drag.mode === "marquee") {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = clientPointToDocument(e.clientX, e.clientY, rect, displayW, displayH, scale);
      drag.x = point.x;
      drag.y = point.y;
      if (
        !drag.began &&
        !pointerExceededDragThreshold(drag.startClientX, drag.startClientY, e.clientX, e.clientY)
      ) return;
      drag.began = true;
      setSelectionBox({
        startX: drag.startX,
        startY: drag.startY,
        x: drag.x,
        y: drag.y,
        additive: drag.additive,
      });
      return;
    }
    if (drag.mode === "guide") {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const position = drag.axis === "vertical" ? (e.clientX - rect.left) / scale : (e.clientY - rect.top) / scale;
      onGuideChange?.(drag.guideId, { position: Math.round(Math.max(0, drag.axis === "vertical" ? Math.min(canvasW, position) : Math.min(canvasH, position))) });
      return;
    }
    if (
      (drag.mode === "move" || drag.mode === "move-multi") &&
      !drag.began &&
      !pointerExceededDragThreshold(drag.startClientX, drag.startClientY, e.clientX, e.clientY)
    ) return;
    if (!drag.began) {
      drag.began = true;
      onBeginChange?.();
    }

    if (drag.mode === "rotate") {
      const rect = (wrapRef.current?.querySelector("[data-canvas-surface]") as HTMLElement)?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + drag.centerX * scale;
      const cy = rect.top + drag.centerY * scale;
      const angle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      let rotation = Math.round(angle);
      // Snap to 15° increments near them; Shift disables snapping.
      if (!e.shiftKey) {
        const nearest = Math.round(rotation / 15) * 15;
        if (Math.abs(rotation - nearest) <= 4) rotation = nearest;
      }
      rotation = ((rotation % 360) + 360) % 360;
      onLayerChange(drag.layerId, { rotation });
      return;
    }

    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;

    if (drag.mode === "text-scale") {
      const style = drag.layer.textStyle || {};
      const rotation = Number(drag.layer.rotation) || 0;
      const radians = (rotation * Math.PI) / 180;
      const localDelta = dx * Math.cos(radians) + dy * Math.sin(radians);
      const safe = template?.safeArea || {};
      const result = scaleSingleLineText({
        text: String(drag.layer.resolvedText ?? drag.layer.text ?? ""),
        x: drag.startX,
        y: drag.startY,
        fontFamily: style.fontFamily || "Cormorant Garamond",
        fontSize: Number(style.fontSize) || 48,
        minFontSize: Number(style.minFontSize) || 4,
        maxFontSize: Number(style.maxFontSize) || 500,
        fontWeight: style.fontWeight || "400",
        fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
        letterSpacing: Number(style.letterSpacing) || 0,
        lineHeight: Number(style.lineHeight) || 1.15,
        uppercase: Boolean(style.uppercase),
        rotation,
        handle: drag.handle,
        delta: localDelta,
        centered: e.altKey,
        safeBounds: drag.layer.customerEditable ? {
          left: Number(safe.left) || 0,
          top: Number(safe.top) || 0,
          right: canvasW - (Number(safe.right) || 0),
          bottom: canvasH - (Number(safe.bottom) || 0),
        } : undefined,
      }, textMeasureRef.current!);
      onLayerChange(drag.layerId, {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
        textStyle: { fontSize: result.fontSize },
      });
      return;
    }

    if (drag.mode === "move-multi") {
      // Snap the grabbed layer; the rest follow with the same delta.
      const snapped = applySnap(drag.startX + dx, drag.startY + dy, drag.excludeIds || drag.layerId);
      setGuides(snapped.guides);
      const effectiveDx = snapped.x - drag.startX;
      const effectiveDy = snapped.y - drag.startY;
      const patches: Record<string, { x: number; y: number }> = {};
      for (const [id, start] of Object.entries(drag.startPositions as Record<string, { x: number; y: number }>)) {
        patches[id] = { x: Math.round(start.x + effectiveDx), y: Math.round(start.y + effectiveDy) };
      }
      onLayersChange?.(patches);
      return;
    }

    if (drag.mode === "move") {
      const snapped = applySnap(drag.startX + dx, drag.startY + dy, drag.layerId);
      setGuides(snapped.guides);
      onLayerChange(drag.layerId, { x: snapped.x, y: snapped.y });
      return;
    }

    // Resize anchoring the opposite corner. Shift keeps the aspect ratio.
    const left = drag.startX - drag.startW / 2;
    const top = drag.startY - drag.startH / 2;
    const right = drag.startX + drag.startW / 2;
    const bottom = drag.startY + drag.startH / 2;
    const min = 20;
    let nl = left, nt = top, nr = right, nb = bottom;
    if (drag.handle.includes("w")) nl = Math.min(left + dx, right - min);
    if (drag.handle.includes("e")) nr = Math.max(right + dx, left + min);
    if (drag.handle.includes("n")) nt = Math.min(top + dy, bottom - min);
    if (drag.handle.includes("s")) nb = Math.max(bottom + dy, top + min);
    let w = Math.round(nr - nl);
    let h = Math.round(nb - nt);
    if (e.shiftKey && drag.startW > 0 && drag.startH > 0) {
      const ratio = drag.startW / drag.startH;
      if (w / h > ratio) w = Math.round(h * ratio);
      else h = Math.round(w / ratio);
      if (drag.handle.includes("w")) nl = nr - w;
      else nr = nl + w;
      if (drag.handle.includes("n")) nt = nb - h;
      else nb = nt + h;
    }
    const constrained = constrainTextSize(drag.layer, w, h);
    if (constrained.width !== w) {
      w = constrained.width;
      if (drag.handle.includes("w")) nl = nr - w;
      else nr = nl + w;
    }
    if (constrained.height !== h) {
      h = constrained.height;
      if (drag.handle.includes("n")) nt = nb - h;
      else nb = nt + h;
    }
    onLayerChange(drag.layerId, { x: Math.round(nl + w / 2), y: Math.round(nt + h / 2), width: w, height: h });
  };

  const endDrag = (cancelled = false) => {
    const drag = dragRef.current;
    // A gesture that moved is a drag, never a click: it must not change the
    // selection on release (spec §39).
    const moved = Boolean(drag?.began || drag?.moved);
    if (drag && !cancelled && !moved) {
      if (drag.clearOnRelease) {
        onSelectionChange?.([]);
      } else if (drag.toggleOnRelease && drag.layerId) {
        const next = resolvePointerUpSelection({
          current: selectionIds,
          id: drag.layerId,
          moved,
          toggleOnRelease: true,
        });
        if (next) onSelectionChange?.(next);
      }
    }
    if (drag?.mode === "marquee" && !cancelled) {
      const found = drag.began
        ? marqueeSelectedLayerIds(
            {
              left: drag.startX,
              top: drag.startY,
              right: drag.x,
              bottom: drag.y,
            },
            resolvedSelectableLayers,
          )
        : [];
      onSelectionChange?.(resolveMarqueeSelection({
        original: drag.originalSelection || [],
        found,
        additive: drag.additive,
        moved: Boolean(drag.began),
      }));
    }
    dragRef.current = null;
    setGuides([]);
    setSelectionBox(null);
  };

  const onGuidePointerDown = (event: React.PointerEvent, guide: any) => {
    // Dragging over a guide while panning pans the viewport, it does not move
    // the guide.
    if (panOwnsPointer(event)) return;
    event.stopPropagation();
    setSelectedGuideId(guide.id);
    if (guide.locked) return;
    onBeginChange?.();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { mode: "guide", guideId: guide.id, axis: guide.axis };
  };

  /* ------------------------------------------------------------------ pan --
   * Viewport translation, NOT scrollLeft/scrollTop. The old scroll approach
   * needed scrollable overflow to exist, so it did nothing whenever the canvas
   * already fitted inside the workspace. Pan is pure editor UI state: it never
   * calls onBeginChange/onLayerChange, so it creates no history and no save.
   */
  const panBoundsRef = useRef(panBounds);
  panBoundsRef.current = panBounds;
  const onPanChangeRef = useRef(onPanChange);
  onPanChangeRef.current = onPanChange;

  // Pointer moves are batched through requestAnimationFrame so a fast drag does
  // not queue one React render per pointer event.
  const pendingPanRef = useRef<{ panX: number; panY: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const flushPan = useCallback(() => {
    rafRef.current = null;
    const next = pendingPanRef.current;
    pendingPanRef.current = null;
    if (next) onPanChangeRef.current?.(next);
  }, []);

  const endPan = useCallback((event?: React.PointerEvent) => {
    if (!panRef.current) return;
    if (event && panRef.current.pointerId >= 0) {
      const node = event.currentTarget as HTMLElement | null;
      if (node?.hasPointerCapture?.(panRef.current.pointerId)) {
        node.releasePointerCapture?.(panRef.current.pointerId);
      }
    }
    panRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      flushPan();
    }
    setIsPanning(false);
  }, [flushPan]);

  const beginPan = (event: React.PointerEvent) => {
    if (!shouldBeginPan({ activeTool, spacePanActive, button: event.button, editingText: Boolean(editingTextId) })) return;
    // Middle-click would otherwise start the browser's auto-scroll.
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    panRef.current = createPanGesture(event, { panX, panY });
    setIsPanning(true);
  };

  const movePan = (event: React.PointerEvent) => {
    const gesture = panRef.current;
    if (!gesture) return;
    pendingPanRef.current = panFromGesture(gesture, event.clientX, event.clientY, panBoundsRef.current);
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushPan);
  };

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  // Space temporarily switches to Pan from any tool, without changing activeTool.
  // It must never steal a space character from a field or the inline text editor.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      if (editingTextId || isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;
      event.preventDefault();
      setSpacePanActive(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      setSpacePanActive(false);
    };
    // Releasing Space outside the window would otherwise leave pan stuck on.
    const clear = () => setSpacePanActive(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [editingTextId]);

  // Pan wins over object interaction: layer, handle, rotation and guide
  // gestures stand down (without stopPropagation) so the event reaches the
  // workspace and pans instead.
  const panOwnsPointer = (event: React.PointerEvent) =>
    panHasPointerPriority({ activeTool, spacePanActive, button: event.button });

  const cursor = panCursor({ isPanning, panToolActive });
  // While a temporary pan is armed or running, overlays stay rendered (so the
  // selection does not flicker away) but stop intercepting pointer events.
  const overlayInert = spacePanActive || isPanning;

  return (
    <div
      ref={wrapRef}
      data-canvas-workspace
      // items-center: the page is centred on both axes inside the padded box.
      // The padding is asymmetric — a taller bottom keeps the card clear of the
      // floating zoom controls — so flex centring lands it correctly without a
      // second offset calculation.
      // overflow-hidden: pan owns canvas movement, so browser scrollbars must
      // not fight it with a second, competing movement system.
      className="flex h-full w-full items-center justify-center overflow-hidden bg-transparent"
      style={{
        paddingTop: fitPadding.top,
        paddingRight: fitPadding.right,
        paddingBottom: fitPadding.bottom,
        paddingLeft: fitPadding.left,
        cursor: cursor || undefined,
        // Stop the browser claiming one-finger drags while panning on touch.
        touchAction: panToolActive || isPanning ? "none" : undefined,
      }}
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onAuxClick={(event) => {
        if (event.button === MIDDLE_MOUSE_BUTTON) event.preventDefault();
      }}
    >
      <div
        ref={surfaceRef}
        data-canvas-surface
        className="relative shrink-0 bg-white shadow-[0_10px_40px_rgba(48,56,57,0.12)]"
        style={{
          width: displayW,
          height: displayH,
          // One shared transform: artwork, safe area, bleed, guides, selection
          // outlines, handles and the inline editor all move together and stay
          // aligned, because they all live inside this element.
          transform: `translate3d(${panX}px, ${panY}px, 0)`,
          cursor: undefined,
        }}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag(false)}
        onPointerCancel={() => endDrag(true)}
        onPointerLeave={(event) => {
          if (!(event.currentTarget as HTMLElement).hasPointerCapture?.(event.pointerId)) endDrag(false);
        }}
        onPointerDown={beginSurfaceInteraction}
      >
        {/* Base render (shared with the customer) */}
        <div className="pointer-events-none absolute inset-0">
          <CustomizerPreview template={template} values={values} page={pageId} showSafeArea={showSafeArea} showBleed={showBleed} hiddenLayerIds={[]} />
        </div>

        {/* Alignment guides */}
        {guides.map((guide, index) =>
          guide.type === "v" ? (
            <span
              key={`g${index}`}
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-[#D4AF37]"
              style={{ left: guide.at * scale }}
            />
          ) : (
            <span
              key={`g${index}`}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 h-px bg-[#D4AF37]"
              style={{ top: guide.at * scale }}
            />
          ),
        )}

        {/* Drag marquee and combined selection are editor-only DOM overlays.
            Neither enters template state or the shared PNG/PDF renderer. */}
        {selectionBox && (
          <span
            aria-hidden
            data-admin-selection-marquee
            className="pointer-events-none absolute z-50 border border-[#D4AF37] bg-[#D4AF37]/12 shadow-[0_0_0_1px_rgba(255,255,255,0.7)]"
            style={{
              left: Math.min(selectionBox.startX, selectionBox.x) * scale,
              top: Math.min(selectionBox.startY, selectionBox.y) * scale,
              width: Math.abs(selectionBox.x - selectionBox.startX) * scale,
              height: Math.abs(selectionBox.y - selectionBox.startY) * scale,
            }}
          />
        )}

        {activeTool === "select" && multiBounds && (
          <div
            role="group"
            aria-label={`${selectionIds.length} selected objects. Drag to move the selection.`}
            aria-disabled={!multiCanMove}
            data-admin-multi-selection
            onPointerDown={onMultiSelectionPointerDown}
            className={`absolute border-2 border-[#D4AF37] bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${multiCanMove ? "cursor-move" : "cursor-not-allowed"}`}
            style={{
              left: multiBounds.left * scale,
              top: multiBounds.top * scale,
              width: multiBounds.width * scale,
              height: multiBounds.height * scale,
              touchAction: "none",
              pointerEvents: overlayInert ? "none" : undefined,
            }}
          >
            <span className="pointer-events-none absolute -top-7 left-0 whitespace-nowrap rounded-md bg-[#303839] px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.08em] text-white shadow-sm">
              {selectionIds.length} selected
            </span>
            <span aria-hidden className="pointer-events-none absolute left-[-4px] top-[-4px] h-2 w-2 rounded-sm border border-[#D4AF37] bg-white" />
            <span aria-hidden className="pointer-events-none absolute right-[-4px] top-[-4px] h-2 w-2 rounded-sm border border-[#D4AF37] bg-white" />
            <span aria-hidden className="pointer-events-none absolute bottom-[-4px] left-[-4px] h-2 w-2 rounded-sm border border-[#D4AF37] bg-white" />
            <span aria-hidden className="pointer-events-none absolute bottom-[-4px] right-[-4px] h-2 w-2 rounded-sm border border-[#D4AF37] bg-white" />
          </div>
        )}

        {/* Saved template guides. They are editor-only and never enter the SVG renderer. */}
        {savedGuides.filter((guide: any) => !guide.hidden).map((guide: any) => {
          const vertical = guide.axis === "vertical";
          const selected = selectedGuideId === guide.id;
          return (
            <div key={guide.id}>
              <button
                type="button"
                aria-label={`${vertical ? "Vertical" : "Horizontal"} guide at ${Math.round(guide.position)} pixels`}
                onPointerDown={(event) => onGuidePointerDown(event, guide)}
                className={`absolute z-30 cursor-col-resize border-0 bg-transparent p-0 focus-visible:outline-none ${vertical ? "inset-y-0 w-3 -translate-x-1/2" : "inset-x-0 h-3 -translate-y-1/2 cursor-row-resize"}`}
                style={{
                  ...(vertical ? { left: guide.position * scale } : { top: guide.position * scale }),
                  pointerEvents: panToolActive || isPanning ? "none" : undefined,
                }}
              >
                <span className={`absolute bg-[#D4AF37] ${vertical ? "inset-y-0 left-1/2 w-px" : "inset-x-0 top-1/2 h-px"}`} />
              </button>
              {selected && (
                <div className="absolute z-40 flex items-center gap-1 rounded-lg border border-[#303839]/12 bg-white p-1 shadow-lg" style={vertical ? { left: guide.position * scale + 8, top: 8 } : { left: 8, top: guide.position * scale + 8 }}>
                  <EditableNumericStepper label="Guide position" value={Math.round(guide.position)} minimum={0} maximum={vertical ? canvasW : canvasH} onCommit={(position) => onGuideChange?.(guide.id, { position })} className="h-8 w-28 rounded-md border border-[#303839]/12 bg-white" buttonClassName="grid h-full place-items-center text-[#303839]/55 hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-25" />
                  <button type="button" onClick={() => onGuideChange?.(guide.id, { locked: !guide.locked })} className="h-8 rounded-md px-2 text-[10px] font-bold hover:bg-[#F8F6F1]">{guide.locked ? "Unlock" : "Lock"}</button>
                  <button type="button" onClick={() => onGuideChange?.(guide.id, { deleted: true })} className="h-8 rounded-md px-2 text-[10px] font-bold text-red-700 hover:bg-red-50">Delete</button>
                </div>
              )}
            </div>
          );
        })}

        {/* Interactive overlay */}
        {activeTool !== "pan" && selectableLayers.map((layer: any) => {
          const inSelection = selectionIds.includes(layer.id);
          const selected = selectionIds.length === 1 && layer.id === selectedLayerId;
          const interactionLayer = layer.type === "text" ? singleLineInteractionLayer(layer) : layer;
          const boxLeft = (interactionLayer.x - interactionLayer.width / 2) * scale;
          const boxTop = (interactionLayer.y - interactionLayer.height / 2) * scale;
          const boxW = interactionLayer.width * scale;
          const boxH = interactionLayer.height * scale;
           const singleLineTextScale = selected && layer.type === "text" && isSingleLineAutoSizeText(
             layer.textStyle,
             interactionLayer.resolvedText ?? layer.text,
           );
           const textOverflow = selected && textOverflowForLayer(layer);
           const connectedField = layer.type === "text" && layer.fieldId ? getFieldById(template, layer.fieldId) : null;
           const characterLimits = [
             Number(connectedField?.maxLength) || 0,
             Number(layer.maxChars) || 0,
           ].filter((limit) => limit > 0);

          return (
            <div
              key={layer.id}
              data-canvas-layer={layer.id}
              role="button"
              tabIndex={0}
              onPointerDown={(e) => onLayerPointerDown(e, layer)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                // Double click is an explicit "work on this one object" action:
                // it replaces the selection rather than toggling it.
                onSelectionChange?.([layer.id]);
                if (layer.type === "group") onEnterGroup?.(layer.id);
                else if (layer.type === "text" && !layer.locked && layer.adminEditable !== false) beginTextEditing(layer.id);
              }}
               onKeyDown={(event) => {
                 if (event.key === "Enter" && layer.type === "group") {
                   event.preventDefault();
                   event.stopPropagation();
                   onEnterGroup?.(layer.id);
                   return;
                 }
                 if (event.key === "Enter" && layer.type === "text" && !layer.locked && layer.adminEditable !== false) {
                  event.preventDefault();
                  event.stopPropagation();
                  beginTextEditing(layer.id);
                }
              }}
              style={{
                position: "absolute",
                left: boxLeft,
                top: boxTop,
                width: boxW,
                height: boxH,
                transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                cursor: layer.locked ? "default" : "move",
                 outline: editingTextId === layer.id
                   ? "1px solid rgba(212,175,55,0.9)"
                   : selected
                   ? "2px solid #303839"
                   // Every member of a multi-selection is outlined, so click
                   // selection shows exactly what is in the set (spec §22).
                   : inSelection
                     ? "1.5px solid #D4AF37"
                     : "1px dashed rgba(48,56,57,0.22)",
                background: "transparent",
                touchAction: "none",
                // Space/middle-mouse pan keeps the selection visible but lets
                // the gesture through to the workspace.
                pointerEvents: overlayInert ? "none" : undefined,
              }}
            >
              {editingTextId === layer.id && (
                <InlineCanvasTextEditor
                   value={String(resolveLayerText(layer, layer.fieldId ? getFieldById(template, layer.fieldId) : null, values))}
                   multiline={Boolean(layer.textStyle?.multiline)}
                   allowMultiline
                   maxLines={Number(layer.maxLines) || 0}
                   maxLength={characterLimits.length ? Math.min(...characterLimits) : 0}
                   scale={scale}
                   textStyle={layer.textStyle}
                   onDraftChange={(text) => onTextDraftChange?.(layer.id, text)}
                   onMultilineActivate={() => onTextMultilineActivate?.(layer.id)}
                   onCommit={(text) => finishTextEditing(layer.id, text)}
                   onCancel={() => cancelTextEditing(layer.id)}
                   onEscape={onExitTextTool}
                 />
              )}
              {selected && editingTextId !== layer.id && (
                <span className="pointer-events-none absolute -top-6 left-0 z-10 whitespace-nowrap rounded bg-[#303839] px-1.5 py-0.5 text-[9px] font-bold text-white">
                  {layer.locked ? "🔒 " : ""}
                  {layer.name} · {Math.round(layer.x)},{Math.round(layer.y)} · {Math.round(layer.width)}×{Math.round(layer.height)}
                  {layer.rotation ? ` · ${Math.round(layer.rotation)}°` : ""}
                </span>
              )}
              {selected && !layer.locked && editingTextId !== layer.id && (
                <>
                  {(singleLineTextScale ? SINGLE_LINE_TEXT_HANDLES : HANDLES).map((h) => (
                    <button
                      type="button"
                      key={h.id}
                      data-canvas-handle={h.id}
                      aria-label={singleLineTextScale ? `Scale text from ${h.id === "w" ? "left" : "right"}` : `Resize from ${h.id}`}
                      title={singleLineTextScale ? "Drag to change font size. Hold Alt or Option to scale from the centre." : undefined}
                      onPointerDown={(e) => onHandlePointerDown(e, interactionLayer, h.id)}
                      className="absolute z-20 flex h-11 w-11 items-center justify-center border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-1"
                      style={{
                        left: `calc(${h.cx * 100}% - 22px)`,
                        top: `calc(${h.cy * 100}% - 22px)`,
                        cursor: h.cursor,
                        touchAction: "none",
                      }}
                    >
                      <span
                        aria-hidden
                        className={`block bg-white ${singleLineTextScale ? "h-3.5 w-3.5 rounded-full border-2 border-[#303839]" : "h-2.5 w-2.5 rounded-sm border-2 border-[#303839]"}`}
                      />
                    </button>
                  ))}
                  {/* Rotation handle */}
                  <span
                    onPointerDown={(e) => onRotatePointerDown(e, layer)}
                    title="Rotate"
                    style={{
                      position: "absolute",
                      left: "calc(50% - 6px)",
                      top: -26,
                      width: 12,
                      height: 12,
                      background: "#fff",
                      border: "2px solid #303839",
                      borderRadius: "50%",
                      cursor: "grab",
                      touchAction: "none",
                    }}
                  />
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: "calc(50% - 0.5px)",
                      top: -14,
                      width: 1,
                      height: 14,
                      background: "rgba(48,56,57,0.4)",
                      pointerEvents: "none",
                    }}
                  />
                </>
              )}
              {textOverflow && (
                <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 whitespace-nowrap rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-900 shadow-sm" role="status">
                  This text is too long for the available space. Reduce the text or use fewer lines.
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
