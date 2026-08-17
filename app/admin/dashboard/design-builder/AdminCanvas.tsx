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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import InteractionStageClient from "@/app/components/customizer/interaction/InteractionStageClient";
import { useInteractionNodes } from "@/app/components/customizer/interaction/useInteractionNodes";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import InlineCanvasTextEditor from "@/app/components/customizer/InlineCanvasTextEditor";
import {
  DEFAULT_LINE_HEIGHT,
  createCanvasMeasure,
  getTextResizeConstraints,
  layoutText,
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
import { resolveLayerSelectionGeometry } from "@/lib/customizer/v2/selection-geometry";
import { isEmptyText } from "@/lib/customizer/v2/text-editing";
import { actualSizeZoom, computeWorkspaceFit, resolveWorkspacePadding } from "@/lib/customizer/v2/zoom";
import { layersForPage, selectableLayersForPage } from "./builder-utils";


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
  const selectableLayers = useMemo(
    () => selectableLayersForPage(template, pageId, editingGroupId),
    [template, pageId, editingGroupId],
  );

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
    }, textMeasureRef.current!);
    return layout.overflowWidth || layout.overflowHeight || layout.truncatedLines;
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
    resolveText: useCallback(
      (layer: any) =>
        String(resolveLayerText(layer, layer.fieldId ? getFieldById(template, layer.fieldId) : null, values)),
      [template, values],
    ),
    measure: textMeasureRef.current!,
    safeBounds,
    editingGroupId,
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
      const constrained = constrainTextSize(
        layer,
        Number(patch.width ?? layer.width),
        Number(patch.height ?? layer.height),
      );
      return { ...patch, width: constrained.width, height: constrained.height };
    },
    [layers, constrainTextSize],
  );

  /**
   * Commit normalised Husnalogy geometry for a finished (or in-flight) gesture.
   *
   * A multi-object change goes through `onLayersChange` so the whole set lands
   * in ONE document application — and therefore one history step (spec §45).
   * A change carrying `textStyle` cannot use that path, because the batch
   * handler applies plain layer patches only, so those commit individually.
   */
  const commitChanges = useCallback(
    (changes: Array<{ id: string; patch: Record<string, unknown> }>) => {
      if (!changes.length) return;
      const carriesStyle = changes.some((change) => change.patch.textStyle);
      if (changes.length > 1 && !carriesStyle && onLayersChange) {
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
        onPointerMove={onGuidePointerMove}
        onPointerUp={endGuideDrag}
        onPointerCancel={endGuideDrag}
        onPointerLeave={(event) => {
          if (!(event.currentTarget as HTMLElement).hasPointerCapture?.(event.pointerId)) endGuideDrag();
        }}
      >
        {/* Base render (shared with the customer) */}
        <div ref={previewRootRef} className="pointer-events-none absolute inset-0">
          <CustomizerPreview template={template} values={values} page={pageId} showSafeArea={showSafeArea} showBleed={showBleed} hiddenLayerIds={[]} />
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
          disabled={panToolActive || isPanning}
          snapping={{
            enabled: snapEnabled,
            safeArea: template?.safeArea,
            guides: savedGuides,
            pageId,
            neighbours: layers,
          }}
          previewRootRef={previewRootRef}
          onSelectionChange={(ids) => onSelectionChange?.(ids)}
          onGestureStart={handleGestureStart}
          onGestureCommit={commitChanges}
          onDoubleClickNode={(layerId) => {
            const layer = selectableLayers.find((candidate: any) => candidate.id === layerId);
            if (!layer) return;
            onSelectionChange?.([layer.id]);
            if (layer.type === "group") onEnterGroup?.(layer.id);
            else if (layer.type === "text" && !layer.locked && layer.adminEditable !== false) {
              beginTextEditing(layer.id);
            }
          }}
        />

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
