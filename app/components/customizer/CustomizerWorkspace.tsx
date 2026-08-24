"use client";

// Central canvas of the customer customizer. The design itself is drawn by the
// shared CustomizerPreview renderer; a Konva interaction layer on top adds
// selection, drag, resize, rotation, marquee, snapping and smart guides — but
// ONLY for layers the administrator made customer editable (plus the customer's
// own added layers). Locked and decorative layers never receive interaction.
//
// The interaction layer is the SHARED one (spec §7, §40): the admin design
// builder mounts the same component with `surface: "admin"`, so both surfaces
// now run identical selection and transform mathematics and differ only in the
// permissions they resolve. Photo crop keeps its own DOM surface, because crop
// is a modal gesture on a fixed frame rather than an object transform.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CustomizerPreview from "./CustomizerPreview";
import InlineCanvasTextEditor from "./InlineCanvasTextEditor";
import InteractionStageClient, { type GestureCommit } from "./interaction/InteractionStageClient";
import { useInteractionNodes } from "./interaction/useInteractionNodes";
import { getGridSlotRect, normalizeGridSlot } from "@/lib/customizer/v2/grids";
import { CustomizerWatermark } from "./CustomizerProtectionOverlay";
import {
  getEffectiveLayersForPage,
  getFieldById,
  getLayerPermissions,
  isLayerCustomerInteractive,
  resolveLayerText,
  type EditorState,
} from "./customizer-utils";
import {
  DEFAULT_LINE_HEIGHT,
  createCanvasMeasure,
  fallbackMeasure,
  getTextResizeConstraints,
  layoutText,
  type MeasureFn,
  type SafeBounds,
} from "@/lib/customizer/v2/text-layout";
import { resolveLayerSelectionGeometry } from "@/lib/customizer/v2/selection-geometry";
import { resolveLayerCapabilities } from "@/lib/customizer/v2/interaction/capabilities";
import { isEmptyText } from "@/lib/customizer/v2/text-editing";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  computeFitZoom,
  resolveCustomerBaseWidth,
} from "@/lib/customizer/v2/zoom";
import { useGoogleFontMetricsRevision } from "./useGoogleFonts";

type Props = {
  template: any;
  values: Record<string, any>;
  editorState: EditorState;
  pageId: string;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  // Reports the zoom that makes the whole page fit the CURRENT workspace box
  // (spec §9). Recomputed whenever the workspace resizes: panel open/close,
  // sidebar collapse, orientation change, keyboard, page change.
  onFitZoomChange?: (fitZoom: number) => void;
  selectedLayerId?: string | null;
  selectedLayerIds?: string[];
  onSelectLayer?: (layerId: string | null) => void;
  onSelectionChange?: (layerIds: string[]) => void;
  onLayerTransform?: (layerId: string, patch: any, phase: "start" | "move") => void;
  // Crop mode: drag/zoom the photo INSIDE its fixed frame (spec §11).
  cropLayerId?: string | null;
  onImageTransform?: (layerId: string, patch: any, phase: "start" | "move") => void;
  cropGridSlotId?: string | null;
  onGridSlotTransform?: (layerId: string, slotId: string, patch: any, phase: "start" | "move") => void;
  onGridSlotSelect?: (layerId: string, slotId: string) => void;
  onGridSlotAssetDrop?: (layerId: string, slotId: string, asset: any) => void;
  onElementDrop?: (element: any, position: { x: number; y: number }) => void;
  onTextEditStart?: (layerId: string) => void;
  onTextDraftChange?: (layerId: string, text: string) => void;
  onTextMultilineActivate?: (layerId: string) => void;
  onTextCancel?: (layerId: string, initial: {
    text: string;
    textStyle: Record<string, any>;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onTextDiscard?: (layerId: string) => void;
  onEditingTextChange?: (layerId: string | null) => void;
  onExitTextTool?: () => void;
  editTextRequest?: { layerId: string; requestId: number; created?: boolean } | null;
  onTextCommit?: (layerId: string, text: string) => void;
  onImageLayerActivate?: (layerId: string) => void;
  previewMode?: boolean;
  showWatermark?: boolean;
  showSafeArea?: boolean;
  showBleed?: boolean;
  maxCanvasWidth?: number;
  embedded?: boolean;
  interactionRotation?: number;
  editingGroupId?: string | null;
  onEnterGroup?: (groupId: string) => void;
  // Right click on an object (spec §20). The canvas resolves which object was
  // hit and selects it; the parent owns the menu and its permitted actions.
  onLayerContextMenu?: (layerId: string, position: { x: number; y: number }) => void;
};

export default function CustomizerWorkspace({
  template,
  values,
  editorState,
  pageId,
  zoom = 1,
  onZoomChange,
  onFitZoomChange,
  selectedLayerId,
  selectedLayerIds,
  onSelectLayer,
  onSelectionChange,
  onLayerTransform,
  cropLayerId = null,
  onImageTransform,
  cropGridSlotId = null,
  onGridSlotTransform,
  onGridSlotSelect,
  onGridSlotAssetDrop,
  onElementDrop,
  onTextEditStart,
  onTextDraftChange,
  onTextMultilineActivate,
  onTextCancel,
  onTextDiscard,
  onEditingTextChange,
  onExitTextTool,
  editTextRequest,
  onTextCommit,
  onImageLayerActivate,
  previewMode = false,
  showWatermark = false,
  showSafeArea,
  showBleed,
  maxCanvasWidth = 620,
  embedded = false,
  interactionRotation = 0,
  editingGroupId = null,
  onEnterGroup,
  onLayerContextMenu,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const textMeasureRef = useRef<MeasureFn>(fallbackMeasure);
  // Bumped once when webfonts finish loading and the real canvas measurer
  // replaces the fallback; memoized geometry depends on it.
  const [textMetricsRevision, setTextMetricsRevision] = useState(0);
  const gestureRef = useRef<any>(null);
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  // The element wrapping the rendered SVG. The interaction layer writes
  // transient gesture transforms straight onto the layer groups inside it, so a
  // drag costs one attribute write per frame instead of a document update
  // (spec §9).
  const previewRootRef = useRef<HTMLDivElement>(null);
  // Exact in-progress geometry while a resize or rotation is running. Held in
  // React (not the document) so the shared renderer can draw the real values —
  // real text wrapping, real photo fit — without a document write, a history
  // entry or an autosave.
  const [transientGeometry, setTransientGeometry] = useState<Record<string, Record<string, any>> | null>(null);
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

  const canvasW = template?.canvasWidthPx || 1500;
  const canvasH = template?.canvasHeightPx || 2100;
  const snappingEnabled = template?.settings?.snapping !== false;

  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => {
      setContainerWidth(el.clientWidth);
      setContainerHeight(el.clientHeight);
    };
    update();
    // ResizeObserver is the primary signal, but the first mount measurement can
    // land before sibling panels/toolbars have taken their space, and window
    // resize / orientation change are cheap extra guarantees. All three call the
    // same idempotent measure.
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

  useEffect(() => {
    let cancelled = false;
    const ready = (document as any).fonts?.ready || Promise.resolve();
    Promise.resolve(ready).then(() => {
      if (cancelled) return;
      textMeasureRef.current = createCanvasMeasure();
      setTextMetricsRevision((revision) => revision + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const padding = embedded ? 0 : 32;
  // What 100% means here is defined once, in the shared zoom module, alongside
  // the admin rule and the 1:1 rule — see `resolveCustomerBaseWidth` (spec §35).
  const baseWidth = resolveCustomerBaseWidth({
    availableWidth: containerWidth,
    padding,
    maxCanvasWidth,
  });
  const displayW = baseWidth * zoom;
  const displayH = displayW * (canvasH / canvasW);
  const scale = displayW / canvasW;

  // Real Fit (spec §9): derived from the measured workspace box on BOTH axes,
  // never a hardcoded 100%. Reported upward so the Fit button, the keyboard
  // shortcut and the initial view all use the same number.
  const fitZoom = computeFitZoom({
    availableWidth: containerWidth,
    availableHeight: containerHeight,
    baseWidth,
    canvasWidth: canvasW,
    canvasHeight: canvasH,
    padding,
  });
  useEffect(() => {
    if (fitZoom === null) return;
    onFitZoomChange?.(fitZoom);
    // onFitZoomChange is treated as a stable reporter; re-running on identity
    // changes would loop through the parent's setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitZoom]);

  // Resolving a page's layers walks the template, applies every customer
  // override and merges user layers. A drag pushes a state update on every
  // pointermove, so leaving this bare re-derived the whole page's geometry
  // dozens of times a second for a gesture that only moves one object (spec
  // §30).
  const layers = useMemo(
    () => getEffectiveLayersForPage(template, pageId, editorState),
    [template, pageId, editorState],
  );
  const googleFontMetricsRevision = useGoogleFontMetricsRevision(
    layers.filter((layer: any) => layer?.type === "text").map((layer: any) => layer.textStyle?.fontFamily),
  );
  useEffect(() => {
    if (googleFontMetricsRevision === 0) return;
    textMeasureRef.current = createCanvasMeasure();
    setTextMetricsRevision((revision) => revision + 1);
  }, [googleFontMetricsRevision]);

  // Auto-width text may grow only up to the safe area.
  const safeBounds: SafeBounds = useMemo(
    () => ({
      left: Number(template?.safeArea?.left) || 0,
      top: Number(template?.safeArea?.top) || 0,
      right: canvasW - (Number(template?.safeArea?.right) || 0),
      bottom: canvasH - (Number(template?.safeArea?.bottom) || 0),
    }),
    [template?.safeArea?.left, template?.safeArea?.top, template?.safeArea?.right, template?.safeArea?.bottom, canvasW, canvasH],
  );

  // Shared with the renderers via resolveTextBox, so the customer's selection
  // box and handles always sit exactly on the rendered glyphs.
  const resolveLayerBox = (layer: any) => {
    const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
    const text = resolveLayerText(layer, field, values);
    return resolveLayerSelectionGeometry(layer, {
      text: String(text),
      measure: textMeasureRef.current,
      safeBounds,
    });
  };
  const singleLineInteractionLayer = resolveLayerBox;

  // Wrapped so the gesture-commit callback below keeps a stable identity: an
  // unstable dependency there would re-render the whole interaction layer on
  // every parent render, which is exactly the cost this migration removes.
  const constrainTextSize = useCallback((layer: any, requestedWidth: number, requestedHeight: number) => {
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
      lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT,
      multiline: Boolean(style.multiline),
      fitMode: style.fitMode === "shrink" ? "shrink" as const : style.fitMode === "auto-height" ? "auto-height" as const : "fixed" as const,
    };
    let constraints = getTextResizeConstraints(input, textMeasureRef.current);
    const width = Math.max(constraints.minWidth, requestedWidth);
    constraints = getTextResizeConstraints({ ...input, width }, textMeasureRef.current);
    const height = style.fitMode === "auto-height"
      ? constraints.requiredHeight
      : Math.max(constraints.minHeight, requestedHeight);
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }, [template, values]);

  // Never warn just because the stored width is smaller than the typed text —
  // an auto-width box simply grows. Only a genuine safe-area or vertical
  // overflow, after expansion, is a real problem worth telling the customer.
  const textOverflowForLayer = (layer: any) => {
    if (layer?.type !== "text") return false;
    const style = layer.textStyle || {};
    const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
    const text = resolveLayerText(layer, field, values);
    const resolved = resolveLayerBox(layer);
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
      lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT,
      multiline: Boolean(style.multiline),
      fitMode: resolved.autoWidthClamped && !style.multiline
        ? "shrink"
        : style.fitMode === "shrink" ? "shrink" : style.fitMode === "auto-height" ? "auto-height" : "fixed",
    }, textMeasureRef.current);
    return layout.overflowWidth || layout.overflowHeight || layout.truncatedLines;
  };
  const cropLayer = cropLayerId ? layers.find((layer: any) => layer.id === cropLayerId) : null;
  const cropGridLayer = cropGridSlotId ? layers.find((layer: any) => layer.type === "grid" && (layer.slots || []).some((slot: any) => slot.id === cropGridSlotId)) : null;
  const cropGridSlot = cropGridLayer ? normalizeGridSlot(cropGridLayer.slots.find((slot: any) => slot.id === cropGridSlotId)) : null;
  const cropGridRect = cropGridLayer && cropGridSlot ? getGridSlotRect(cropGridLayer, cropGridSlot) : null;
  const interactiveLayers = useMemo(
    () =>
      previewMode
        ? []
        : cropLayer
          ? [] // while cropping, the crop surface owns all interaction
          : cropGridLayer
            ? []
          : layers
            .filter((layer: any) => !layer.hidden)
            .filter((layer: any) => layer.isUserLayer || isLayerCustomerInteractive(layer))
            .filter((layer: any) => {
              if (layer.type === "group" && editingGroupId === layer.id) return false;
              if (layer.groupId && layer.groupId !== editingGroupId) {
                const parent = layers.find((candidate: any) => candidate.id === layer.groupId);
                if (parent && (parent.isUserLayer || isLayerCustomerInteractive(parent))) return false;
              }
              return true;
            }),
    [layers, previewMode, cropLayer, cropGridLayer, editingGroupId],
  );

  // Memoised: this array is a dependency of the gesture callbacks AND a prop of
  // the interaction layer, so a fresh identity every render would defeat both.
  const activeSelection = useMemo(
    () => (selectedLayerIds?.length ? selectedLayerIds : selectedLayerId ? [selectedLayerId] : []),
    [selectedLayerIds, selectedLayerId],
  );

  const canEditTextLayer = (layer: any) =>
    layer?.type === "text" && (layer.isUserLayer || Boolean(getLayerPermissions(layer).editContent));

  const beginTextEditing = (layerId: string, created = false) => {
    if (editingTextId === layerId) return;
    const layer = layers.find((candidate: any) => candidate.id === layerId);
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

  useEffect(() => {
    if (!editTextRequest?.layerId) return;
    const layer = layers.find((candidate: any) => candidate.id === editTextRequest.layerId);
    // `created` marks a brand new object: leaving it empty discards it again.
    if (canEditTextLayer(layer)) beginTextEditing(layer.id, Boolean(editTextRequest.created));
    // requestId deliberately retriggers editing for the same selected layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTextRequest?.requestId]);

  useEffect(() => {
    setEditingTextId(null);
    textEditSessionRef.current = null;
    onEditingTextChange?.(null);
    // Canonical text is updated on every input event, so a page switch cannot
    // lose the last character even if the browser skips blur during unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  /* ---- capabilities, resolved by the SHARED permission model (spec §41) ---- */
  // The customer surface and the admin builder now ask the same resolver the
  // same question and differ only in the `surface` they pass, so a permission
  // fix can no longer land on one canvas and miss the other.
  const capabilitiesFor = useCallback(
    (layer: any) => resolveLayerCapabilities(layer, { surface: "customer", layers }),
    [layers],
  );

  // Interaction nodes: permission-filtered, with auto-width text already
  // measured so handles sit on the rendered glyphs rather than the stale stored
  // width. Memoised on the inputs that genuinely change geometry.
  const interactionNodes = useInteractionNodes({
    surface: "customer",
    layers,
    isTargetable: useCallback(
      (layer: any) => interactiveLayers.some((candidate: any) => candidate.id === layer.id),
      [interactiveLayers],
    ),
    resolveText: useCallback(
      (layer: any) =>
        String(resolveLayerText(layer, layer.fieldId ? getFieldById(template, layer.fieldId) : null, values)),
      [template, values],
    ),
    measure: textMeasureRef.current,
    safeBounds,
    editingGroupId,
    metricsRevision: textMetricsRevision,
  });

  const applySelection = useCallback(
    (ids: string[]) => {
      if (onSelectionChange) onSelectionChange(ids);
      else onSelectLayer?.(ids[ids.length - 1] || null);
    },
    [onSelectionChange, onSelectLayer],
  );

  /* ---- gesture -> document ---- */

  // One history entry per gesture, taken on the object that started it
  // (spec §45). Autosave then persists the committed state exactly once.
  const handleGestureStart = useCallback(() => {
    const lead = activeSelection[0];
    if (lead) onLayerTransform?.(lead, {}, "start");
  }, [activeSelection, onLayerTransform]);

  /**
   * Commit normalised Husnalogy geometry (spec §8).
   *
   * Text keeps its layout constraints here rather than inside the interaction
   * layer: the minimum width a string needs is a TEXT question, answered by the
   * shared layout engine, and Konva has no business knowing about it.
   */
  const commitChanges = useCallback(
    (changes: GestureCommit[]) => {
      for (const change of changes) {
        const layer = layers.find((candidate: any) => candidate.id === change.id);
        let patch: Record<string, any> = { ...change.patch };
        if (layer?.type === "text" && (patch.width !== undefined || patch.height !== undefined)) {
          const constrained = constrainTextSize(
            layer,
            Number(patch.width ?? layer.width),
            Number(patch.height ?? layer.height),
          );
          patch = { ...patch, width: constrained.width, height: constrained.height };
        }
        onLayerTransform?.(change.id, patch, "move");
      }
    },
    [layers, onLayerTransform, constrainTextSize],
  );


  const onCropPointerDown = (e: React.PointerEvent, layer: any) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const transform = layer.imageTransform || {};
    dragRef.current = {
      mode: "crop-pan",
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: Number(transform.offsetX) || 0,
      startOffsetY: Number(transform.offsetY) || 0,
    };
  };

  const onGridCropPointerDown = (e: React.PointerEvent, layer: any, slot: any) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "grid-crop-pan",
      layerId: layer.id,
      slotId: slot.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: Number(slot.transform?.offsetX) || 0,
      startOffsetY: Number(slot.transform?.offsetY) || 0,
    };
  };

  /**
   * Crop is the ONE gesture that still lives in the DOM (spec §26).
   *
   * Everything else — selection, drag, resize, rotation, marquee — moved to the
   * shared Konva interaction layer. Crop stayed because it is not an object
   * transform at all: the frame is fixed and the PHOTO moves inside it, so it
   * needs the mask surface rather than the object hit graph. Keeping it here
   * also keeps the two gestures from ever owning the pointer at the same time,
   * which is the priority rule in spec §37 expressed structurally.
   */
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.began) {
      drag.began = true;
      if (drag.mode === "crop-pan") onImageTransform?.(drag.layerId, {}, "start");
      else if (drag.mode === "grid-crop-pan") onGridSlotTransform?.(drag.layerId, drag.slotId, {}, "start");
    }
    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;
    if (drag.mode === "crop-pan") {
      onImageTransform?.(
        drag.layerId,
        { offsetX: Math.round(drag.startOffsetX + dx), offsetY: Math.round(drag.startOffsetY + dy) },
        "move",
      );
      return;
    }
    if (drag.mode === "grid-crop-pan") {
      onGridSlotTransform?.(
        drag.layerId,
        drag.slotId,
        { offsetX: Math.round(drag.startOffsetX + dx), offsetY: Math.round(drag.startOffsetY + dy) },
        "move",
      );
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };


  // Wheel zoom while cropping (spec §11).
  const onCropWheel = (e: React.WheelEvent, layer: any) => {
    e.preventDefault();
    e.stopPropagation();
    const transform = layer.imageTransform || {};
    const current = Number(transform.zoom) > 0 ? Number(transform.zoom) : 1;
    const next = Math.min(8, Math.max(1, current * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    onImageTransform?.(layer.id, { zoom: Number(next.toFixed(3)) }, "move");
  };

  const onGridCropWheel = (e: React.WheelEvent, layer: any, slot: any) => {
    e.preventDefault();
    e.stopPropagation();
    const current = Number(slot.transform?.zoom) > 0 ? Number(slot.transform.zoom) : 1;
    const next = Math.min(8, Math.max(1, current * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    onGridSlotTransform?.(layer.id, slot.id, { zoom: Number(next.toFixed(3)) }, "move");
  };

  const onGesturePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointsRef.current.size !== 2) return;
    const [first, second] = [...touchPointsRef.current.values()];
    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;
    gestureRef.current = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      centerX,
      centerY,
      zoom,
      cropZoom: Number(cropLayer?.imageTransform?.zoom) || 1,
      gridZoom: Number(cropGridSlot?.transform?.zoom) || 1,
      scrollLeft: wrapRef.current?.scrollLeft || 0,
      scrollTop: wrapRef.current?.scrollTop || 0,
    };
    dragRef.current = null;
    if (cropLayer) onImageTransform?.(cropLayer.id, {}, "start");
    if (cropGridLayer && cropGridSlot) onGridSlotTransform?.(cropGridLayer.id, cropGridSlot.id, {}, "start");
  };

  const onGesturePointerMove = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch" || !touchPointsRef.current.has(event.pointerId)) return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (!gesture || touchPointsRef.current.size < 2) return;
    event.preventDefault();
    const [first, second] = [...touchPointsRef.current.values()];
    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    const ratio = distance / Math.max(1, gesture.distance);
    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;
    if (cropLayer) {
      onImageTransform?.(cropLayer.id, { zoom: Number(Math.min(8, Math.max(1, gesture.cropZoom * ratio)).toFixed(3)) }, "move");
    } else if (cropGridLayer && cropGridSlot) {
      onGridSlotTransform?.(cropGridLayer.id, cropGridSlot.id, { zoom: Number(Math.min(8, Math.max(1, gesture.gridZoom * ratio)).toFixed(3)) }, "move");
    } else {
      onZoomChange?.(clampZoom(gesture.zoom * ratio, ZOOM_MIN, ZOOM_MAX));
      if (wrapRef.current) {
        wrapRef.current.scrollLeft = gesture.scrollLeft - (centerX - gesture.centerX);
        wrapRef.current.scrollTop = gesture.scrollTop - (centerY - gesture.centerY);
      }
    }
  };

  const onGesturePointerUp = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    touchPointsRef.current.delete(event.pointerId);
    if (touchPointsRef.current.size < 2) gestureRef.current = null;
  };

  return (
    /**
     * Scroll container for a canvas that can be larger than the viewport.
     *
     * The centring is done with `margin: auto` on the page itself, NOT with
     * `justify-center` / `items-center` on this flex container. That is the
     * whole fix for zoomed-in navigation: when a flex container centres an item
     * that overflows, the overflow is split evenly across BOTH sides, and the
     * leading half ends up at a negative scroll offset that no scrollbar can
     * reach — so at 150% or 200% the top and left of the card were simply
     * unreachable. Auto margins collapse to zero once free space runs out, so
     * the page is centred while it fits and scrolls edge to edge once it does
     * not.
     *
     * Wheel scrolling is the browser's own: nothing here calls preventDefault
     * on wheel, and the Konva stage does not listen for it, so vertical wheel,
     * Shift+wheel and trackpad panning all behave natively. Crop mode is the
     * one deliberate exception and owns its wheel while it is active.
     */
    <div
      ref={wrapRef}
      className={embedded ? "flex h-full w-full items-start justify-center overflow-hidden" : "flex h-full w-full overflow-auto p-4 sm:p-8"}
    >
      <div
        ref={surfaceRef}
        className={`relative shrink-0 bg-white shadow-[0_10px_40px_rgba(48,56,57,0.12)]${embedded ? "" : " m-auto"}`}
        style={{
          width: displayW,
          height: displayH,
          touchAction: editingTextId ? "manipulation" : "none",
          cursor: undefined,
        }}
        onPointerDownCapture={onGesturePointerDown}
        onPointerMoveCapture={onGesturePointerMove}
        onPointerUpCapture={onGesturePointerUp}
        onPointerCancelCapture={onGesturePointerUp}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={(event) => {
          if (!(event.currentTarget as HTMLElement).hasPointerCapture?.(event.pointerId)) endDrag();
        }}
        onPointerCancel={endDrag}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-husnalogy-element")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("application/x-husnalogy-element")) return;
          event.preventDefault();
          try {
            const element = JSON.parse(event.dataTransfer.getData("application/x-husnalogy-element"));
            const rect = surfaceRef.current?.getBoundingClientRect();
            if (!rect) return;
            onElementDrop?.(element, { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale });
          } catch {
            // Ignore malformed external drag payloads.
          }
        }}
      >
        {/* Shared renderer — identical output to thumbnails, review, exports. */}
        <div ref={previewRootRef} className="pointer-events-none absolute inset-0">
          <CustomizerPreview
            template={template}
            values={values}
            editorState={editorState}
            page={pageId}
            showSafeArea={previewMode ? false : showSafeArea}
            showBleed={previewMode ? false : showBleed}
            hiddenLayerIds={[]}
            geometryOverrides={transientGeometry}
          />
        </div>

        {showWatermark && <CustomizerWatermark />}

        {/* Shared Konva interaction layer (spec §7). Selection, dragging,
            transform handles, marquee and smart guides all live here, for both
            this surface and the admin builder. It is suppressed while cropping
            and while the DOM text editor is open so the two never compete for
            the pointer (spec §37). */}
        <InteractionStageClient
          documentWidth={canvasW}
          documentHeight={canvasH}
          scale={scale}
          nodes={interactionNodes}
          selectedIds={activeSelection}
          editingGroupId={editingGroupId}
          textEditingId={editingTextId}
          disabled={previewMode || Boolean(cropLayer) || Boolean(cropGridLayer)}
          snapping={{
            enabled: snappingEnabled,
            safeArea: template?.safeArea,
            // The customer only ever snaps to guides the template chose to expose.
            guides: (template?.guides || []).filter((guide: any) => guide?.customerVisible !== false),
            pageId,
            neighbours: layers,
          }}
          previewRootRef={previewRootRef}
          onSelectionChange={applySelection}
          onGestureStart={handleGestureStart}
          onGestureCommit={commitChanges}
          onTransientGeometry={setTransientGeometry}
          onDoubleClickNode={(layerId) => {
            const layer = layers.find((candidate: any) => candidate.id === layerId);
            if (!layer) return;
            applySelection([layer.id]);
            if (layer.type === "group") onEnterGroup?.(layer.id);
            else if (canEditTextLayer(layer)) beginTextEditing(layer.id);
            else if (layer.type === "image" || layer.type === "frame") onImageLayerActivate?.(layer.id);
          }}
          onContextMenuNode={(layerId, position) => {
            if (previewMode || editingTextId) return;
            if (!activeSelection.includes(layerId)) applySelection([layerId]);
            onLayerContextMenu?.(layerId, position);
          }}
          onGridSlotSelect={(layerId, slotId) => onGridSlotSelect?.(layerId, slotId)}
        />

        {/* Crop mode surface: frame stays fixed, photo pans/zooms inside. */}
        {cropLayer && (
          <>
            <div className="pointer-events-none absolute inset-0 z-30 bg-[#303839]/25" aria-hidden />
            <div
              role="application"
              aria-label="Crop photo — drag to reposition, scroll to zoom"
              onPointerDown={(e) => onCropPointerDown(e, cropLayer)}
              onWheel={(e) => onCropWheel(e, cropLayer)}
              className="absolute z-40 cursor-grab active:cursor-grabbing"
              style={{
                left: (cropLayer.x - cropLayer.width / 2) * scale,
                top: (cropLayer.y - cropLayer.height / 2) * scale,
                width: cropLayer.width * scale,
                height: cropLayer.height * scale,
                transform: cropLayer.rotation ? `rotate(${cropLayer.rotation}deg)` : undefined,
                outline: "2px solid #D4AF37",
                outlineOffset: 2,
                boxShadow: "0 0 0 9999px rgba(48,56,57,0.0)",
                touchAction: "none",
                background: "transparent",
              }}
            >
              {/* Rule-of-thirds grid */}
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/70" />
            </div>
          </>
        )}

        {cropGridLayer && cropGridSlot && cropGridRect && (
          <>
            <div className="pointer-events-none absolute inset-0 z-30 bg-[#303839]/25" aria-hidden />
            <div
              role="application"
              aria-label="Crop grid photo — drag to reposition, scroll to zoom"
              onPointerDown={(event) => onGridCropPointerDown(event, cropGridLayer, cropGridSlot)}
              onWheel={(event) => onGridCropWheel(event, cropGridLayer, cropGridSlot)}
              className="absolute z-40 cursor-grab outline outline-2 outline-[#D4AF37] active:cursor-grabbing"
              style={{
                left: cropGridRect.x * scale,
                top: cropGridRect.y * scale,
                width: cropGridRect.width * scale,
                height: cropGridRect.height * scale,
                transform: cropGridLayer.rotation ? `rotate(${cropGridLayer.rotation}deg)` : undefined,
                transformOrigin: `${(cropGridLayer.x - cropGridRect.x) * scale}px ${(cropGridLayer.y - cropGridRect.y) * scale}px`,
                touchAction: "none",
              }}
            >
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/70" />
            </div>
          </>
        )}

        {/* DOM overlay, now limited to what the DOM is genuinely better at:
            the inline text editor and the text-overflow warning. Selection
            chrome, handles and hit targets moved to the Konva layer above, so
            there is exactly ONE interaction engine on this canvas (spec §61). */}
        {interactionNodes.map((node) => {
          const layer = layers.find((candidate: any) => candidate.id === node.id);
          if (!layer) return null;
          const isEditing = editingTextId === node.id;
          const showOverflow =
            activeSelection.includes(node.id) && !isEditing && textOverflowForLayer(layer);
          if (!isEditing && !showOverflow) return null;

          const connectedField = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
          const characterLimits = [
            Number(connectedField?.maxLength) || 0,
            Number(layer.maxChars) || 0,
          ].filter((limit) => limit > 0);

          return (
            <div
              key={node.id}
              data-canvas-layer={node.id}
              className="pointer-events-none absolute"
              style={{
                left: (node.x - node.width / 2) * scale,
                top: (node.y - node.height / 2) * scale,
                width: node.width * scale,
                height: node.height * scale,
                transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
                zIndex: 60,
              }}
            >
              {isEditing && (
                <div className="pointer-events-auto absolute inset-0" style={{ touchAction: "manipulation" }}>
                  <InlineCanvasTextEditor
                    value={String(resolveLayerText(layer, connectedField, values))}
                    multiline={Boolean(layer.textStyle?.multiline)}
                    // Any editable text object promotes in place on its first
                    // manual line break. The parent keeps permissions and field
                    // connection unchanged while the shared renderer switches
                    // the object to multiline auto-height geometry.
                    allowMultiline={canEditTextLayer(layer)}
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
                </div>
              )}
              {showOverflow && (
                <span
                  className="absolute left-0 top-full mt-2 whitespace-nowrap rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-900 shadow-sm"
                  role="status"
                >
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
