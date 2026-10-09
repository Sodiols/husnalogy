"use client";

// Interactive admin editing canvas. The base render is the SHARED renderer
// (CustomizerPreview) so what admin arranges is exactly what customers get.
//
// Selection, dragging, transform handles, marquee and smart guides come from
// the SHARED Konva interaction layer — the very same component the customer
// workspace mounts (spec §7, §40). Admin passes `surface: "admin"`, and that
// permission difference is now the only behavioural difference between the two
// canvases. What stays here is what is genuinely admin-only or genuinely DOM:
// ruler guides, the inline text editor, panning, and the workspace fit maths.

import { manualWidthStylePatch } from "@/lib/customizer/v2/text-editing";
import { STUDIO_SELECTION_THEME } from "@/lib/customizer/v2/interaction/selection-theme";
import { SMALL_TEXT_MAX_POINT_SIZE, pointsToDocumentPx } from "@/lib/customizer/v2/type-units";
import { DEFAULT_FONT_FAMILY } from "@/lib/customizer/v2/google-fonts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import { createTransientGeometryStore, type TransientGeometryStore } from "@/lib/customizer/v2/interaction/transient-preview";
import InteractionStageClient from "@/app/components/customizer/interaction/InteractionStageClient";
import { useInteractionNodes } from "@/app/components/customizer/interaction/useInteractionNodes";
import { useSelectOnPressWhileEditing } from "@/app/components/customizer/interaction/useSelectOnPressWhileEditing";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import InlineCanvasTextEditor from "@/app/components/customizer/InlineCanvasTextEditor";
import {
  DEFAULT_LINE_HEIGHT,
  createCanvasMeasure,
  getTextResizeConstraints,
  layoutText,
  resolvedTextLayoutMode,
  type MeasureFn,
  type SafeBounds,
} from "@/lib/customizer/v2/text-layout";
import { pageSafeBounds, pageSafeInsets } from "@/lib/customizer/v2/safe-area";
import { getFieldById, resolveLayerImage, resolveLayerText } from "@/app/components/customizer/customizer-utils";
import {
  createPanGesture,
  isTypingTarget,
  MIDDLE_MOUSE_BUTTON,
  panCursor,
  normalizeWheelDelta,
  panFromGesture,
  panFromWheel,
  panHasPointerPriority,
  PAN_TOOL,
  shouldBeginPan,
  wheelZoomFactor,
  type PanBounds,
  type PanGesture,
} from "@/lib/customizer/v2/viewport-pan";
import { clampZoom, panForZoomAtPoint } from "@/lib/customizer/v2/zoom";
import { resolveLayerSelectionGeometry } from "@/lib/customizer/v2/selection-geometry";
import { cropPanDelta, resolveCropRect, resolveImageDrawBoxFromTransform } from "@/lib/customizer/v2/image-crop";
import { ERASE_LIMITS, canvasPointToDrawBox, normalizeEraseMask, type EraseStroke } from "@/lib/customizer/v2/erase-mask";
import AdminEraserBar, { ERASER_BRUSH } from "./AdminEraserBar";
import { isEmptyText } from "@/lib/customizer/v2/text-editing";
import { actualSizeZoom, computeWorkspaceFit, resolveWorkspacePadding } from "@/lib/customizer/v2/zoom";
import { isAdminCroppableLayer, layersForPage, selectableLayersForPage } from "./builder-utils";
import CustomerImageToolbar from "@/app/components/customizer/CustomerImageToolbar";
import { useGoogleFontMetricsRevision } from "@/app/components/customizer/useGoogleFonts";


/** The administrator may use every crop control on the template's own photos. */
/** Top inset that keeps the fitted card clear of the floating selection toolbar. */
const ADMIN_TOOLBAR_CLEARANCE = 66;
const ADMIN_CROP_PERMISSIONS = { cropImage: true, zoomImage: true, repositionImage: true, flipImage: true, rotateImage: true };

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
  onViewportChange,
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
  onLayerContextMenu,
  onCanvasContextMenu,
  onImageTransformCommit,
  onCropChange,
  cropRequest = null,
  eraseRequest = null,
  onEraseChange,
  onEraseCommit,
}: any) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const dragRef = useRef<any>(null);
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
  const textMeasureRef = useRef<MeasureFn | null>(null);
  if (!textMeasureRef.current) textMeasureRef.current = createCanvasMeasure();
  // Wraps the rendered SVG. The interaction layer writes transient gesture
  // transforms onto the layer groups inside it (spec §9).
  const previewRootRef = useRef<HTMLDivElement>(null);
  // Exact in-progress geometry during a resize/rotation — see the customer
  // workspace for the reasoning. Same shared mechanism, same renderer.
  // Live gesture geometry, delivered per layer so a resize or rotation
  // re-renders only the object being changed (spec §19).
  const transientStoreRef = useRef<TransientGeometryStore | null>(null);
  if (!transientStoreRef.current) transientStoreRef.current = createTransientGeometryStore();
  const transientStore = transientStoreRef.current;
  const setTransientGeometry = useCallback(
    (overrides: Record<string, Record<string, unknown>> | null) => transientStore.set(overrides),
    [transientStore],
  );

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
  // The selection toolbar floats over the top of the workspace (12px down,
  // ~46px tall), so the fitted card starts below it and no control ever sits
  // on top of the artwork.
  const basePadding = resolveWorkspacePadding(containerWidth, containerHeight);
  const studioPadding = { ...basePadding, top: Math.max(basePadding.top, ADMIN_TOOLBAR_CLEARANCE) };
  const workspaceFit = computeWorkspaceFit({
    availableWidth: containerWidth,
    availableHeight: containerHeight,
    canvasWidth: canvasW,
    canvasHeight: canvasH,
    padding: studioPadding,
  });
  const fitPadding = workspaceFit?.padding ?? studioPadding;
  // Before the first measurement, fall back to a width-derived guess purely so
  // the very first frame is not zero-sized; it is replaced on the next tick.
  const baseWidth = workspaceFit?.baseWidth ?? Math.max(260, (containerWidth || 520) - 96);
  const displayW = baseWidth * zoom;
  const displayH = displayW * (canvasH / canvasW);
  const scale = displayW / canvasW;


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

  // Re-derived on every render, including every pointermove of a drag. Same
  // cost profile as the customer workspace (spec §30).
  const layers = useMemo(() => layersForPage(template, pageId), [template, pageId]);
  // Small text (compact handles, controls below) is 10 pt or less — in this
  // artboard's own pixels, since stored font sizes are document px.
  const selectionTheme = useMemo(
    () => ({ ...STUDIO_SELECTION_THEME, smallTextMaxFontSize: pointsToDocumentPx(SMALL_TEXT_MAX_POINT_SIZE, documentDpi) }),
    [documentDpi],
  );
  const fontMetricsRevision = useGoogleFontMetricsRevision(
    layers.filter((layer: any) => layer?.type === "text").map((layer: any) => layer.textStyle?.fontFamily),
  );
  useEffect(() => {
    if (fontMetricsRevision > 0) textMeasureRef.current = createCanvasMeasure();
  }, [fontMetricsRevision]);
  const selectableLayers = useMemo(
    () => selectableLayersForPage(template, pageId, editingGroupId),
    [template, pageId, editingGroupId],
  );

  // Auto-width text may grow only up to this page's safe area (the same
  // resolver preflight and the server render use).
  const safeBounds: SafeBounds = pageSafeBounds(template, pageId);

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

  // Read through a ref so the gesture callbacks below keep a stable identity.
  const resolveLayerBoxRef = useRef(resolveLayerBox);
  resolveLayerBoxRef.current = resolveLayerBox;

  // Wrapped so the gesture-commit callback keeps a stable identity: an unstable
  // dependency there would re-render the interaction layer on every render.
  const constrainTextSize = useCallback((layer: any, requestedWidth: number, requestedHeight: number) => {
    if (layer?.type !== "text") return { width: requestedWidth, height: requestedHeight };
    const style = layer.textStyle || {};
    const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
    const text = resolveLayerText(layer, field, values);
    const input = {
      text: String(text),
      width: Math.max(1, requestedWidth),
      height: Math.max(1, requestedHeight),
      fontFamily: style.fontFamily || DEFAULT_FONT_FAMILY,
      fontSize: Number(style.fontSize) || 48,
      minFontSize: Number(style.minFontSize) || undefined,
      fontWeight: style.fontWeight || "400",
      fontStyle: style.fontStyle === "italic" ? "italic" as const : "normal" as const,
      letterSpacing: Number(style.letterSpacing) || 0,
      lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT,
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
  }, [template, values]);

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
      fontFamily: style.fontFamily || DEFAULT_FONT_FAMILY,
      fontSize: Number(style.fontSize) || 48,
      minFontSize: Number(style.minFontSize) || undefined,
      fontWeight: style.fontWeight || "400",
      fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
      letterSpacing: Number(style.letterSpacing) || 0,
      lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT,
      ...resolvedTextLayoutMode(style, Boolean(resolved.autoWidthClamped)),
    }, textMeasureRef.current!);
    return layout.overflowWidth || layout.overflowHeight || layout.truncatedLines;
  };

  /* ----- crop mode: the frame stays put, the photo moves inside it ----- */
  // Double-click a photo to crop. Every pointer move only PREVIEWS (the shared
  // transient store feeds the same draw-box formula the saved render and the
  // print renderer use); Done writes the result once — one undo step — and
  // Cancel or Escape restores exactly what was there before.
  const [crop, setCrop] = useState<{ layerId: string; base: Record<string, any>; patch: Record<string, number | boolean> } | null>(null);
  const cropRef = useRef(crop);
  const cropDragRef = useRef<{ pointerId: number; clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null);
  const [cropDragging, setCropDragging] = useState(false);
  const cropLayer = crop ? layers.find((layer: any) => layer.id === crop.layerId) || null : null;
  const canCropLayer = isAdminCroppableLayer;
  const liveCropTransform = (state = cropRef.current) => (state ? { ...state.base, ...state.patch } : {});
  const updateCrop = (patch: Record<string, number | boolean>) => {
    const current = cropRef.current;
    if (!current) return;
    const next = { ...current, patch: { ...current.patch, ...patch } };
    cropRef.current = next;
    setCrop(next);
    transientStore.set({ [next.layerId]: { imageTransform: liveCropTransform(next) } });
  };
  const finishCrop = (mode: "commit" | "discard") => {
    const current = cropRef.current;
    cropRef.current = null;
    cropDragRef.current = null;
    setCropDragging(false);
    setCrop(null);
    transientStore.set(null);
    if (!current || mode !== "commit" || !Object.keys(current.patch).length) return;
    onImageTransformCommit?.(current.layerId, liveCropTransform(current));
  };
  const finishCropRef = useRef(finishCrop);
  finishCropRef.current = finishCrop;
  // The studio's Crop button and object menu ask for crop through this request;
  // it enters the very same session double-clicking does.
  const beginCropRef = useRef<(layer: any) => void>(() => {});
  const cropRequestRef = useRef(cropRequest);
  cropRequestRef.current = cropRequest;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  // Only a NEW request (a new id) opens crop; re-renders of the same one do not.
  const cropRequestId = cropRequest?.requestId ?? 0;
  useEffect(() => {
    if (!cropRequestId) return;
    const layer = layersRef.current.find((candidate: any) => candidate.id === cropRequestRef.current?.layerId);
    if (layer) beginCropRef.current(layer);
  }, [cropRequestId]);
  const beginCrop = (layer: any) => {
    if (!canCropLayer(layer)) return;
    const next = { layerId: layer.id, base: { ...(layer.imageTransform || {}) }, patch: {} };
    cropRef.current = next;
    setCrop(next);
    onSelectionChange?.([layer.id]);
  };
  beginCropRef.current = beginCrop;
  // Keys while cropping belong to the crop: Enter is Done, Escape is Cancel,
  // arrows nudge the photo, and nothing else may edit the document underneath.
  const onCropKey = (event: KeyboardEvent) => {
    // The crop bar's own fields keep their keys (typing a zoom, Enter to set it).
    if (event.target instanceof Element && event.target.closest("[data-admin-crop-bar]")) return;
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      finishCropRef.current(event.key === "Enter" ? "commit" : "discard");
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key]) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const layer = layers.find((candidate: any) => candidate.id === cropRef.current?.layerId);
      const live = liveCropTransform();
      const step = event.shiftKey ? 10 : 1;
      const delta = cropPanDelta(arrows[event.key][0] * step, arrows[event.key][1] * step, {
        rotation: Number(layer?.rotation) || 0,
        imageRotation: Number(live.rotation) || 0,
        flipX: Boolean(live.flipX),
        flipY: Boolean(live.flipY),
        crop: resolveCropRect(live),
      });
      updateCrop({ offsetX: (Number(live.offsetX) || 0) + delta.x, offsetY: (Number(live.offsetY) || 0) + delta.y });
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace" || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onCropKeyRef = useRef(onCropKey);
  onCropKeyRef.current = onCropKey;
  const cropping = Boolean(crop);
  const croppingId = crop?.layerId ?? null;
  useEffect(() => {
    onCropChange?.(croppingId);
  }, [croppingId, onCropChange]);
  useEffect(() => {
    if (!cropping) return;
    const onKey = (event: KeyboardEvent) => onCropKeyRef.current(event);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cropping]);
  // The photo disappearing underneath (an undo, a page switch) cancels crop;
  // leaving the studio mid-crop keeps the edit, as the customer editor does.
  useEffect(() => {
    if (crop && !cropLayer) finishCropRef.current("discard");
  }, [crop, cropLayer]);
  useEffect(() => {
    const finish = finishCropRef;
    return () => finish.current("commit");
  }, []);
  const onCropPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const live = liveCropTransform();
    cropDragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, offsetX: Number(live.offsetX) || 0, offsetY: Number(live.offsetY) || 0 };
    setCropDragging(true);
  };
  const onCropPointerMove = (event: React.PointerEvent) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !cropLayer) return;
    const live = liveCropTransform();
    const delta = cropPanDelta((event.clientX - drag.clientX) / scale, (event.clientY - drag.clientY) / scale, {
      rotation: Number(cropLayer.rotation) || 0,
      imageRotation: Number(live.rotation) || 0,
      flipX: Boolean(live.flipX),
      flipY: Boolean(live.flipY),
      crop: resolveCropRect(live),
    });
    updateCrop({ offsetX: Math.round(drag.offsetX + delta.x), offsetY: Math.round(drag.offsetY + delta.y) });
  };
  const onCropPointerUp = (event: React.PointerEvent) => {
    if (cropDragRef.current?.pointerId !== event.pointerId) return;
    cropDragRef.current = null;
    setCropDragging(false);
  };
  const onCropWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const current = Number(liveCropTransform().zoom) > 0 ? Number(liveCropTransform().zoom) : 1;
    updateCrop({ zoom: Number(Math.min(8, Math.max(1, current * (event.deltaY < 0 ? 1.06 : 1 / 1.06))).toFixed(3)) });
  };

  /* ----- eraser mode: brush strokes over a photo, applied once ----- */
  // Non-destructive: the strokes become the photo's `eraseMask`, which the
  // browser preview and the print renderer both draw as an SVG mask over the
  // untouched picture. Every stroke only PREVIEWS (transient store); Undo and
  // Redo step through this session; Apply writes the result as ONE document
  // change and Cancel or Escape leaves no trace.
  type EraseSession = { layerId: string; initial: EraseStroke[]; strokes: EraseStroke[]; past: EraseStroke[][]; future: EraseStroke[][] };
  const [erase, setErase] = useState<EraseSession | null>(null);
  const eraseRef = useRef(erase);
  const [brushSize, setBrushSize] = useState(48);
  const eraseStrokeRef = useRef<{ pointerId: number; stroke: EraseStroke } | null>(null);
  const [eraseCursor, setEraseCursor] = useState<{ x: number; y: number } | null>(null);
  const eraseLayer = erase ? layers.find((layer: any) => layer.id === erase.layerId) || null : null;
  const setEraseSession = (next: EraseSession | null) => {
    eraseRef.current = next;
    setErase(next);
  };
  const previewErase = (layerId: string, strokes: EraseStroke[]) =>
    transientStore.set({ [layerId]: { eraseMask: strokes.length ? { strokes } : null } });
  /** Where the photo's picture is drawn — the same formula both renderers use. */
  const erasePicture = (layer: any) => {
    const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
    const image = resolveLayerImage(layer, field, values);
    const draw = resolveImageDrawBoxFromTransform(
      { frameX: layer.x - layer.width / 2, frameY: layer.y - layer.height / 2, frameWidth: layer.width, frameHeight: layer.height },
      { zoom: image?.zoom, offsetX: image?.offsetX, offsetY: image?.offsetY, ...(image?.crop || {}) },
    );
    return { draw, picture: { imageRotation: Number(image?.imageRotation) || 0, flipX: Boolean(image?.flipX), flipY: Boolean(image?.flipY) } };
  };
  const finishErase = (mode: "commit" | "discard") => {
    const current = eraseRef.current;
    eraseStrokeRef.current = null;
    setEraseCursor(null);
    setEraseSession(null);
    transientStore.set(null);
    if (!current || mode !== "commit") return;
    if (JSON.stringify(current.strokes) === JSON.stringify(current.initial)) return;
    onEraseCommit?.(current.layerId, normalizeEraseMask({ strokes: current.strokes }));
  };
  const finishEraseRef = useRef(finishErase);
  finishEraseRef.current = finishErase;
  const stepErase = (direction: "undo" | "redo") => {
    const current = eraseRef.current;
    if (!current) return;
    const from = direction === "undo" ? current.past : current.future;
    if (!from.length) return;
    const target = from[from.length - 1];
    const next: EraseSession = direction === "undo"
      ? { ...current, strokes: target, past: current.past.slice(0, -1), future: [...current.future, current.strokes] }
      : { ...current, strokes: target, future: current.future.slice(0, -1), past: [...current.past, current.strokes] };
    setEraseSession(next);
    previewErase(next.layerId, next.strokes);
  };
  const restoreErase = () => {
    const current = eraseRef.current;
    if (!current || !current.strokes.length) return;
    const next = { ...current, strokes: [], past: [...current.past, current.strokes], future: [] };
    setEraseSession(next);
    previewErase(next.layerId, next.strokes);
  };
  const beginErase = (layer: any) => {
    if (!canCropLayer(layer)) return;
    const existing = normalizeEraseMask(layer.eraseMask)?.strokes || [];
    // A brush about a twelfth of the photo's shorter side is a useful start.
    setBrushSize(Math.round(Math.min(ERASER_BRUSH.maximum, Math.max(ERASER_BRUSH.minimum, Math.min(layer.width, layer.height) / 12))));
    setEraseSession({ layerId: layer.id, initial: existing, strokes: existing, past: [], future: [] });
    onSelectionChange?.([layer.id]);
  };
  const beginEraseRef = useRef(beginErase);
  beginEraseRef.current = beginErase;
  const eraseRequestRef = useRef(eraseRequest);
  eraseRequestRef.current = eraseRequest;
  const eraseRequestId = eraseRequest?.requestId ?? 0;
  useEffect(() => {
    if (!eraseRequestId) return;
    const layer = layersRef.current.find((candidate: any) => candidate.id === eraseRequestRef.current?.layerId);
    if (layer) beginEraseRef.current(layer);
  }, [eraseRequestId]);
  const stepEraseRef = useRef(stepErase);
  stepEraseRef.current = stepErase;
  const erasing = Boolean(erase);
  const erasingId = erase?.layerId ?? null;
  useEffect(() => {
    onEraseChange?.(erasingId);
  }, [erasingId, onEraseChange]);
  // Keys while erasing belong to the eraser: Enter applies, Escape cancels,
  // Ctrl+Z / Ctrl+Y step through the strokes, and nothing else may edit the
  // document underneath.
  useEffect(() => {
    if (!erasing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-admin-eraser-bar]") && event.key !== "Escape" && event.key !== "Enter") return;
      const key = event.key.toLowerCase();
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishEraseRef.current(event.key === "Enter" ? "commit" : "discard");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "y")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        stepEraseRef.current(key === "y" || event.shiftKey ? "redo" : "undo");
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace" || event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [erasing]);
  // The photo disappearing underneath cancels; leaving the studio keeps the strokes.
  useEffect(() => {
    if (erase && !eraseLayer) finishEraseRef.current("discard");
  }, [erase, eraseLayer]);
  useEffect(() => {
    const finish = finishEraseRef;
    return () => finish.current("commit");
  }, []);
  const eraseDocPoint = (event: React.PointerEvent) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale, screenX: event.clientX - rect.left, screenY: event.clientY - rect.top };
  };
  const onErasePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || !eraseLayer || !eraseRef.current) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const point = eraseDocPoint(event);
    if (!point) return;
    const { draw, picture } = erasePicture(eraseLayer);
    if (!(draw.width > 0) || !(draw.height > 0)) return;
    const local = canvasPointToDrawBox(point, eraseLayer, picture, draw);
    const stroke: EraseStroke = { size: brushSize / Math.min(draw.width, draw.height), points: [local.x, local.y] };
    eraseStrokeRef.current = { pointerId: event.pointerId, stroke };
    previewErase(eraseRef.current.layerId, [...eraseRef.current.strokes, stroke]);
  };
  const onErasePointerMove = (event: React.PointerEvent) => {
    const point = eraseDocPoint(event);
    if (point) setEraseCursor({ x: point.screenX, y: point.screenY });
    const active = eraseStrokeRef.current;
    const session = eraseRef.current;
    if (!active || active.pointerId !== event.pointerId || !point || !eraseLayer || !session) return;
    const { draw, picture } = erasePicture(eraseLayer);
    const local = canvasPointToDrawBox(point, eraseLayer, picture, draw);
    const points = active.stroke.points;
    const used = session.strokes.reduce((total, stroke) => total + stroke.points.length / 2, 0) + points.length / 2;
    // Skip sub-pixel moves; stop adding points at the stored limit.
    const lastX = points[points.length - 2];
    const lastY = points[points.length - 1];
    if (Math.hypot((local.x - lastX) * draw.width, (local.y - lastY) * draw.height) < 1.5 || used >= ERASE_LIMITS.maxPoints) return;
    active.stroke = { ...active.stroke, points: [...points, local.x, local.y] };
    previewErase(session.layerId, [...session.strokes, active.stroke]);
  };
  const onErasePointerUp = (event: React.PointerEvent) => {
    const active = eraseStrokeRef.current;
    const session = eraseRef.current;
    if (!active || active.pointerId !== event.pointerId || !session) return;
    eraseStrokeRef.current = null;
    if (session.strokes.length >= ERASE_LIMITS.maxStrokes) {
      previewErase(session.layerId, session.strokes);
      return;
    }
    const next = { ...session, strokes: [...session.strokes, active.stroke], past: [...session.past, session.strokes], future: [] };
    setEraseSession(next);
    previewErase(next.layerId, next.strokes);
  };

  const selectionIds: string[] = selectedLayerIds.length
    ? selectedLayerIds
    : selectedLayerId
      ? [selectedLayerId]
      : [];
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

  /* ---- gesture -> document, through the SHARED interaction layer ---- */

  // Interaction nodes for the shared Konva layer. Admin passes
  // `surface: "admin"`, which is the ONLY difference between the two canvases'
  // interaction behaviour now (spec §40): identical selection semantics,
  // identical transform mathematics, different permissions.
  const interactionNodes = useInteractionNodes({
    surface: "admin",
    layers: selectableLayers,
    allLayers: layers,
    resolveText: useCallback(
      (layer: any) =>
        String(resolveLayerText(layer, layer.fieldId ? getFieldById(template, layer.fieldId) : null, values)),
      [template, values],
    ),
    measure: textMeasureRef.current!,
    safeBounds,
    editingGroupId,
    metricsRevision: fontMetricsRevision,
  });

  useSelectOnPressWhileEditing({
    surfaceRef,
    editingTextId,
    nodes: interactionNodes,
    editingGroupId,
    scale,
    onSelect: (ids) => onSelectionChange?.(ids),
  });

  const handleGestureStart = useCallback(() => {
    // One history entry per gesture (spec §45).
    onBeginChange?.();
  }, [onBeginChange]);

  /**
   * Text keeps its layout constraints on THIS side of the boundary, where the
   * shared text engine lives. The interaction layer deals in rectangles; the
   * minimum width a particular string needs is a typography question.
   */
  const withTextConstraints = useCallback(
    (layerId: string, patch: Record<string, unknown>) => {
      const layer = layers.find((candidate: any) => candidate.id === layerId);
      if (layer?.type !== "text" || (patch.width === undefined && patch.height === undefined)) return patch;
      // A side drag on "safe-width" text chooses a width: fixed from now on.
      const manual = manualWidthStylePatch(layer.textStyle, patch as any, resolveLayerBoxRef.current(layer).width);
      const textStyle = manual ? { ...((patch.textStyle as Record<string, unknown>) || {}), ...manual } : patch.textStyle;
      const effective = manual ? { ...layer, textStyle: { ...(layer.textStyle || {}), ...manual } } : layer;
      const constrained = constrainTextSize(
        effective,
        Number(patch.width ?? layer.width),
        Number(patch.height ?? layer.height),
      );
      return { ...patch, ...(textStyle ? { textStyle } : {}), width: constrained.width, height: constrained.height };
    },
    [layers, constrainTextSize],
  );

  /**
   * Commit normalised Husnalogy geometry for a finished gesture.
   *
   * Every gesture — one object or many, with or without a text-style change —
   * goes through `onLayersChange`, so the whole set lands in ONE document
   * application and therefore one history step (spec §8, §45). The per-layer
   * path remains only for an owner that does not provide the batch handler.
   */
  const commitChanges = useCallback(
    (changes: Array<{ id: string; patch: Record<string, unknown> }>) => {
      if (!changes.length) return;
      if (onLayersChange) {
        const patches: Record<string, unknown> = {};
        for (const change of changes) patches[change.id] = withTextConstraints(change.id, change.patch);
        onLayersChange(patches);
        return;
      }
      for (const change of changes) onLayerChange?.(change.id, withTextConstraints(change.id, change.patch));
    },
    [onLayerChange, onLayersChange, withTextConstraints],
  );

  /**
   * Ruler guides keep a DOM gesture of their own. They are editor chrome rather
   * than design objects — they live outside the document's layer list, never
   * reach the renderer, and are dragged from a thin strip that has no business
   * in the object hit graph.
   */
  const onGuidePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag?.mode !== "guide") return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position =
      drag.axis === "vertical" ? (event.clientX - rect.left) / scale : (event.clientY - rect.top) / scale;
    onGuideChange?.(drag.guideId, {
      position: Math.round(
        Math.max(0, drag.axis === "vertical" ? Math.min(canvasW, position) : Math.min(canvasH, position)),
      ),
    });
  };

  const endGuideDrag = () => {
    dragRef.current = null;
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

  /* --------------------------------------------------------- wheel scroll --
   * The wheel scrolls a zoomed-in artboard (Shift or a sideways swipe for
   * horizontal) through the same pan state as dragging, batched per frame.
   * Ctrl/⌘+wheel — which is also what a trackpad pinch sends — zooms around
   * the pointer instead of zooming the whole browser page. Crop mode keeps
   * its own wheel (it zooms the photo inside its frame).
   */
  const viewportRef = useRef({ zoom, panX, panY, padding: fitPadding });
  viewportRef.current = { zoom, panX, panY, padding: fitPadding };
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (cropRef.current) return;
      const view = viewportRef.current;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const nextZoom = clampZoom(view.zoom * wheelZoomFactor(event.deltaY, event.deltaMode));
        if (Math.abs(nextZoom - view.zoom) < 0.0005) return;
        // The pointer, relative to the centre the page sits at with no pan.
        const rect = element.getBoundingClientRect();
        const pad = view.padding;
        const focal = {
          x: event.clientX - (rect.left + pad.left + (rect.width - pad.left - pad.right) / 2),
          y: event.clientY - (rect.top + pad.top + (rect.height - pad.top - pad.bottom) / 2),
        };
        const base = pendingPanRef.current || { panX: view.panX, panY: view.panY };
        onViewportChangeRef.current?.({ zoom: nextZoom, ...panForZoomAtPoint(base, view.zoom, nextZoom, focal) });
        return;
      }
      const delta = normalizeWheelDelta(event, element.clientHeight);
      const base = pendingPanRef.current || { panX: view.panX, panY: view.panY };
      const next = panFromWheel(base, delta, panBoundsRef.current);
      // Nothing left to scroll that way: let the event go.
      if (next.panX === base.panX && next.panY === base.panY) return;
      event.preventDefault();
      pendingPanRef.current = next;
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushPan);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [flushPan]);

  // Space temporarily switches to Pan from any tool, without changing activeTool.
  // It must never steal a space character from a field or the inline text editor.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      if (editingTextId || isTypingTarget(event.target, event.key) || isTypingTarget(document.activeElement, event.key)) return;
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
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-transparent"
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
      {/* The customer editor's crop toolbar — zoom, image rotation, rotate 90°,
          flips, reset, Cancel, Done — driving this session. Anchored to the
          whole workspace (not the card), where the selection toolbar it
          replaces while cropping sits. Every control only previews; Done
          writes once, Cancel restores. */}
      {crop && cropLayer && (
        // Anchored to BOTH edges of the workspace, then centred: a box anchored
        // at left:50% only gets the space right of its anchor when it sizes
        // itself, which squeezed the bar and hid its last controls (Done).
        // The full-width strip lets clicks through; only the bar takes them.
        <div
          data-admin-crop-bar
          data-density-host
          className="pointer-events-none absolute inset-x-3 top-3 z-50 flex justify-center"
        >
          <div className="pointer-events-auto max-w-full" onPointerDown={(event) => event.stopPropagation()}>
          <CustomerImageToolbar
            layer={{ ...cropLayer, imageTransform: liveCropTransform(crop) }}
            permissions={ADMIN_CROP_PERMISSIONS}
            cropping
            hasImage
            onImagePatch={(patch) => updateCrop(patch as Record<string, number | boolean>)}
            onConfirmCrop={() => finishCrop("commit")}
            onCancelCrop={() => finishCrop("discard")}
            showPositionFields={false}
            fitToWidth
          />
          </div>
        </div>
      )}
      {erase && eraseLayer && (
        <div data-density-host className="pointer-events-none absolute inset-x-3 top-3 z-50 flex justify-center">
          <div className="pointer-events-auto max-w-full" onPointerDown={(event) => event.stopPropagation()}>
          <AdminEraserBar
            brushSize={brushSize}
            canUndo={erase.past.length > 0}
            canRedo={erase.future.length > 0}
            canRestore={erase.strokes.length > 0}
            onBrushSize={(size) => setBrushSize(Math.min(ERASER_BRUSH.maximum, Math.max(ERASER_BRUSH.minimum, size)))}
            onUndo={() => stepErase("undo")}
            onRedo={() => stepErase("redo")}
            onRestore={restoreErase}
            onCancel={() => finishErase("discard")}
            onApply={() => finishErase("commit")}
          />
          </div>
        </div>
      )}
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
        onPointerMove={onGuidePointerMove}
        onPointerUp={endGuideDrag}
        onPointerCancel={endGuideDrag}
        onPointerLeave={(event) => {
          if (!(event.currentTarget as HTMLElement).hasPointerCapture?.(event.pointerId)) endGuideDrag();
        }}
      >
        {/* Base render (shared with the customer) */}
        <div ref={previewRootRef} className="pointer-events-none absolute inset-0">
          <CustomizerPreview template={template} values={values} page={pageId} showSafeArea={showSafeArea} showBleed={showBleed} hiddenLayerIds={[]} transientStore={transientStore} />
        </div>

        {/* Shared Konva interaction layer — the SAME component the customer
            workspace mounts (spec §7, §40). Admin differs only by the
            capabilities it resolves. Ruler guides, the inline text editor and
            the panel chrome stay in the DOM, where they belong. */}
        <InteractionStageClient
          documentWidth={canvasW}
          documentHeight={canvasH}
          scale={scale}
          nodes={interactionNodes}
          selectedIds={selectionIds}
          editingGroupId={editingGroupId}
          textEditingId={editingTextId}
          disabled={panToolActive || isPanning || Boolean(crop) || Boolean(erase)}
          // Studio selection chrome: thin magenta outline, round handles, rotate
          // control below, and the small-text controls.
          selectionTheme={selectionTheme}
          snapping={{
            enabled: snapEnabled,
            safeArea: pageSafeInsets(template, pageId),
            guides: savedGuides,
            pageId,
            neighbours: layers,
          }}
          previewRootRef={previewRootRef}
          onSelectionChange={(ids) => onSelectionChange?.(ids)}
          onGestureStart={handleGestureStart}
          onGestureCommit={commitChanges}
          onTransientGeometry={setTransientGeometry}
          onDoubleClickNode={(layerId) => {
            const layer = selectableLayers.find((candidate: any) => candidate.id === layerId);
            if (!layer) return;
            onSelectionChange?.([layer.id]);
            if (canCropLayer(layer)) beginCrop(layer);
            else if (layer.type === "group") onEnterGroup?.(layer.id);
            else if (layer.type === "text" && !layer.locked && layer.adminEditable !== false) {
              beginTextEditing(layer.id);
            }
          }}
          // Right click: the studio's object menu. An object outside the
          // selection becomes the selection first, exactly as in the customer
          // editor; empty design space clears it and offers Paste here.
          onContextMenuNode={(layerId, position) => {
            if (editingTextId) return;
            if (!selectionIds.includes(layerId)) onSelectionChange?.([layerId]);
            onLayerContextMenu?.(layerId, position);
          }}
          onContextMenuCanvas={(position, point) => {
            if (editingTextId) return;
            onSelectionChange?.([]);
            onCanvasContextMenu?.(position, point);
          }}
        />

        {erase && eraseLayer && (
          <div
            role="application"
            aria-label="Eraser — drag over the photo to erase, Enter to apply, Escape to cancel"
            data-admin-eraser-surface
            onPointerDown={onErasePointerDown}
            onPointerMove={onErasePointerMove}
            onPointerUp={onErasePointerUp}
            onPointerCancel={onErasePointerUp}
            onPointerLeave={() => setEraseCursor(null)}
            className="absolute inset-0 z-40"
            style={{ cursor: "crosshair", touchAction: "none" }}
          >
            {/* The photo being erased, outlined so the target is unmistakable. */}
            <span
              aria-hidden
              className="pointer-events-none absolute"
              style={{
                left: (eraseLayer.x - eraseLayer.width / 2) * scale,
                top: (eraseLayer.y - eraseLayer.height / 2) * scale,
                width: eraseLayer.width * scale,
                height: eraseLayer.height * scale,
                transform: eraseLayer.rotation ? `rotate(${eraseLayer.rotation}deg)` : undefined,
                outline: "2px solid #D4AF37",
                outlineOffset: 2,
              }}
            />
            {eraseCursor && (
              <span
                aria-hidden
                className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(48,56,57,0.6)]"
                style={{
                  left: eraseCursor.x - (brushSize * scale) / 2,
                  top: eraseCursor.y - (brushSize * scale) / 2,
                  width: brushSize * scale,
                  height: brushSize * scale,
                }}
              />
            )}
          </div>
        )}

        {crop && cropLayer && (
          <>
            <div className="pointer-events-none absolute inset-0 z-30 bg-[#303839]/25" aria-hidden />
            <div
              role="application"
              aria-label="Crop photo — drag to reposition, scroll to zoom, Enter for Done, Escape to cancel"
              onPointerDown={onCropPointerDown}
              onPointerMove={onCropPointerMove}
              onPointerUp={onCropPointerUp}
              onPointerCancel={onCropPointerUp}
              onWheel={onCropWheel}
              className="absolute z-40"
              style={{
                // From the real drag state, as every other canvas cursor here.
                cursor: cropDragging ? "grabbing" : "grab",
                left: (cropLayer.x - cropLayer.width / 2) * scale,
                top: (cropLayer.y - cropLayer.height / 2) * scale,
                width: cropLayer.width * scale,
                height: cropLayer.height * scale,
                transform: cropLayer.rotation ? `rotate(${cropLayer.rotation}deg)` : undefined,
                outline: "2px solid #D4AF37",
                outlineOffset: 2,
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
                  <EditableNumericStepper label="Guide position" value={Math.round(guide.position)} minimum={0} maximum={vertical ? canvasW : canvasH} onCommit={(position) => onGuideChange?.(guide.id, { position })} className="h-8 w-28 rounded-md border border-[#303839]/12 bg-white" buttonClassName="grid h-full place-items-center text-[#303839]/55 hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-25" />
                  <button type="button" onClick={() => onGuideChange?.(guide.id, { locked: !guide.locked })} className="h-8 rounded-md px-2 text-[10px] font-bold hover:bg-[#F8F6F1]">{guide.locked ? "Unlock" : "Lock"}</button>
                  <button type="button" onClick={() => onGuideChange?.(guide.id, { deleted: true })} className="h-8 rounded-md px-2 text-[10px] font-bold text-red-700 hover:bg-red-50">Delete</button>
                </div>
              )}
            </div>
          );
        })}

        {/* DOM overlay, now limited to the inline text editor and the
            text-overflow warning. Selection chrome, handles and hit targets
            live on the Konva layer above — one interaction engine, shared with
            the customer canvas (spec §61). */}
        {activeTool !== "pan" && interactionNodes.map((node) => {
          const layer = selectableLayers.find((candidate: any) => candidate.id === node.id);
          if (!layer) return null;
          const isEditing = editingTextId === node.id;
          const showOverflow = selectionIds.includes(node.id) && !isEditing && textOverflowForLayer(layer);
          if (!isEditing && !showOverflow) return null;
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
                    value={String(resolveLayerText(layer, layer.fieldId ? getFieldById(template, layer.fieldId) : null, values))}
                    multiline={Boolean(layer.textStyle?.multiline)}
                    allowMultiline
                    maxLines={Number(layer.maxLines) || 0}
                    maxLength={Number(layer.maxChars) || 0}
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
                <span className="absolute left-0 top-full z-20 mt-2 whitespace-nowrap rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-900 shadow-sm" role="status">
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
