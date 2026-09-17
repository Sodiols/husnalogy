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

/** One layer's share of a transform transaction. */
export type LayerTransformChange = GestureCommit;
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
  createFrameScheduler,
  createTransientGeometryStore,
  type TransientGeometryStore,
} from "@/lib/customizer/v2/interaction/transient-preview";
import { recordEditorEvent, recordRender } from "@/lib/customizer/v2/dev-metrics";

/** How a crop session ended. Never inferred — the owner states it. */
export type CropExitMode = "commit" | "discard";

export type CropSessionKind = "layer" | "slot";

/** Which input drove the session; a wheel/pinch burst settles on a timer. */
export type CropInteraction = "pan" | "wheel" | "pinch";

export type CropSession = {
  /** Monotonic. An async continuation is only valid while this still matches. */
  id: number;
  kind: CropSessionKind;
  layerId: string;
  slotId?: string;
  interaction: CropInteraction;
  /** Accumulated transient values, merged over the layer's committed transform. */
  patch: Record<string, number>;
  /** False until something changed, so Done-with-no-change writes nothing. */
  dirty: boolean;
};

/** Imperative handle the owner uses to drive crop Done / Cancel. */
export type CropSessionApi = {
  finish: (mode: CropExitMode) => void;
  isDirty: () => boolean;
};

/**
 * How long a wheel or pinch burst may idle before it counts as finished.
 * Long enough that a normal scroll burst stays one transaction, short enough
 * that Done/Cancel never has to wait on it.
 */
const CROP_SETTLE_MS = 260;
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
  /**
   * Commit a whole gesture as ONE transaction. When provided it is used for every
   * gesture commit; `onLayerTransform` remains as a per-layer fallback for
   * owners that do not persist (the admin's customer simulation).
   */
  onLayerTransforms?: (changes: LayerTransformChange[]) => void;
  // Crop mode: drag/zoom the photo INSIDE its fixed frame (spec §11).
  cropLayerId?: string | null;
  onImageTransform?: (layerId: string, patch: any, phase: "start" | "move") => void;
  /**
   * Receives the imperative crop handle. The owner owns the Done/Cancel
   * buttons, so it must be able to end the live session explicitly rather than
   * letting the workspace guess intent from crop mode closing.
   */
  cropSessionApi?: { current: CropSessionApi | null };
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
  onLayerTransforms,
  cropLayerId = null,
  onImageTransform,
  cropSessionApi,
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
  recordRender("workspace");
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
  // Live resize, rotation and crop geometry. Held in a per-layer store rather
  // than React state: publishing a frame re-renders only the layer being
  // changed, never this workspace or the rest of the page (spec §19).
  const transientStoreRef = useRef<TransientGeometryStore | null>(null);
  if (!transientStoreRef.current) transientStoreRef.current = createTransientGeometryStore();
  const transientStore = transientStoreRef.current;
  const setTransientGeometry = useCallback(
    (overrides: Record<string, Record<string, unknown>> | null) => transientStore.set(overrides),
    [transientStore],
  );
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

  /* ---------------------------------------------------------------------- */
  /* Crop — transient, with an EXPLICIT commit/discard exit                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Crop used to be the last gesture that wrote the document on every event
   * (spec §11, §49). A crop pan called `onImageTransform(..., "move")` per
   * `pointermove`, and each call set editor state on the owner — which
   * re-derived the page's effective layers, re-measured every text object and
   * re-rendered the whole workspace, at pointer frequency.
   *
   * It now follows the same model as drag, resize and rotation: the gesture
   * publishes TRANSIENT values only this component renders, and the document is
   * written once when the gesture completes. The preview is exact rather than
   * approximate because the override feeds the same
   * `resolveImageDrawBoxFromTransform` the committed render and the print
   * renderer use — there is no second crop formula to drift out of step.
   *
   * The exit is DELIBERATELY explicit. An earlier revision committed whenever
   * crop mode closed, which silently made Cancel behave like Done: Cancel
   * restored the pre-crop backup and the pending session then wrote the
   * abandoned geometry straight back over it. Nothing may infer intent from
   * `cropLayerId` going null — the owner states "commit" or "discard".
   *
   * Every session carries an id, and each async continuation re-checks it
   * before touching anything. A frame or settle timer belonging to a discarded
   * (or superseded) session is therefore inert rather than a delayed write.
   */
  const cropSchedulerRef = useRef<ReturnType<typeof createFrameScheduler> | null>(null);
  if (!cropSchedulerRef.current) cropSchedulerRef.current = createFrameScheduler();
  const cropSessionRef = useRef<CropSession | null>(null);
  /** Settles a zoom burst (wheel/pinch), which has no natural pointer release. */
  const cropSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cropSessionSeqRef = useRef(0);

  /** True while `id` is still the live session. Guards every async continuation. */
  const cropSessionIsCurrent = useCallback((id: number) => cropSessionRef.current?.id === id, []);

  const clearCropTimers = useCallback(() => {
    if (cropSettleTimerRef.current) {
      clearTimeout(cropSettleTimerRef.current);
      cropSettleTimerRef.current = null;
    }
    cropSchedulerRef.current!.cancel();
  }, []);

  const paintCropPreview = useCallback(
    (sessionId: number) => {
      const session = cropSessionRef.current;
      if (!session || session.id !== sessionId) return;
      if (session.kind === "layer") {
        setTransientGeometry({ [session.layerId]: { imageTransform: { ...session.patch } } });
        return;
      }
      // A slot's transform lives inside the grid layer's `slots`, so the
      // override carries the whole array with one slot's transform merged.
      const grid = layers.find((layer: any) => layer.id === session.layerId);
      if (!grid) return;
      const slots = (grid.slots || []).map((slot: any) =>
        slot?.id === session.slotId
          ? { ...slot, transform: { ...(slot.transform || {}), ...session.patch } }
          : slot,
      );
      setTransientGeometry({ [session.layerId]: { slots } });
    },
    [layers, setTransientGeometry],
  );

  /**
   * End the live crop gesture.
   *
   * "commit" writes the accumulated geometry to the document exactly once, and
   * only if something actually changed. "discard" throws it away. Either way
   * every pending frame and timer is cancelled and the session id is retired
   * FIRST, so anything already queued fires against a stale id and does nothing.
   */
  const finishCropSession = useCallback(
    (mode: CropExitMode) => {
      clearCropTimers();
      const session = cropSessionRef.current;
      cropSessionRef.current = null;
      cropSessionSeqRef.current += 1;
      if (!session) return;

      setTransientGeometry(null);
      if (mode !== "commit" || !session.dirty || !Object.keys(session.patch).length) {
        recordEditorEvent("cropDiscard");
        return;
      }

      recordEditorEvent("cropCommit");
      if (session.kind === "layer") onImageTransform?.(session.layerId, session.patch, "move");
      else if (session.slotId) onGridSlotTransform?.(session.layerId, session.slotId, session.patch, "move");
    },
    [clearCropTimers, onImageTransform, onGridSlotTransform, setTransientGeometry],
  );

  // Stable indirection so callers declared above can end a session without a
  // declaration cycle, and so the imperative API never captures a stale closure.
  const finishCropSessionRef = useRef(finishCropSession);
  finishCropSessionRef.current = finishCropSession;

  /**
   * Open a crop session for a target.
   *
   * Switching target mid-flight commits the previous one: the customer made
   * that edit deliberately, and silently dropping it would lose work.
   */
  const beginCropSession = useCallback(
    (kind: CropSessionKind, interaction: CropInteraction, layerId: string, slotId?: string) => {
      const existing = cropSessionRef.current;
      if (existing && existing.layerId === layerId && existing.slotId === slotId) {
        existing.interaction = interaction;
        return existing.id;
      }
      if (existing) finishCropSessionRef.current("commit");
      const id = (cropSessionSeqRef.current += 1);
      cropSessionRef.current = { id, kind, layerId, slotId, interaction, patch: {}, dirty: false };
      recordEditorEvent("cropSessionStarted");
      return id;
    },
    [],
  );

  const previewCrop = useCallback(
    (sessionId: number, patch: Record<string, number>) => {
      const session = cropSessionRef.current;
      if (!session || session.id !== sessionId) return;
      session.patch = { ...session.patch, ...patch };
      session.dirty = true;
      cropSchedulerRef.current!.schedule(() => paintCropPreview(sessionId));
    },
    [paintCropPreview],
  );

  /** A zoom burst has no pointer release, so it settles on inactivity. */
  const scheduleCropSettle = useCallback(
    (sessionId: number) => {
      if (cropSettleTimerRef.current) clearTimeout(cropSettleTimerRef.current);
      cropSettleTimerRef.current = setTimeout(() => {
        cropSettleTimerRef.current = null;
        // The burst may have been cancelled, or another target may now own crop,
        // while this timer was waiting.
        if (!cropSessionIsCurrent(sessionId)) return;
        cropSchedulerRef.current!.flush();
        finishCropSessionRef.current("commit");
      }, CROP_SETTLE_MS);
    },
    [cropSessionIsCurrent],
  );

  /**
   * The owner drives Done and Cancel, so it needs to reach the live session.
   * Assigned during render rather than in an effect because Cancel can be
   * clicked in the same commit that mounts crop mode.
   */
  if (cropSessionApi) {
    cropSessionApi.current = {
      finish: (mode: CropExitMode) => {
        if (mode === "commit") cropSchedulerRef.current!.flush();
        finishCropSessionRef.current(mode);
      },
      isDirty: () => Boolean(cropSessionRef.current?.dirty),
    };
  }

  // Unmount must never strand a gesture. Committing is the safe direction: the
  // customer performed the edit, and the alternative loses it silently.
  useEffect(() => {
    const finish = finishCropSessionRef;
    return () => {
      finish.current("commit");
    };
  }, []);

  // The image disappearing underneath crop retires the session rather than
  // leaving frames and timers pointed at a layer that is no longer on screen.
  useEffect(() => {
    const session = cropSessionRef.current;
    if (!session) return;
    if (!layers.some((layer: any) => layer.id === session.layerId)) {
      finishCropSessionRef.current("discard");
    }
  }, [layers]);

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

  /**
   * Commit normalised Husnalogy geometry (spec §8).
   *
   * Text keeps its layout constraints here rather than inside the interaction
   * layer: the minimum width a string needs is a TEXT question, answered by the
   * shared layout engine, and Konva has no business knowing about it.
   */
  const commitChanges = useCallback(
    (changes: GestureCommit[]) => {
      if (!changes.length) return;
      const layersById = new Map(layers.map((layer: any) => [layer.id, layer]));
      const constrained = changes.map((change) => {
        const layer = layersById.get(change.id);
        const patch: Record<string, any> = { ...change.patch };
        if (layer?.type !== "text" || (patch.width === undefined && patch.height === undefined)) {
          return { id: change.id, patch };
        }
        const size = constrainTextSize(layer, Number(patch.width ?? layer.width), Number(patch.height ?? layer.height));
        return { id: change.id, patch: { ...patch, width: size.width, height: size.height } };
      });
      // The whole gesture is one transaction: one history entry, one document
      // write and one autosave, however many objects moved (spec §8).
      if (onLayerTransforms) {
        onLayerTransforms(constrained);
        return;
      }
      for (const change of constrained) onLayerTransform?.(change.id, change.patch, "move");
    },
    [layers, onLayerTransform, onLayerTransforms, constrainTextSize],
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
      drag.sessionId =
        drag.mode === "crop-pan"
          ? beginCropSession("layer", "pan", drag.layerId)
          : drag.mode === "grid-crop-pan"
            ? beginCropSession("slot", "pan", drag.layerId, drag.slotId)
            : null;
    }
    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;
    if ((drag.mode === "crop-pan" || drag.mode === "grid-crop-pan") && drag.sessionId !== null) {
      previewCrop(drag.sessionId, {
        offsetX: Math.round(drag.startOffsetX + dx),
        offsetY: Math.round(drag.startOffsetY + dy),
      });
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    // Only a crop gesture that actually moved has anything to commit; a plain
    // press inside the frame must not push an empty step onto the undo stack.
    if (drag?.began && (drag.mode === "crop-pan" || drag.mode === "grid-crop-pan")) {
      cropSchedulerRef.current!.flush();
      finishCropSessionRef.current("commit");
    }
  };


  // Wheel zoom while cropping (spec §11).
  const onCropWheel = (e: React.WheelEvent, layer: any) => {
    e.preventDefault();
    e.stopPropagation();
    const sessionId = beginCropSession("layer", "wheel", layer.id);
    const live = cropSessionRef.current?.patch.zoom;
    const current = Number(live) > 0 ? Number(live) : Number(layer.imageTransform?.zoom) > 0 ? Number(layer.imageTransform.zoom) : 1;
    const next = Math.min(8, Math.max(1, current * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    previewCrop(sessionId, { zoom: Number(next.toFixed(3)) });
    scheduleCropSettle(sessionId);
  };

  const onGridCropWheel = (e: React.WheelEvent, layer: any, slot: any) => {
    e.preventDefault();
    e.stopPropagation();
    const sessionId = beginCropSession("slot", "wheel", layer.id, slot.id);
    const live = cropSessionRef.current?.patch.zoom;
    const current = Number(live) > 0 ? Number(live) : Number(slot.transform?.zoom) > 0 ? Number(slot.transform.zoom) : 1;
    const next = Math.min(8, Math.max(1, current * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    previewCrop(sessionId, { zoom: Number(next.toFixed(3)) });
    scheduleCropSettle(sessionId);
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
      cropSessionId: null as number | null,
    };
    dragRef.current = null;
    if (cropLayer) {
      gestureRef.current.cropSessionId = beginCropSession("layer", "pinch", cropLayer.id);
    } else if (cropGridLayer && cropGridSlot) {
      gestureRef.current.cropSessionId = beginCropSession("slot", "pinch", cropGridLayer.id, cropGridSlot.id);
    }
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
    if (cropLayer && gesture.cropSessionId != null) {
      previewCrop(gesture.cropSessionId, { zoom: Number(Math.min(8, Math.max(1, gesture.cropZoom * ratio)).toFixed(3)) });
    } else if (cropGridLayer && cropGridSlot && gesture.cropSessionId != null) {
      previewCrop(gesture.cropSessionId, { zoom: Number(Math.min(8, Math.max(1, gesture.gridZoom * ratio)).toFixed(3)) });
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
    if (touchPointsRef.current.size < 2) {
      gestureRef.current = null;
      // Lifting a finger ends a pinch-crop, so commit rather than waiting for
      // the inactivity timer.
      if (cropSessionRef.current?.interaction === "pinch") {
        cropSchedulerRef.current!.flush();
        finishCropSessionRef.current("commit");
      }
    }
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
        <div ref={previewRootRef} data-customizer-canvas="main" className="pointer-events-none absolute inset-0">
          <CustomizerPreview
            template={template}
            values={values}
            editorState={editorState}
            page={pageId}
            showSafeArea={previewMode ? false : showSafeArea}
            showBleed={previewMode ? false : showBleed}
            hiddenLayerIds={[]}
            transientStore={transientStore}
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
