"use client";

// Admin Design Studio (Sections 18–39). Lives inside the product form: the
// template is form state (onChange), product options are form state too, and
// Save Draft / Publish delegate to the form's existing save pipeline — so
// template versioning, validation, and persistence all keep working.
//
// Collapsed: a launch card with a live summary. Open: a full-screen
// professional editor (fixed overlay, no site chrome).

import { panForZoomChange } from "@/lib/customizer/v2/zoom";
import ToolbarPopover, { ToolbarMenuItem, ToolbarMenuSection } from "./ToolbarPopover";
import { configureAssetRuntime } from "@/app/components/customizer/canvas-image-source";
import { DEFAULT_FONT_FAMILY } from "@/lib/customizer/v2/google-fonts";
import { ensureDesignFontsLoaded, reportGoogleFontLoadFailure } from "@/app/components/customizer/useGoogleFonts";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  validateCustomizerTemplateDetailed,
} from "@/lib/customizer";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import CustomizerZoomControls from "@/app/components/customizer/CustomizerZoomControls";
import { fitViewport, INITIAL_VIEWPORT, isTypingTarget, type ViewportState } from "@/lib/customizer/v2/viewport-pan";
import {
  INITIAL_TOOL_STATE,
  toolReducer,
} from "@/lib/customizer/v2/interaction/tool-mode";
import AdminBuilderHeader from "./AdminBuilderHeader";
import AdminContextToolbar from "./AdminContextToolbar";
import AdminAlignmentPanel from "./AdminAlignmentPanel";
import type { AlignmentTarget } from "@/lib/customizer/v2/admin-toolbar-state";
import AdminToolRail, { type StudioRailItem, type StudioSidePanel } from "./AdminToolRail";
import AdminBackgroundPanel from "./AdminBackgroundPanel";
import AdminTextToolPanel from "./AdminTextToolPanel";
import AdminCanvas from "./AdminCanvas";
import AdminPropertiesPanel from "./AdminPropertiesPanel";
import AdminLayersPanel from "./AdminLayersPanel";
import AdminPagesPanel from "./AdminPagesPanel";
import AdminFieldsPanel from "./AdminFieldsPanel";
import AdminProductOptionsPanel from "./AdminProductOptionsPanel";
import AdminCanvasBar from "./AdminCanvasBar";
import AdminTemplateSettings from "./AdminTemplateSettings";
import AdminCustomerPreview from "./AdminCustomerPreview";
import AdminMockupEditor from "./AdminMockupEditor";
import AdminUploadsPanel, { type AdminUploadAsset } from "./AdminUploadsPanel";
import CustomerElementsPanel, { type LibraryElement } from "@/app/components/customizer/CustomerElementsPanel";
import { createGridSlots } from "@/lib/customizer/v2/grids";
import { evaluateGroupAction, getDescendantIds, groupLayers, ungroupLayers } from "@/lib/customizer/v2/groups";
import { applyClippingMask, findClipMaskPair } from "@/lib/customizer/v2/clipping-mask";
import { artboardOf, changeTemplateOrientation, orientationOf } from "@/lib/customizer/v2/artboard";
import { anchorGrownTextBox, normalizeTextGrowthDirection } from "@/lib/customizer/v2/text-growth";
import { buildCustomerContextMenu, type ContextMenuActionId } from "@/lib/customizer/v2/context-menu";
import {
  clearStudioRecovery,
  readStudioRecovery,
  studioRecoveryDiffers,
  studioRecoveryKey,
  writeStudioRecovery,
  type StudioRecoverySnapshot,
} from "@/lib/customizer/studio-recovery";
import CustomerCanvasContextMenu from "@/app/components/customizer/CustomerCanvasContextMenu";
import {
  DEFAULT_LINE_HEIGHT,
  createCanvasMeasure,
  getTextResizeConstraints,
  isAutoWidthText,
  isSafeWidthText,
  isSingleLineAutoSizeText,
  resolveTextBox,
  templateSafeBounds,
} from "@/lib/customizer/v2/text-layout";
import { resolveLayerSelectionGeometry } from "@/lib/customizer/v2/selection-geometry";
import { resolveSelection, sanitizeSelection, selectionsEqual, type SelectionIntent } from "@/lib/customizer/v2/selection";
import {
  canonicalTextLayerUpdate,
  type TextPlacementPreset,
  alignedEdgeShift,
  becomesMultilineFromAutoWidth,
  widenForTypedLines,
  isMultilineTextStyle,
  multilineTextPatch,
} from "@/lib/customizer/v2/text-editing";
import { getFieldById, resolveLayerText } from "@/app/components/customizer/customizer-utils";
import { formatCustomizerVersion, nextCustomizerVersion, type CustomizerUpdateType } from "@/lib/customizer/public-version";
import {
  asProductSaveResult,
  createRevisionTracker,
  requestTemplatePublication,
  saveThenPublish,
  type RevisionTracker,
} from "@/lib/customizer/studio-save";
import { applyCanvasLayerPatches,
  canvasPatchesChangeTemplate,
  addLayer,
  addPage,
  alignLayers,
  arrangeLayerSelection,
  bringLayerToFront,
  deletePage,
  distributeLayers,
  duplicateLayer,
  duplicatePage,
  getEnabledBuilderPages,
  getLayer,
  copyLayersToClipboard,
  cutLayers,
  pasteLayers,
  type LayerClipboard,
  genId,
  layersForPage,
  linkLayerToField,
  matchLayerSize,
  movePage,
  moveConnectedField,
  moveLayers,
  isAdminCroppableLayer,
  newImageLayer,
  newBackgroundLayer,
  newElementLayer,
  newImageLayerFromAdminAsset,
  newQRCodeLayer,
  newShapeLayer,
  newLibraryShapeLayer,
  newTextLayer,
  patchPage,
  removeLayer,
  renamePage,
  reorderLayerToTarget,
  selectableLayersForPage,
  sendLayerToBack,
  setCustomerEditable,
  unlinkLayerFromField,
  updateConnectedField,
  updateLayer,
  updateLayerStyle,
  scaleLayerSelection,
  flipLayerSelection,
  rotateLayerSelection,
  fitLayerToArtboard,
  setImageFitMode,
  replaceLayerImage,
  uploadBuilderImage,
  type AlignMode,
  type BuilderAsset,
  type LayerArrangeMode,
} from "./builder-utils";

const builderTextMeasure = createCanvasMeasure();

const SIDE_PANEL_TITLES: Record<StudioSidePanel, string> = {
  text: "Add Text",
  uploads: "Uploads",
  background: "Background",
  elements: "Elements",
  icons: "Icons",
  options: "Options",
  moment: "Moment",
  layers: "Layers",
  pages: "Pages",
};

// The studio may fall back to a library asset's full-quality original when its
// editor variant fails; set before any canvas image resolves.
configureAssetRuntime({ audience: "studio" });

/** How long after a change the studio's local recovery copy is written. */
const STUDIO_RECOVERY_DELAY_MS = 400;
/** How long editing must pause before an existing product's draft autosaves. */
const STUDIO_AUTOSAVE_DELAY_MS = 4000;

/** This browser's storage, or null where the browser blocks it (recovery is then unavailable; editing is not). */
function studioStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A recovery time the admin can recognise, e.g. "today at 14:05". */
function formatRecoveryTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an earlier session";
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? `today at ${time}` : `${date.toLocaleDateString()} at ${time}`;
}

/** The Rotate field's value: the selection's common angle, or mixed. */
function sharedRotation(layers: any[]): { value: number; mixed: boolean } {
  const angles = layers.map((layer) => Number(layer?.rotation) || 0);
  const value = angles[0] ?? 0;
  return { value, mixed: angles.some((angle) => Math.abs(angle - value) > 0.005) };
}

function constrainTextLayerBox(template: any, layerId: string): any {
  const layer = getLayer(template, layerId);
  if (!layer || layer.type !== "text") return template;
  const style = layer.textStyle || {};
  if (isSafeWidthText(style)) {
    // The box IS what the renderers resolve (words, capped at the safe area,
    // wrapped below it), stored so the aligned edge and the growth anchor
    // carry over to the next edit.
    const box = resolveTextBox(
      {
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        text: String(layer.text || ""),
        fontFamily: style.fontFamily || DEFAULT_FONT_FAMILY,
        fontSize: Number(style.fontSize) || 48,
        fontWeight: style.fontWeight || "400",
        fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
        letterSpacing: Number(style.letterSpacing) || 0,
        lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT,
        uppercase: Boolean(style.uppercase),
        multiline: Boolean(style.multiline),
        textAlign: style.textAlign || "center",
        verticalAlign: style.verticalAlign || "middle",
        autoSizeMode: style.autoSizeMode,
        fitMode: style.fitMode,
        rotation: Number(layer.rotation) || 0,
        growthDirection: style.growthDirection,
      },
      builderTextMeasure,
      templateSafeBounds(template),
    );
    if (box.width === layer.width && box.height === layer.height && box.x === layer.x && box.y === layer.y) return template;
    return updateLayer(template, layerId, { width: box.width, height: box.height, x: box.x, y: box.y });
  }
  let constraints = getTextResizeConstraints({
    text: String(layer.text || ""),
    width: layer.width,
    height: layer.height,
    fontFamily: style.fontFamily || DEFAULT_FONT_FAMILY,
    fontSize: Number(style.fontSize) || 48,
    minFontSize: Number(style.minFontSize) || undefined,
    fontWeight: style.fontWeight || "400",
    fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
    letterSpacing: Number(style.letterSpacing) || 0,
    lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT,
    multiline: Boolean(style.multiline),
    fitMode: style.fitMode === "shrink" ? "shrink" : style.fitMode === "auto-height" ? "auto-height" : "fixed",
  }, builderTextMeasure);
  const autoSizedSingleLine = isSingleLineAutoSizeText(style, layer.text);
  const width = autoSizedSingleLine ? constraints.requiredWidth : Math.max(layer.width, constraints.minWidth);
  constraints = getTextResizeConstraints({
    text: String(layer.text || ""),
    width,
    height: layer.height,
    fontFamily: style.fontFamily || DEFAULT_FONT_FAMILY,
    fontSize: Number(style.fontSize) || 48,
    minFontSize: Number(style.minFontSize) || undefined,
    fontWeight: style.fontWeight || "400",
    fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
    letterSpacing: Number(style.letterSpacing) || 0,
    lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT,
    multiline: Boolean(style.multiline),
    fitMode: style.fitMode === "shrink" ? "shrink" : style.fitMode === "auto-height" ? "auto-height" : "fixed",
  }, builderTextMeasure);
  const height = autoSizedSingleLine
    ? constraints.requiredHeight
    : style.fitMode === "auto-height"
      ? constraints.requiredHeight
      : Math.max(layer.height, constraints.minHeight);
  const nextHeight = Math.ceil(height);
  const nextWidth = Math.ceil(width);
  // The growth direction decides which edge holds as the height changes, in
  // the box's own rotated frame — the same rule every renderer resolves with.
  const growth = normalizeTextGrowthDirection(style.growthDirection);
  // A one-line box that changes width keeps its aligned edge still.
  const origin = autoSizedSingleLine ? alignedEdgeShift(layer, nextWidth, style.textAlign) : { x: layer.x, y: layer.y };
  const anchored = growth
    ? anchorGrownTextBox({ x: origin.x, y: origin.y, fromHeight: layer.height, toHeight: nextHeight, rotation: layer.rotation, growth })
    : {
        x: origin.x,
        y: style.fitMode === "auto-height" || String(layer.text || "").includes("\n")
          ? origin.y - layer.height / 2 + nextHeight / 2
          : origin.y,
      };
  if (nextWidth === layer.width && nextHeight === layer.height && anchored.x === layer.x && anchored.y === layer.y) return template;
  return updateLayer(template, layerId, { width: nextWidth, height: nextHeight, x: anchored.x, y: anchored.y });
}

export default function AdminDesignBuilder({
  template,
  onChange,
  productName = "Product",
  product = null,
  productOptions = {},
  quantityOptions = [],
  onProductOptionsChange,
  onQuantityOptionsChange,
  onSave,
  productStatus = "draft",
  saving = false,
  errorMessage = "",
}: any) {
  const t = template || {};
  const [studioOpen, setStudioOpen] = useState(false);
  // The canvas INTERACTION mode, owned by the shared tool state machine
  // (spec §44). Insertion tools are one-shot commands and library panels are
  // inspector content, so neither can leave the editor stuck in a mode that
  // keeps creating objects on every canvas click (spec §22).
  //
  // Going through a reducer rather than a bare `useState` is what makes that a
  // guarantee: every insertion dispatches `objectCreated`, and the machine —
  // not six separate call sites each remembering to do it — is what returns the
  // canvas to Select.
  const [toolState, dispatchTool] = useReducer(toolReducer, INITIAL_TOOL_STATE);
  const activeTool: "select" | "pan" = toolState.mode === "pan" ? "pan" : "select";
  /** A one-shot insertion finished: hand the canvas back to Select. */
  const finishInsertion = () => dispatchTool({ type: "objectCreated" });
  /** The side panel beside the tool rail (Add Text, Uploads, Elements, Layers…), or none. */
  const [sidePanel, setSidePanel] = useState<StudioSidePanel | null>(null);
  // The design as the studio opened it: the Background panel's original palette.
  const [openedTemplate] = useState(template);
  /** The Alignment panel (opened from the toolbar) takes the inspector's place while open. */
  const [alignmentOpen, setAlignmentOpen] = useState(false);
  // Choosing another side panel from the tool rail replaces it.
  useEffect(() => {
    setAlignmentOpen(false);
  }, [sidePanel]);
  const [textPlacementPreset, setTextPlacementPreset] = useState<TextPlacementPreset>("text");
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [editTextRequest, setEditTextRequest] = useState<{ layerId: string; requestId: number; created: boolean } | null>(null);
  const [tab, setTab] = useState("design");
  const [croppingLayerId, setCroppingLayerId] = useState<string | null>(null);
  // The Crop button and the object menu ask the canvas to enter its crop
  // session (the same one double-clicking enters): one crop source of truth.
  const [cropRequest, setCropRequest] = useState<{ layerId: string; requestId: number } | null>(null);
  const requestCrop = (layerId: string) => setCropRequest((current) => ({ layerId, requestId: (current?.requestId || 0) + 1 }));
  // The eraser follows the same request pattern; while it runs it owns the top bar.
  const [erasingLayerId, setErasingLayerId] = useState<string | null>(null);
  const [eraseRequest, setEraseRequest] = useState<{ layerId: string; requestId: number } | null>(null);
  const requestErase = (layerId: string) => setEraseRequest((current) => ({ layerId, requestId: (current?.requestId || 0) + 1 }));
  const [activePage, setActivePage] = useState(t.defaultPage || "front");
  // Multi-selection (spec §7): the LAST id is the primary layer (shows
  // handles + drives the properties panel).
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const selectedLayerId = selectedLayerIds[selectedLayerIds.length - 1] || null;
  const setSelectedLayerId = (id: string | null) => setSelectedLayerIds(id ? [id] : []);
  // Editor viewport: zoom + pan travel together so Fit can reset both. This is
  // navigation state only — it never enters the template, never marks the
  // document dirty, and never creates undo history.
  const [viewport, setViewport] = useState<ViewportState>(INITIAL_VIEWPORT);
  const { zoom } = viewport;
  // Zooming keeps the point at the centre of the workspace where it is, so a
  // scrolled view does not jump when the zoom changes.
  const setZoom = (next: number) =>
    setViewport((current) => ({ zoom: next, ...panForZoomChange({ panX: current.panX, panY: current.panY }, current.zoom, next) }));
  const setPan = (pan: { panX: number; panY: number }) => setViewport((current) => ({ ...current, ...pan }));
  // Zoom 1 IS the fitted page: AdminCanvas measures its live workspace box and
  // scales the card so the whole thing fits, so collapsing the tool rail, the
  // layers panel or the inspector simply re-fits at the same 100%.
  //
  // 1:1 stays a separate action — the physical scale of the document at the
  // screen's CSS DPI — which AdminCanvas reports here as a zoom value.
  const [actualSizeZoomValue, setActualSizeZoomValue] = useState<number | null>(null);
  const onCanvasFitZoom = useCallback((next: number) => setActualSizeZoomValue(next), []);
  // Fit returns to the complete card at 100% and recentres, so the page is
  // always recoverable however far it was panned or zoomed.
  const fitToPage = () => setViewport(fitViewport(1));
  const resetViewport = () => setViewport(fitViewport(actualSizeZoomValue ?? 1));
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [publishCheck, setPublishCheck] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [updateType, setUpdateType] = useState<CustomizerUpdateType>("minor");
  const [updateNotes, setUpdateNotes] = useState("");
  const [dirtySinceSave, setDirtySinceSave] = useState(false);

  /* ----- history (deep-cloned snapshots, refs keep handlers stable) ----- */
  const clone = (obj: any) => (typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
  const tRef = useRef(t);
  tRef.current = t;
  const selectedLayerIdsRef = useRef(selectedLayerIds);
  selectedLayerIdsRef.current = selectedLayerIds;
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;
  const editingGroupIdRef = useRef(editingGroupId);
  editingGroupIdRef.current = editingGroupId;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Revision tokens (lib/customizer/studio-save): every document change takes
  // a fresh token; undo/redo and cancelled previews restore an earlier one; a
  // save marks only the token it actually sent as clean.
  const revisionsRef = useRef<RevisionTracker | null>(null);
  if (!revisionsRef.current) revisionsRef.current = createRevisionTracker();
  const revisions = revisionsRef.current;
  type BuilderHistoryEntry = { template: any; selectedLayerIds: string[]; activePage: string; editingGroupId: string | null; revision: number };
  const undoStack = useRef<BuilderHistoryEntry[]>([]);
  const redoStack = useRef<BuilderHistoryEntry[]>([]);
  const activeTextHistoryIdRef = useRef<string | null>(null);
  const activeTextRevisionBeforeRef = useRef(0);
  // Open toolbar interaction (typing in a numeric field, dragging the colour
  // picker): holds the template to restore on Escape, whether the interaction
  // already pushed its single undo entry, and the revision it started from.
  const textStylePreviewRef = useRef<{ baseline: any; snapshotted: boolean; revision: number } | null>(null);
  // A canvas gesture's undo entry, captured at pointer-down but only pushed
  // once the gesture actually changes something (spec §45).
  const pendingGestureEntryRef = useRef<BuilderHistoryEntry | null>(null);
  const [, forceTick] = useState(0);
  const bump = () => forceTick((x) => x + 1);

  const apply = (next: any, restoreRevision?: number) => {
    // A command that changed nothing must not mark the document unsaved.
    if (next === tRef.current && restoreRevision === undefined) return;
    // Several editor callbacks intentionally run in the same input event
    // (promote-to-multiline, then publish the exact textarea value). Keep the
    // canonical ref synchronous so the second write cannot overwrite the first
    // with the previous render's template.
    tRef.current = next;
    if (restoreRevision === undefined) revisions.next();
    else revisions.restore(restoreRevision);
    setDirtySinceSave(revisions.isDirty());
    onChangeRef.current(next);
  };
  const historyEntry = (): BuilderHistoryEntry => ({
    template: clone(tRef.current),
    selectedLayerIds: selectedLayerIdsRef.current.slice(),
    activePage: activePageRef.current,
    editingGroupId: editingGroupIdRef.current,
    revision: revisions.current,
  });
  const pushHistory = (entry: BuilderHistoryEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
    bump();
  };
  const snapshot = () => {
    pendingGestureEntryRef.current = null;
    pushHistory(historyEntry());
  };
  const beginGesture = () => {
    pendingGestureEntryRef.current = historyEntry();
  };
  const flushGestureHistory = () => {
    const entry = pendingGestureEntryRef.current;
    pendingGestureEntryRef.current = null;
    if (entry) pushHistory(entry);
  };
  const commit = (next: any) => {
    // A refused or no-op command returns the same template: no history entry,
    // no unsaved indicator.
    if (next === tRef.current) return;
    snapshot();
    apply(next);
  };
  const undo = () => {
    if (!undoStack.current.length) return;
    redoStack.current.push(historyEntry());
    const entry = undoStack.current.pop()!;
    apply(entry.template, entry.revision);
    setActivePage(entry.activePage);
    setEditingGroupId(entry.editingGroupId);
    setSelectedLayerIds(entry.selectedLayerIds);
    bump();
  };
  const redo = () => {
    if (!redoStack.current.length) return;
    undoStack.current.push(historyEntry());
    const entry = redoStack.current.pop()!;
    apply(entry.template, entry.revision);
    setActivePage(entry.activePage);
    setEditingGroupId(entry.editingGroupId);
    setSelectedLayerIds(entry.selectedLayerIds);
    bump();
  };
  /**
   * THE Delete — keyboard, toolbar menu, right-click menu and the layers panel
   * all end here. Locked layers (and anything marked non-editable) are kept,
   * the same rule Cut follows, so no route can remove a locked object.
   */
  const deleteSelectedLayers = (layerIds: string[] = selectedLayerIds) => {
    const ids = [...new Set(layerIds.filter(Boolean))].filter((id) => {
      const layer = getLayer(tRef.current, id);
      return layer && !layer.locked && layer.adminEditable !== false;
    });
    if (!ids.length) return;
    let next = tRef.current;
    for (const id of ids) next = removeLayer(next, id);
    commit(next);
    setEditingGroupId(null);
    setSelectedLayerIds([]);
  };

  /* ----- keyboard (only while the studio is open) ----- */
  useEffect(() => {
    if (!studioOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Same shared typing rule as the customer editor (spec §33).
      const typing = isTypingTarget(e.target, e.key) || isTypingTarget(document.activeElement, e.key);
      const k = String(e.key).toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !typing) {
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (k === "y" || (k === "z" && e.shiftKey)) {
          e.preventDefault();
          redo();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && !typing && tab === "design") {
        if (k === "a") {
          e.preventDefault();
          selectAllOnPage();
          return;
        }
        if (k === "d" && selectedLayerIds.length) {
          e.preventDefault();
          duplicateSelectedLayers();
          return;
        }
        // Copy / Cut / Paste. `typing` is already excluded by the enclosing
        // guard, so these never fire while a text field or the inline canvas
        // editor has focus.
        if (k === "c" && selectedLayerIds.length) {
          e.preventDefault();
          copySelectedLayers();
          return;
        }
        if (k === "x" && selectedLayerIds.length) {
          e.preventDefault();
          cutSelectedLayers();
          return;
        }
        if (k === "v") {
          e.preventDefault();
          pasteClipboardLayers();
          return;
        }
        // Ctrl/Cmd+G groups, Ctrl/Cmd+Shift+G ungroups. Both are preventDefault-ed
        // so the browser's own find-again binding never fires.
        if (k === "g") {
          e.preventDefault();
          if (e.shiftKey) ungroupSelectedLayer();
          else groupSelectedLayers();
          return;
        }
      }
      if (typing || tab !== "design") return;
      if (e.key === "Escape" && activeTool !== "select") {
        e.preventDefault();
        dispatchTool({ type: "escape" });
        return;
      }
      if (e.key === "Escape" && editingGroupIdRef.current) {
        e.preventDefault();
        exitAdminGroup();
        return;
      }
      if (e.key === "Escape" && selectedLayerIdsRef.current.length) {
        e.preventDefault();
        setSelectedLayerIds([]);
        return;
      }
      // Enter opens group editing mode, matching the double-click route.
      if (e.key === "Enter" && selectedLayerIds.length === 1) {
        const only = getLayer(tRef.current, selectedLayerIds[0]);
        if (only?.type === "group") {
          e.preventDefault();
          enterAdminGroup(only.id);
          return;
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedLayerIds.length) {
        e.preventDefault();
        deleteSelectedLayers();
        return;
      }
      const movableIds = selectedLayerIds.filter((id) => {
        const layer = getLayer(tRef.current, id);
        return layer && !layer.locked && layer.adminEditable !== false;
      });
      if (!movableIds.length || movableIds.length !== selectedLayerIds.length) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const amount = e.shiftKey ? 40 : 8;
        const dx = e.key === "ArrowLeft" ? -amount : e.key === "ArrowRight" ? amount : 0;
        const dy = e.key === "ArrowUp" ? -amount : e.key === "ArrowDown" ? amount : 0;
        commit(moveLayers(tRef.current, movableIds, dx, dy));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioOpen, tab, selectedLayerId, selectedLayerIds, activePage, activeTool]);

  // Front and Back are independent selection scopes. Any route into another
  // page (page list, field jump, add/duplicate page) drops stale-side ids.
  useEffect(() => {
    const editingGroup = editingGroupId ? getLayer(tRef.current, editingGroupId) : null;
    const scope = editingGroup?.page === activePage ? editingGroupId : null;
    if (editingGroupId && !scope) setEditingGroupId(null);
    const selectable = new Set<string>(selectableLayersForPage(tRef.current, activePage, scope).map((layer: any) => layer.id));
    setSelectedLayerIds((current) => {
      const next = sanitizeSelection(current, selectable);
      return selectionsEqual(next, current) ? current : next;
    });
  }, [activePage, editingGroupId, t.layers]);

  // Lock page scroll while the studio overlay is open.
  useEffect(() => {
    if (!studioOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [studioOpen]);

  // Load exactly the Google Font faces this template's text uses, so the admin
  // canvas measures and draws with real metrics rather than a fallback that
  // then reflows (spec §14). Never the whole catalog.
  const templateFontKey = (t.layers || [])
    .filter((layer: any) => layer?.type === "text")
    .map((layer: any) => `${layer.textStyle?.fontFamily}|${layer.textStyle?.fontWeight}|${layer.textStyle?.fontStyle}`)
    .sort()
    .join(",");
  useEffect(() => {
    const styles = (tRef.current.layers || [])
      .filter((layer: any) => layer?.type === "text")
      .map((layer: any) => layer.textStyle || {});
    if (styles.length) void ensureDesignFontsLoaded(styles).catch(reportGoogleFontLoadFailure);
  }, [templateFontKey]);

  const settings = t.settings || {};
  const enabledPages = getEnabledBuilderPages(t);
  const layerCount = (t.layers || []).length;
  const fieldCount = (t.fields || []).length;
  const validation = validateCustomizerTemplateDetailed(t);

  /* ----- tool actions ----- */
  // Every insertion tool follows the same contract: create exactly one object,
  // select it, and leave the editor in Select mode (spec §12, §35).
  const insertTextLayer = (preset: TextPlacementPreset = textPlacementPreset) => {
    const current = tRef.current;
    const layer = newTextLayer(current, activePageRef.current, {
      x: Math.round(Number(current?.canvasWidthPx || 1500) / 2),
      y: Math.round(Number(current?.canvasHeightPx || 2100) / 2),
      text: "",
      preset,
    });
    activeTextRevisionBeforeRef.current = revisions.current;
    snapshot();
    apply(addLayer(current, layer));
    activeTextHistoryIdRef.current = layer.id;
    setSelectedLayerIds([layer.id]);
    finishInsertion();
    // The canvas owns the inline editor, so the new object is handed to it for
    // immediate typing. Leaving it empty discards it again.
    setEditTextRequest((request) => ({ layerId: layer.id, requestId: (request?.requestId || 0) + 1, created: true }));
    return layer.id;
  };
  const addText = () => {
    setSidePanel("text");
    insertTextLayer();
  };
  const addPhotoArea = () => {
    const layer = newImageLayer(t, activePage);
    let next = addLayer(t, layer);
    // A Photo Area is customer-replaceable by definition — connect its field.
    next = setCustomerEditable(next, layer.id, true);
    commit(next);
    setSelectedLayerId(layer.id);
    finishInsertion();
  };
  /** A native shape kind ("circle") or a Shapes-library id ("heart"): one commit, selected. */
  const addShape = (shape: string) => {
    const layer: any = newLibraryShapeLayer(t, activePage, shape);
    if (shape === "rounded-rectangle") layer.borderRadius = 48;
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
    finishInsertion();
  };
  const addLine = () => addShape("line");
  /** A line in one of the library's styles (solid, dashed, dotted). */
  const addLineStyle = (lineStyle: string) => {
    const layer = { ...newShapeLayer(tRef.current, activePage, "line"), lineStyle: ["dashed", "dotted"].includes(lineStyle) ? lineStyle : "solid" };
    commit(addLayer(tRef.current, layer));
    setSelectedLayerId(layer.id);
    finishInsertion();
  };
  /** A customer photo frame with one of the library's mask outlines. */
  const addFrameWithMask = (maskShape: string) => {
    const layer = { ...newImageLayer(tRef.current, activePage), maskShape };
    const next = setCustomerEditable(addLayer(tRef.current, layer), layer.id, true);
    commit(next);
    setSelectedLayerId(layer.id);
    finishInsertion();
  };
  /** Ready-made wording from the Elements panel: a real, editable text object. */
  const insertPresetText = (text: string, preset: TextPlacementPreset) => {
    const current = tRef.current;
    const layer = newTextLayer(current, activePageRef.current, {
      x: Math.round(Number(current?.canvasWidthPx || 1500) / 2),
      y: Math.round(Number(current?.canvasHeightPx || 2100) / 2),
      text,
      preset,
    });
    commit(constrainTextLayerBox(addLayer(current, layer), layer.id));
    setSelectedLayerIds([layer.id]);
    finishInsertion();
  };
  /**
   * The tool rail. Edit is the resting select tool and closes any side panel;
   * Add Text adds a text object (the existing text tool) and opens its presets;
   * every other item toggles its side panel.
   */
  const onRailSelect = (item: StudioRailItem) => {
    if (item === "edit") {
      dispatchTool({ type: "escape" });
      setSidePanel(null);
      return;
    }
    if (item === "text") {
      if (sidePanel === "text") setSidePanel(null);
      else addText();
      return;
    }
    setSidePanel((current) => (current === item ? null : item));
  };
  const addQRCode = () => {
    const layer = newQRCodeLayer(t, activePage);
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
    finishInsertion();
  };
  const addElement = (element: LibraryElement) => {
    const layer = newElementLayer(tRef.current, activePage, element);
    commit(addLayer(tRef.current, layer));
    setSelectedLayerId(layer.id);
    finishInsertion();
  };
  const addBackground = () => {
    const existing = layersForPage(tRef.current, activePage).find((layer: any) => layer.type === "background");
    if (existing) {
      setSelectedLayerId(existing.id);
    } else {
      const layer = newBackgroundLayer(tRef.current, activePage);
      commit(addLayer(tRef.current, layer));
      setSelectedLayerId(layer.id);
    }
    finishInsertion();
  };
  const addGuide = (axis: "horizontal" | "vertical") => {
    const guide = {
      id: genId("guide"),
      pageId: activePage,
      axis,
      position: axis === "horizontal" ? Number(t.canvasHeightPx || 2100) / 2 : Number(t.canvasWidthPx || 1500) / 2,
      locked: false,
      hidden: false,
      customerVisible: false,
    };
    commit({ ...tRef.current, guides: [...(tRef.current.guides || []), guide] });
  };
  const addImageFromAdminAsset = (asset: AdminUploadAsset) => {
    const currentTemplate = tRef.current;
    const layer = newImageLayerFromAdminAsset(currentTemplate, activePage, asset);
    commit(addLayer(currentTemplate, layer));
    setSelectedLayerId(layer.id);
  };

  /* ----- layer + field + permission actions ----- */
  const onLayerPatch = (id: string, patch: any) => {
    const current = getLayer(tRef.current, id);
    if (current?.type === "grid" && (patch.columns !== undefined || patch.rows !== undefined)) {
      const columns = Number(patch.columns ?? current.columns ?? 2);
      const rows = Number(patch.rows ?? current.rows ?? 2);
      const slots = createGridSlots(columns, rows).map((slot, index) => {
        const previous = current.slots?.[index];
        if (!previous) return slot;
        return {
          ...slot,
          assetId: previous.assetId || "",
          src: previous.src || "",
          bucket: previous.bucket,
          path: previous.path,
          transform: previous.transform || slot.transform,
          permissions: previous.permissions || {},
          required: Boolean(previous.required),
          mask: previous.mask || slot.mask,
          metadata: previous.metadata || {},
        };
      });
      patch = { ...patch, columns, rows, slots };
    }
    if (current?.type === "text" && patch.text !== undefined) {
      patch = {
        ...patch,
        ...canonicalTextLayerUpdate(patch.text, {
          ...(current.textStyle || {}),
          ...(patch.textStyle || {}),
        }),
      };
      // A line break in one-line auto-width text wraps at the widest line.
      if (becomesMultilineFromAutoWidth(current.textStyle, current.text, patch.text)) {
        patch = { ...patch, ...widenForTypedLines({ ...current, textStyle: patch.textStyle }, patch.text, builderTextMeasure, Number(tRef.current?.canvasWidthPx) || undefined) };
      }
    }
    const next = constrainTextLayerBox(updateLayer(tRef.current, id, patch), id);
    if (activeTextHistoryIdRef.current === id) apply(next);
    else commit(next);
  };
  const onStylePatch = (id: string, patch: any) => {
    const next = constrainTextLayerBox(updateLayerStyle(tRef.current, id, patch), id);
    if (activeTextHistoryIdRef.current === id) apply(next);
    else commit(next);
  };
  const onFieldPatch = (id: string, patch: any) => commit(updateConnectedField(tRef.current, id, patch));
  const onFieldReorder = (id: string, direction: "up" | "down") => commit(moveConnectedField(tRef.current, id, direction));
  const onLinkField = (id: string, targetFieldId: string) => commit(linkLayerToField(tRef.current, id, targetFieldId));
  const onUnlinkField = (id: string) => commit(unlinkLayerFromField(tRef.current, id));
  const onToggleCustomerEditable = (id: string, v: boolean) => commit(setCustomerEditable(tRef.current, id, v));
  // Layers-panel row actions: the same Duplicate and Delete as every other route.
  const onDuplicate = (id: string) => duplicateSelectedLayers([id]);
  const onRemove = (id: string) => deleteSelectedLayers([id]);
  /**
   * Drag reorder from the Layers panel. `reorderLayerToTarget` returns the
   * template unchanged when the drop is refused, so a rejected drag takes no
   * history snapshot and wakes no autosave.
   */
  const onReorderToTarget = (sourceId: string, targetId: string) => {
    const next = reorderLayerToTarget(t, sourceId, targetId);
    if (next === t) return;
    commit(next);
  };
  const onCanvasLayerChange = (id: string, patch: any) => {
    if (!canvasPatchesChangeTemplate(tRef.current, { [id]: patch })) return;
    const { textStyle, ...layerPatch } = patch || {};
    let next = Object.keys(layerPatch).length ? updateLayer(tRef.current, id, layerPatch) : tRef.current;
    if (textStyle && typeof textStyle === "object") next = updateLayerStyle(next, id, textStyle);
    flushGestureHistory();
    apply(next);
  };
  /** The text objects that became multi-line from auto width in the current editing session. */
  const typedLineWidthRef = useRef(new Set<string>());
  /** Patches an edit's text in, widening a box that a line break just turned into a paragraph. */
  const withTypedText = (template: any, id: string, update: { text: string; textStyle: Record<string, any> }) => {
    const current = getLayer(template, id);
    if (current && becomesMultilineFromAutoWidth(current.textStyle, current.text, update.text)) typedLineWidthRef.current.add(id);
    let next = updateLayer(template, id, update);
    if (typedLineWidthRef.current.has(id)) {
      next = updateLayer(next, id, widenForTypedLines(getLayer(next, id), update.text, builderTextMeasure, Number(next?.canvasWidthPx) || undefined));
    }
    return constrainTextLayerBox(next, id);
  };
  const onCanvasTextEditStart = (id: string) => {
    typedLineWidthRef.current.clear();
    if (activeTextHistoryIdRef.current === id) return;
    activeTextRevisionBeforeRef.current = revisions.current;
    snapshot();
    activeTextHistoryIdRef.current = id;
  };
  const onCanvasTextDraftChange = (id: string, text: string) => {
    const current = getLayer(tRef.current, id);
    if (!current || current.type !== "text") return;
    const update = canonicalTextLayerUpdate(text, current.textStyle);
    if (
      String(current.text || "") === update.text &&
      current.textStyle?.multiline === update.textStyle.multiline &&
      current.textStyle?.autoSizeMode === update.textStyle.autoSizeMode &&
      current.textStyle?.fitMode === update.textStyle.fitMode
    ) return;
    apply(withTypedText(tRef.current, id, update));
  };
  const onCanvasTextMultilineActivate = (id: string) => {
    const current = getLayer(tRef.current, id);
    if (!current || current.type !== "text") return;
    const style = current.textStyle || {};
    if (isAutoWidthText(style)) typedLineWidthRef.current.add(id);
    if (isMultilineTextStyle(style)) return;
    apply(constrainTextLayerBox(updateLayerStyle(tRef.current, id, multilineTextPatch(style)), id));
  };
  const onCanvasTextCommit = (id: string, text: string) => {
    const current = getLayer(tRef.current, id);
    if (current?.type === "text") {
      const update = canonicalTextLayerUpdate(text, current.textStyle);
      if (
        String(current.text || "") === update.text &&
        current.textStyle?.multiline === update.textStyle.multiline &&
        current.textStyle?.autoSizeMode === update.textStyle.autoSizeMode &&
        current.textStyle?.fitMode === update.textStyle.fitMode
      ) {
        if (activeTextHistoryIdRef.current === id) activeTextHistoryIdRef.current = null;
        return;
      }
      const next = withTypedText(tRef.current, id, update);
      if (activeTextHistoryIdRef.current === id) apply(next);
      else commit(next);
    }
    typedLineWidthRef.current.delete(id);
    if (activeTextHistoryIdRef.current === id) activeTextHistoryIdRef.current = null;
  };
  const onCanvasTextCancel = (
    id: string,
    initial: {
      text: string;
      textStyle: Record<string, any>;
      x: number;
      y: number;
      width: number;
      height: number;
    },
  ) => {
    const current = getLayer(tRef.current, id);
    if (current) {
      const restored = updateLayer(tRef.current, id, {
        text: initial.text,
        textStyle: { ...initial.textStyle },
        x: initial.x,
        y: initial.y,
        width: initial.width,
        height: initial.height,
      });
      apply(restored);
    }
    if (activeTextHistoryIdRef.current === id) {
      undoStack.current.pop();
      redoStack.current = [];
      activeTextHistoryIdRef.current = null;
      // The document is back to the revision the session started from.
      revisions.restore(activeTextRevisionBeforeRef.current);
      setDirtySinceSave(revisions.isDirty());
      bump();
    }
  };
  const onCanvasTextDiscard = (id: string) => {
    if (activeTextHistoryIdRef.current !== id) return;
    apply(removeLayer(tRef.current, id));
    undoStack.current.pop();
    redoStack.current = [];
    activeTextHistoryIdRef.current = null;
    revisions.restore(activeTextRevisionBeforeRef.current);
    setDirtySinceSave(revisions.isDirty());
    setSelectedLayerIds([]);
    bump();
  };
  /**
   * One canvas gesture, however many objects it touched, is ONE document
   * application — one history step and one dirty transition. Text corner
   * scaling carries `textStyle`, which is folded into the same template value
   * rather than sent through a second, separate write.
   */
  const onCanvasLayersChange = (patches: Record<string, any>) => {
    // A gesture that ends where it started changes nothing: no undo step, no
    // unsaved indicator.
    if (!canvasPatchesChangeTemplate(tRef.current, patches)) return;
    flushGestureHistory();
    apply(applyCanvasLayerPatches(tRef.current, patches));
  };

  /* ----- selection + alignment commands (spec §2–§8) ----- */
  // One entry point for every non-canvas selection source (layers panel, field
  // jumps). It shares the canvas's semantics through lib/customizer/v2/selection
  // so a click in the panel and a click on the card can never diverge.
  const onCanvasSelect = (id: string | null, intent: SelectionIntent = "replace") => {
    if (!id) {
      setSelectedLayerIds([]);
      return;
    }
    const target = getLayer(tRef.current, id);
    if (editingGroupIdRef.current && String(target?.groupId || "") !== editingGroupIdRef.current) {
      setEditingGroupId(null);
    }
    setSelectedLayerIds((current) => resolveSelection(current, id, intent));
  };

  /**
   * Canvas selection (click, marquee, empty canvas). Anything outside the
   * entered group leaves the group first; otherwise the scope filter below
   * strips the new selection back out and the click selects nothing.
   */
  const onCanvasSelectionChange = (ids: string[]) => {
    const groupId = editingGroupIdRef.current;
    if (groupId) {
      const members = new Set(getDescendantIds(tRef.current.layers || [], groupId));
      if (!ids.length || ids.some((id) => !members.has(id))) setEditingGroupId(null);
    }
    setSelectedLayerIds(ids);
  };

  const selectAllOnPage = () => {
    setEditingGroupId(null);
    setSelectedLayerIds(selectableLayersForPage(tRef.current, activePage).map((layer: any) => layer.id));
  };

  const enterAdminGroup = (groupId: string) => {
    const group = getLayer(tRef.current, groupId);
    if (!group || group.type !== "group") return;
    const children = selectableLayersForPage(tRef.current, activePage, groupId);
    setEditingGroupId(groupId);
    setSelectedLayerIds(children.length ? [children[0].id] : []);
  };

  const exitAdminGroup = (selectGroup = true) => {
    const groupId = editingGroupIdRef.current;
    if (!groupId) return;
    setEditingGroupId(null);
    if (selectGroup) setSelectedLayerIds([groupId]);
  };

  const canTransformSelection = (ids = selectedLayerIds) =>
    ids.length > 0 &&
    ids.every((id) => {
      const layer = getLayer(tRef.current, id);
      return Boolean(layer && !layer.locked && layer.adminEditable !== false);
    });

  const resolvedGeometryForSelection = (ids = selectedLayerIds) => {
    const current = tRef.current;
    const canvasWidth = Number(current?.canvasWidthPx) || 1500;
    const canvasHeight = Number(current?.canvasHeightPx) || 2100;
    const safeBounds = {
      left: Number(current?.safeArea?.left) || 0,
      top: Number(current?.safeArea?.top) || 0,
      right: canvasWidth - (Number(current?.safeArea?.right) || 0),
      bottom: canvasHeight - (Number(current?.safeArea?.bottom) || 0),
    };
    return ids.map((id) => getLayer(current, id)).filter(Boolean).map((layer: any) => {
      const field = layer.fieldId ? getFieldById(current, layer.fieldId) : null;
      return resolveLayerSelectionGeometry(layer, {
        text: String(resolveLayerText(layer, field, {})),
        measure: builderTextMeasure,
        safeBounds,
      });
    });
  };

  /*
   * Selection commands — THE implementation behind the toolbar, the Alignment
   * panel and the object menu. Each is one pure template change committed once:
   * one undo step, one autosave. Geometry is the rotation-aware geometry the
   * canvas shows (auto-sized text included), not the stored boxes.
   */
  // One object aligns to the artboard; several align to their combined bounds
  // (Selection) or each to the artboard (Artboard).
  const runAlign = (mode: AlignMode, target?: AlignmentTarget) => {
    if (!canTransformSelection() || selectedLayerIds.length < 1) return;
    commit(alignLayers(tRef.current, selectedLayerIds, mode, resolvedGeometryForSelection(), target));
  };
  const runDistribute = (axis: "horizontal" | "vertical", target: AlignmentTarget = "selection") => {
    if (selectedLayerIds.length < (target === "artboard" ? 2 : 3) || !canTransformSelection()) return;
    commit(distributeLayers(tRef.current, selectedLayerIds, axis, "spacing", resolvedGeometryForSelection(), target));
  };
  /** Every selected object takes the first-selected object's width, height or both — one undo step. */
  const runMatchSize = (dimension: "width" | "height" | "both") => {
    if (selectedLayerIds.length < 2 || !canTransformSelection()) return;
    commitSelectionTransform(matchLayerSize(tRef.current, selectedLayerIds, dimension));
  };
  /** Commit a transformed selection, re-fitting every text box inside it to its (possibly resized) type. */
  const commitSelectionTransform = (next: any) => {
    if (next === tRef.current) return;
    let fitted = next;
    for (const id of selectedLayerIds) {
      for (const member of [id, ...getDescendantIds(fitted.layers || [], id)]) fitted = constrainTextLayerBox(fitted, member);
    }
    commit(fitted);
  };
  const runScale = (factor: number) => {
    if (!selectedLayerIds.length || !canTransformSelection()) return;
    commitSelectionTransform(scaleLayerSelection(tRef.current, selectedLayerIds, factor, resolvedGeometryForSelection()));
  };
  const runFlip = (axis: "horizontal" | "vertical") => {
    if (!selectedLayerIds.length || !canTransformSelection()) return;
    commitSelectionTransform(flipLayerSelection(tRef.current, selectedLayerIds, axis, resolvedGeometryForSelection()));
  };
  const runRotateBy = (degrees: number) => {
    if (!selectedLayerIds.length || !canTransformSelection()) return;
    commitSelectionTransform(rotateLayerSelection(tRef.current, selectedLayerIds, degrees, resolvedGeometryForSelection()));
  };
  /** Fit / Fill: a photo frames its picture inside its own box; anything else sizes itself to the artboard. */
  const runFit = (mode: "fit" | "fill") => {
    if (selectedLayerIds.length !== 1 || !canTransformSelection()) return;
    const [id] = selectedLayerIds;
    const layer = getLayer(tRef.current, id);
    if (!layer) return;
    const isPhoto = layer.type === "image" || layer.type === "frame";
    commitSelectionTransform(isPhoto ? setImageFitMode(tRef.current, id, mode) : fitLayerToArtboard(tRef.current, id, mode, resolvedGeometryForSelection()));
  };
  /** One replace for every route (toolbar Change image, inspector Replace): one commit, mask and frame kept. */
  const replaceImageOnLayer = (id: string, asset: BuilderAsset) => {
    const next = replaceLayerImage(tRef.current, id, asset);
    if (next !== tRef.current) commit(next);
  };
  const changeSelectedImage = async (file: File) => {
    // The layer is fixed when the picture is chosen, not when the upload ends.
    const id = selectedLayerIdsRef.current[0];
    const layer = id ? getLayer(tRef.current, id) : null;
    if (!layer) return;
    const asset = await uploadBuilderImage(file, layer.type === "frame" ? "frame" : "image");
    if (!asset.url) throw new Error("Upload failed.");
    replaceImageOnLayer(id, asset);
  };
  // One shared verdict for the toolbar, the Layout menu and Ctrl+G, so a
  // disabled button and a dead shortcut can never disagree.
  const groupActionState = (ids = selectedLayerIds) =>
    evaluateGroupAction(tRef.current.layers || [], ids, {
      blockedReason: (layer: any) =>
        layer.adminEditable === false ? `"${layer.name || "An object"}" is not editable in the builder.` : null,
    });

  const groupSelectedLayers = () => {
    if (!groupActionState().group.enabled) return;
    const ids = selectedLayerIds.slice();
    const groupId = genId("group");
    const layers = groupLayers(tRef.current.layers || [], ids, groupId, "Group");
    if (layers === tRef.current.layers) return;
    // One commit for the whole operation: one undo entry, one autosave.
    commit({ ...tRef.current, layers });
    setEditingGroupId(null);
    setSelectedLayerIds([groupId]);
  };
  const ungroupSelectedLayer = () => {
    if (!groupActionState().ungroup.enabled) return;
    const group = getLayer(tRef.current, selectedLayerIds[0]);
    if (!group || group.type !== "group") return;
    // Read the children from the document rather than the container's childIds
    // so a stale list can never orphan a layer out of the selection.
    const childIds = (tRef.current.layers || [])
      .filter((layer: any) => layer.groupId === group.id)
      .map((layer: any) => layer.id);
    const layers = ungroupLayers(tRef.current.layers || [], group.id);
    if (layers === tRef.current.layers) return;
    commit({ ...tRef.current, layers });
    setEditingGroupId(null);
    setSelectedLayerIds(childIds);
  };
  const duplicateSelectedLayers = (layerIds: string[] = selectedLayerIds) => {
    if (!layerIds.length) return;
    let next = tRef.current;
    const newIds: string[] = [];
    for (const id of layerIds) {
      const result = duplicateLayer(next, id);
      next = result.template;
      if (result.newId) newIds.push(result.newId);
    }
    if (!newIds.length) return;
    commit(next);
    setSelectedLayerIds(newIds);
  };
  /**
   * Admin clipboard (spec §32).
   *
   * Shares `cloneLayersInto` with Duplicate and, through
   * `lib/customizer/v2/clipboard`, with the customer editor — so "what does a
   * copy of a group mean" is answered once. The clipboard holds the whole
   * SUBTREE plus the ids that were actually selected: a group container without
   * its members could only ever paste as an empty group.
   *
   * Each command is a single `commit`, which is what makes a cut-and-paste pair
   * two clean undo steps rather than a scattering of partial ones.
   */
  const clipboardRef = useRef<LayerClipboard>({ rootIds: [], layers: [] });

  const copySelectedLayers = () => {
    if (!selectedLayerIds.length) return;
    clipboardRef.current = copyLayersToClipboard(tRef.current, selectedLayerIds);
  };

  const cutSelectedLayers = () => {
    if (!selectedLayerIds.length) return;
    const { template: next, clipboard, removedIds } = cutLayers(tRef.current, selectedLayerIds);
    clipboardRef.current = clipboard;
    // A selection of nothing but locked layers copies but removes nothing, so
    // there is no document change to record.
    if (!removedIds.length) return;
    commit(next);
    setEditingGroupId(null);
    setSelectedLayerIds([]);
  };

  const pasteClipboardLayers = (at?: { x: number; y: number }) => {
    const before = new Set((tRef.current.layers || []).map((layer: any) => layer.id));
    const pasted = pasteLayers(tRef.current, clipboardRef.current, activePage);
    const newIds = pasted.newIds;
    if (!newIds.length) return;
    let next = pasted.template;
    if (at) {
      // "Paste here": centre the pasted selection on the pointer. Every new
      // layer (group members included) moves by the same amount.
      const roots = (next.layers || []).filter((layer: any) => newIds.includes(layer.id) && layer.type !== "group");
      const members = roots.length ? roots : (next.layers || []).filter((layer: any) => !before.has(layer.id) && layer.type !== "group");
      if (members.length) {
        const left = Math.min(...members.map((layer: any) => Number(layer.x) - Number(layer.width) / 2));
        const right = Math.max(...members.map((layer: any) => Number(layer.x) + Number(layer.width) / 2));
        const top = Math.min(...members.map((layer: any) => Number(layer.y) - Number(layer.height) / 2));
        const bottom = Math.max(...members.map((layer: any) => Number(layer.y) + Number(layer.height) / 2));
        const dx = at.x - (left + right) / 2;
        const dy = at.y - (top + bottom) / 2;
        next = {
          ...next,
          layers: (next.layers || []).map((layer: any) =>
            before.has(layer.id) ? layer : { ...layer, x: Number(layer.x) + dx, y: Number(layer.y) + dy },
          ),
        };
      }
    }
    commit(next);
    setEditingGroupId(null);
    setSelectedLayerIds(newIds);
  };

  const arrangeSelectedLayers = (action: LayerArrangeMode) => {
    if (!selectedLayerIds.length) return;
    commit(arrangeLayerSelection(tRef.current, selectedLayerIds, action));
  };

  // Clipping mask: one shape plus one photo the builder may edit. The verdict is
  // shared by the Layout menu and the action, so they cannot disagree.
  const clipMaskState = (ids = selectedLayerIds) => {
    const layers = ids.map((id) => getLayer(tRef.current, id)).filter(Boolean);
    if (layers.length !== 2) return { enabled: false, reason: "Select one shape and one photo." };
    if (layers.some((layer: any) => layer.locked || layer.adminEditable === false)) {
      return { enabled: false, reason: "Unlock both objects first." };
    }
    const pair = findClipMaskPair(layers);
    return pair
      ? { enabled: true, pair }
      : { enabled: false, reason: "Select one shape (not a line) and one photo on the same page." };
  };
  const clipSelectedLayers = () => {
    const state = clipMaskState();
    if (!state.enabled || !state.pair) return;
    const layers = applyClippingMask(tRef.current.layers || [], state.pair);
    if (layers === tRef.current.layers) return;
    // One commit for the whole operation: one undo entry, one autosave.
    commit({ ...tRef.current, layers });
    setSelectedLayerIds([state.pair.image.id]);
  };
  /* ----- object menu (right click, or More actions on the toolbar) ----- */
  // Every entry runs the same command as its keyboard shortcut and toolbar
  // control, so the routes can never disagree.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; point?: { x: number; y: number }; selectionKey: string } | null>(null);
  const selectionKey = selectedLayerIds.join("|");
  const openContextMenu = (position: { x: number; y: number }, point?: { x: number; y: number }, forSelection = selectionKey) =>
    setContextMenu({ ...position, point, selectionKey: forSelection });
  // A menu never outlives the selection it was opened for.
  useEffect(() => {
    setContextMenu((current) => (current && current.selectionKey !== selectionKey ? null : current));
  }, [selectionKey]);
  useEffect(() => {
    setContextMenu(null);
  }, [activePage, tab]);
  const contextMenuGroups = (() => {
    if (!contextMenu) return [];
    const canPaste = clipboardRef.current.layers.length > 0;
    const layers = selectedLayerIds.map((id) => getLayer(tRef.current, id)).filter(Boolean);
    if (!layers.length) return buildCustomerContextMenu({ selectionCount: 0, canPaste });
    const single = layers.length === 1 ? layers[0] : null;
    const editable = (layer: any) => !layer.locked && layer.adminEditable !== false;
    const groups = groupActionState();
    return buildCustomerContextMenu({
      selectionCount: layers.length,
      primaryType: layers[0].type,
      canEditText: Boolean(single && single.type === "text" && editable(single)),
      canCrop: isAdminCroppableLayer(single),
      canEnterGroup: Boolean(single && single.type === "group"),
      canCopy: true,
      canPaste,
      canDuplicate: true,
      canDelete: layers.some(editable),
      canArrange: canTransformSelection(),
      canGroup: groups.group.enabled && layers.length > 1,
      canUngroup: groups.ungroup.enabled,
      canClipMask: clipMaskState().enabled,
      canMatchSize: layers.length > 1 && canTransformSelection(),
      canHide: Boolean(single),
      isHidden: Boolean(single?.hidden),
      canLock: Boolean(single && single.adminEditable !== false),
      isLocked: Boolean(single?.locked),
    });
  })();
  const runContextMenuAction = (id: ContextMenuActionId) => {
    const at = contextMenu?.point;
    setContextMenu(null);
    if (id === "paste") {
      pasteClipboardLayers(selectedLayerIds.length ? undefined : at);
      return;
    }
    const only = selectedLayerIds.length === 1 ? selectedLayerIds[0] : null;
    switch (id) {
      case "copy": copySelectedLayers(); break;
      case "duplicate": duplicateSelectedLayers(); break;
      case "delete": deleteSelectedLayers(); break;
      case "bringToFront": arrangeSelectedLayers("bringToFront"); break;
      case "bringForward": arrangeSelectedLayers("bringForward"); break;
      case "sendBackward": arrangeSelectedLayers("sendBackward"); break;
      case "sendToBack": arrangeSelectedLayers("sendToBack"); break;
      case "group": groupSelectedLayers(); break;
      case "ungroup": ungroupSelectedLayer(); break;
      case "clipMask": clipSelectedLayers(); break;
      case "matchWidth": runMatchSize("width"); break;
      case "matchHeight": runMatchSize("height"); break;
      case "matchSize": runMatchSize("both"); break;
      case "enterGroup": if (only) enterAdminGroup(only); break;
      case "crop": if (only) requestCrop(only); break;
      case "editText": if (only) setEditTextRequest((request) => ({ layerId: only, requestId: (request?.requestId || 0) + 1, created: false })); break;
      case "hide": if (only) onLayerPatch(only, { hidden: true }); break;
      case "show": if (only) onLayerPatch(only, { hidden: false }); break;
      case "lock": if (only) onLayerPatch(only, { locked: true }); break;
      case "unlock": if (only) onLayerPatch(only, { locked: false }); break;
    }
  };

  /* ----- page actions ----- */
  const handleAddPage = () => {
    const { template: nt, pageId } = addPage(t);
    commit(nt);
    setActivePage(pageId);
  };
  const handleDuplicatePage = (pageId: string) => {
    const { template: nt, pageId: newId } = duplicatePage(t, pageId);
    commit(nt);
    if (newId) setActivePage(newId);
  };
  const handleDeletePage = (pageId: string) => {
    const page = (t.pages || []).find((p: any) => p.id === pageId);
    const layersOnPage = (t.layers || []).filter((l: any) => l.page === pageId).length;
    const confirmed = window.confirm(
      `Delete page "${page?.label || pageId}"? Its ${layersOnPage} layer${layersOnPage === 1 ? "" : "s"} and their customer fields will be removed. This cannot be undone from outside the editor.`,
    );
    if (!confirmed) return;
    commit(deletePage(t, pageId));
    if (activePage === pageId) setActivePage((t.pages || []).find((p: any) => p.id !== pageId)?.id || "front");
    setSelectedLayerId(null);
  };

  /* ----- crash-safe recovery and autosave ----- */
  // Every unsaved change is kept in this browser (lib/customizer/studio-
  // recovery), so a refresh, a closed tab or a crash never loses it; reopening
  // the studio offers it back. A product that already exists is also saved to
  // the server automatically once editing pauses. A new product is never
  // created by autosave — it is created by Save Draft or Publish.
  const productId = product?.id ? String(product.id) : "";
  const recoveryKeyRef = useRef(studioRecoveryKey(productId));
  if (productId) recoveryKeyRef.current = studioRecoveryKey(productId);
  const [recoveryOffer, setRecoveryOffer] = useState<StudioRecoverySnapshot | null>(null);
  const recoveryOfferRef = useRef<StudioRecoverySnapshot | null>(null);
  recoveryOfferRef.current = recoveryOffer;
  const recoveryTimerRef = useRef<number | null>(null);
  const [autosaving, setAutosaving] = useState(false);
  const autosaveInFlightRef = useRef<Promise<unknown> | null>(null);
  /** Write (or retire) the local copy now. Suspended while a recovered copy awaits the admin's decision, so it is never overwritten unseen. */
  const persistRecoveryNow = () => {
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    if (recoveryOfferRef.current) return;
    if (!revisions.isDirty()) {
      clearStudioRecovery(studioStorage(), recoveryKeyRef.current);
      return;
    }
    writeStudioRecovery(studioStorage(), recoveryKeyRef.current, { productId, productName: String(productName || ""), template: tRef.current });
  };
  const persistRecoveryRef = useRef(persistRecoveryNow);
  persistRecoveryRef.current = persistRecoveryNow;
  useEffect(() => {
    if (!studioOpen) return;
    if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = window.setTimeout(() => persistRecoveryRef.current(), STUDIO_RECOVERY_DELAY_MS);
    return () => {
      if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    };
  }, [template, dirtySinceSave, studioOpen]);
  // Leaving or hiding the page writes the newest state at once; leaving with
  // changes the server has not confirmed asks first.
  useEffect(() => {
    if (!studioOpen) return;
    const flush = () => persistRecoveryRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flush();
      if (!revisions.isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [studioOpen, revisions]);
  // Opening the studio: offer back anything a previous session left unsaved.
  useEffect(() => {
    if (!studioOpen) return;
    const snapshot = readStudioRecovery(studioStorage(), recoveryKeyRef.current);
    if (studioRecoveryDiffers(snapshot, tRef.current)) setRecoveryOffer(snapshot);
    else if (snapshot && !revisions.isDirty()) clearStudioRecovery(studioStorage(), recoveryKeyRef.current);
  }, [studioOpen, revisions]);
  const restoreRecovery = () => {
    const snapshot = recoveryOfferRef.current;
    if (!snapshot) return;
    recoveryOfferRef.current = null;
    setRecoveryOffer(null);
    // One undo step back to the design as it was saved.
    commit(snapshot.template);
    setSelectedLayerIds([]);
    setEditingGroupId(null);
  };
  const discardRecovery = () => {
    recoveryOfferRef.current = null;
    setRecoveryOffer(null);
    clearStudioRecovery(studioStorage(), recoveryKeyRef.current);
    persistRecoveryNow();
  };
  const autosave = async () => {
    if (!productId || busyRef.current || autosaveInFlightRef.current || recoveryOfferRef.current) return;
    if (!revisions.isDirty()) return;
    setAutosaving(true);
    const run = saveCurrentRevision();
    autosaveInFlightRef.current = run;
    try {
      await run;
    } finally {
      autosaveInFlightRef.current = null;
      setAutosaving(false);
    }
  };
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;
  // Autosave once editing pauses — never in the middle of typing, a toolbar
  // drag or a canvas gesture, which each end with a change that re-arms it.
  useEffect(() => {
    if (!studioOpen || !productId || !dirtySinceSave || recoveryOffer || editingTextLayerId) return;
    const timer = window.setTimeout(() => {
      if (textStylePreviewRef.current || pendingGestureEntryRef.current) return;
      void autosaveRef.current();
    }, STUDIO_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [template, dirtySinceSave, studioOpen, productId, recoveryOffer, editingTextLayerId]);

  /* ----- artboard orientation ----- */
  // The canvas bar's Vertical / Horizontal control runs the SAME conversion as
  // Template Settings (lib/customizer/v2/artboard): the card's dimensions swap
  // and the whole design is carried across, as one commit — one undo step, one
  // autosave. The active value is read from the dimensions, never stored apart.
  const artboardOrientation = orientationOf(artboardOf(t));
  const setArtboardOrientation = (target: "portrait" | "landscape") => {
    if (artboardOrientation === target) return;
    commit(changeTemplateOrientation(tRef.current, target).template);
  };

  /* ----- save / publish ----- */
  const isPublished = productStatus === "active";
  const statusChips = [
    isPublished ? "Published" : "Draft",
    t.enabled ? "Active" : "Inactive",
    ...(autosaving ? ["Autosaving"] : dirtySinceSave ? ["Unsaved"] : []),
  ];

  const requestPublish = () => {
    const result = validateCustomizerTemplateDetailed(tRef.current);
    setUpdateType("minor");
    setPublishCheck(result);
  };

  const [publishNotice, setPublishNotice] = useState("");
  // One save or publish sequence at a time. The ref is the synchronous guard
  // (two clicks in one frame); the state drives the disabled buttons.
  const busyRef = useRef(false);
  const [studioBusy, setStudioBusy] = useState<"" | "saving" | "publishing">("");
  const [versions, setVersions] = useState<any[]>([]);
  const currentPublished = versions[0] || null;
  const currentPublicVersion = currentPublished
    ? { major: currentPublished.major, revision: currentPublished.revision }
    : { major: 2, revision: 0 };
  const currentDisplayVersion = currentPublished?.display || formatCustomizerVersion(currentPublicVersion);
  const nextPublicVersion = nextCustomizerVersion(currentPublicVersion, updateType);

  const loadVersions = async (productId: string | null = product?.id || null) => {
    if (!productId) return;
    try {
      const res = await fetch(`/api/admin/customizer/templates/${encodeURIComponent(productId)}/versions`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setVersions(data.versions || []);
    } catch {
      // Version history is informational — never block editing on it.
    }
  };

  useEffect(() => {
    if (studioOpen) loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioOpen]);

  /* ----- enable gate + launch card ----- */
  if (!t.enabled) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={false}
        onClick={() => onChange({ ...t, enabled: true })}
        className="group flex w-full items-center justify-between gap-4 rounded-[10px] border border-[#303839]/12 bg-[#F8F6F1] p-5 text-left transition hover:border-[#303839]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:p-6"
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#303839]/70">Husnalogy Design Studio</span>
          <span className="mt-1 block text-base font-bold text-[#303839]">Enable product customizer</span>
          <span className="mt-1 block max-w-2xl text-xs leading-5 text-[#303839]/55">
            Turn on to design an editable template in the Design Studio. When off, this product works normally.
          </span>
        </span>
        <span aria-hidden="true" className="relative h-7 w-12 shrink-0 rounded-full border border-[#303839]/20 bg-[#303839]/15 transition group-hover:bg-[#303839]/25">
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(48,56,57,0.3)]" />
        </span>
      </button>
    );
  }

  /**
   * Persist the CURRENT revision as the template draft. The product's own
   * status (active / hidden / draft) is never changed by a template save —
   * the form's "template" action keeps whatever the server has.
   *
   * Only the revision that was sent is marked clean: an edit made while the
   * request was in flight keeps the document unsaved.
   */
  const saveCurrentRevision = async () => {
    const revision = revisions.current;
    const keyBefore = recoveryKeyRef.current;
    const result = asProductSaveResult(await onSave?.("template", { template: tRef.current }));
    if (result.ok) {
      revisions.markSaved(revision);
      // The server now holds this revision: its local copy is no longer the
      // only one. An edit made while the request was in flight is still
      // unsaved, so it is written again under the product's real id.
      clearStudioRecovery(studioStorage(), keyBefore);
      recoveryKeyRef.current = studioRecoveryKey(result.productId);
      if (revisions.isDirty()) persistRecoveryNow();
      else clearStudioRecovery(studioStorage(), recoveryKeyRef.current);
    }
    setDirtySinceSave(revisions.isDirty());
    return result;
  };

  const confirmPublish = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    await autosaveInFlightRef.current;
    setStudioBusy("publishing");
    setPublishCheck(null);
    setPublishNotice("");
    try {
      // 1) Persist the draft. 2) Only if that save is confirmed, freeze
      //    exactly that draft revision as an immutable version (spec §19),
      //    using the product id the save returned (a new product has none
      //    before its first save). Existing designs keep their version; new
      //    customers get this one.
      const outcome = await saveThenPublish({
        save: saveCurrentRevision,
        publish: (productId, expectedDraftUpdatedAt) =>
          requestTemplatePublication(productId, { updateType, notes: updateNotes, expectedDraftUpdatedAt }),
      });
      setPublishNotice(outcome.message);
      if (outcome.status === "published") {
        setUpdateNotes("");
        void loadVersions(outcome.save.productId);
      }
    } finally {
      busyRef.current = false;
      setStudioBusy("");
    }
  };

  const saveDraft = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    await autosaveInFlightRef.current;
    setStudioBusy("saving");
    setPublishNotice("");
    try {
      const result = await saveCurrentRevision();
      if (result.ok === false && result.reason === "busy") setPublishNotice(result.error);
    } finally {
      busyRef.current = false;
      setStudioBusy("");
    }
  };

  const deactivate = () => {
    if (busyRef.current) return;
    if (!window.confirm("Deactivate the customizer for this product? Customers will no longer be able to personalize it (existing customizations are kept).")) return;
    onChange({ ...t, enabled: false });
    setStudioOpen(false);
  };

  const selectedLayer = selectedLayerId ? getLayer(t, selectedLayerId) : null;
  const selectedLayers = selectedLayerIds.map((id) => getLayer(t, id)).filter(Boolean);
  // One style write applied to every selected text layer, re-measuring each
  // box so line height / letter spacing changes move the selection geometry in
  // the same pass as the glyphs (spec §23).
  const buildSelectedTextStyle = (patch: Record<string, unknown>) => {
    let next = tRef.current;
    for (const id of selectedLayerIdsRef.current) {
      const layer = getLayer(next, id);
      if (layer?.type === "text") next = constrainTextLayerBox(updateLayerStyle(next, id, patch), id);
    }
    return next;
  };
  const editingSelectedText = () => Boolean(editingTextLayerId && selectedLayerIds.includes(editingTextLayerId));

  /**
   * Live preview while a toolbar control is being manipulated. The canvas
   * updates on every step, but only the first preview of an interaction opens
   * a history entry — so dragging a value from 0 to 2.4 is one undo, not
   * twenty-four (spec §17).
   */
  const previewSelectionChange = (next: any) => {
    if (!textStylePreviewRef.current) {
      const snapshotted = !editingSelectedText();
      const baseline = clone(tRef.current);
      const revision = revisions.current;
      if (snapshotted) snapshot();
      textStylePreviewRef.current = { baseline, snapshotted, revision };
    }
    apply(next);
  };
  const onSelectedTextStylePreview = (patch: Record<string, unknown>) => previewSelectionChange(buildSelectedTextStyle(patch));
  const onSelectedTextStylePatch = (patch: Record<string, unknown>) => commitSelectionChange(buildSelectedTextStyle(patch));
  /** A shape's own properties (fill, line colour, line weight) on every selected shape. */
  const buildSelectedShapeProps = (patch: Record<string, unknown>) => {
    let next = tRef.current;
    for (const id of selectedLayerIdsRef.current) {
      if (getLayer(next, id)?.type === "shape") next = updateLayer(next, id, patch);
    }
    return next;
  };
  const onSelectedShapePreview = (patch: Record<string, unknown>) => previewSelectionChange(buildSelectedShapeProps(patch));
  const onSelectedShapePatch = (patch: Record<string, unknown>) => commitSelectionChange(buildSelectedShapeProps(patch));
  const commitSelectionChange = (next: any) => {
    const session = textStylePreviewRef.current;
    textStylePreviewRef.current = null;
    // A preview session already pushed the history entry for this interaction.
    if (session) apply(next);
    else if (editingSelectedText()) apply(next);
    else commit(next);
  };
  /** Escape during a live change: restore the value the interaction started
   *  from and drop the history entry it opened, so it leaves no trace. */
  const onSelectedTextStyleCancel = () => {
    const session = textStylePreviewRef.current;
    if (!session) return;
    textStylePreviewRef.current = null;
    if (session.snapshotted) undoStack.current.pop();
    // Back to the exact starting revision: no history, no unsaved indicator.
    apply(session.baseline, session.revision);
    bump();
  };
  const currentAssetIds: string[] = [
    ...new Set<string>((t.layers || []).map((layer: any) => String(layer.assetId || "")).filter((id: string) => Boolean(id))),
  ];

  /* ----- collapsed launch card ----- */
  if (!studioOpen) {
    return (
      <div className="grid gap-5 overflow-hidden border border-[#303839]/12 bg-[#F8F6F1] p-5 shadow-[0_18px_45px_rgba(48,56,57,0.08)] sm:p-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center xl:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4 xl:col-span-2">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#303839]/70">Husnalogy Design Studio</p>
            <p className="mt-1 font-display text-2xl text-[#303839]">{settings.templateName || productName || "Product template"}</p>
            <p className="mt-1 text-xs font-semibold text-[#303839]/55">
              {enabledPages.length} page{enabledPages.length === 1 ? "" : "s"} · {layerCount} layer{layerCount === 1 ? "" : "s"} · {fieldCount} customer field{fieldCount === 1 ? "" : "s"} · V{currentDisplayVersion}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={deactivate}
              className="rounded-full border border-[#303839]/15 bg-white px-4 py-2.5 text-xs font-bold text-[#303839]/65 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              Disable
            </button>
            <button
              type="button"
              onClick={() => setStudioOpen(true)}
              className="rounded-full bg-[#303839] px-5 py-2.5 text-xs font-bold text-white shadow-[0_10px_24px_rgba(48,56,57,0.18)] transition hover:-translate-y-0.5 hover:bg-[#434c4d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2"
            >
              Open Design Studio
            </button>
          </div>
        </div>

        {validation.errors.length > 0 && (
          <p className="border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 xl:col-span-2">
            {validation.errors[0]}
            {validation.errors.length > 1 ? ` (+${validation.errors.length - 1} more)` : ""}
          </p>
        )}

        <div className="flex flex-wrap gap-3 xl:col-span-2">
          {enabledPages.slice(0, 4).map((page: any) => (
            <div key={page.id} className="w-24 2xl:w-28">
              <div className="overflow-hidden border border-[#303839]/10 bg-white shadow-sm">
                <CustomizerPreview template={t} values={{}} page={page.id} showSafeArea={false} showBleed={false} />
              </div>
              <p className="mt-1 text-center text-[10px] font-bold text-[#303839]/55">{page.label}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ----- full-screen studio ----- */
  const studio = (
    <div data-admin-customizer className="fixed inset-0 z-[120] flex min-h-0 flex-col overflow-hidden bg-[#F8F6F1] text-[#303839]">
      <AdminBuilderHeader
        templateName={settings.templateName || productName}
        productName={productName}
        statusChips={statusChips}
        saveStatusLabel={studioBusy === "publishing" ? "Publishing…" : saving || studioBusy ? "Saving…" : ""}
        tab={tab}
        onTabChange={setTab}
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        onBack={() => {
          // Keep the studio open until its save/publish sequence finishes.
          if (!busyRef.current) setStudioOpen(false);
        }}
        onSaveDraft={saveDraft}
        onPublish={requestPublish}
        publishLabel="Publish Changes"
        saving={Boolean(saving || studioBusy)}
      />

      {errorMessage && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700" role="alert">
          {errorMessage}
        </p>
      )}
      {recoveryOffer && (
        <div data-studio-recovery className="flex flex-wrap items-center gap-3 border-b border-[#D4AF37]/40 bg-[#D4AF37]/10 px-4 py-2 text-xs font-bold text-[#8a701d]" role="alert">
          <span>
            Unsaved design changes from {formatRecoveryTime(recoveryOffer.savedAt)} were kept in this browser. Restore them, or keep the saved design?
          </span>
          <button type="button" onClick={restoreRecovery} className="rounded-lg bg-[#303839] px-3 py-1.5 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2">
            Restore unsaved changes
          </button>
          <button type="button" onClick={discardRecovery} className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]">
            Keep saved design
          </button>
        </div>
      )}
      {publishNotice && (
        <p className="border-b border-[#D4AF37]/40 bg-[#D4AF37]/10 px-4 py-2 text-xs font-bold text-[#8a701d]" role="status">
          {publishNotice}
          <button type="button" onClick={() => setPublishNotice("")} className="ml-3 underline underline-offset-2">
            Dismiss
          </button>
        </p>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {tab === "design" && (
          <>
            {/* Left: the floating tool rail and the one side panel it opens. */}
            <div className="relative flex min-h-0 shrink-0 gap-3 bg-[#F3F1EC] py-3 pl-3">
              <AdminToolRail activePanel={sidePanel} onSelect={onRailSelect} />
              {/* The panel slot keeps one width whether a panel is open, closed or
                  the narrow Pages strip, so the canvas area — and the artboard's
                  position and fit — never change when panels are switched. */}
              <div className="flex min-h-0 w-[clamp(280px,22vw,340px)] shrink-0" data-admin-side-panel-slot>
              {sidePanel && (
                <aside
                  data-admin-side-panel={sidePanel}
                  aria-label={SIDE_PANEL_TITLES[sidePanel]}
                  // Pages is a narrow strip of page cards; every other panel fills the slot.
                  className={`flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(48,56,57,0.12)] ${sidePanel === "pages" ? "w-[188px]" : "w-full"}`}
                >
                  {sidePanel !== "elements" && sidePanel !== "icons" && (
                    <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
                      <h2 className="text-[19px] font-semibold text-[#1f2425]">{SIDE_PANEL_TITLES[sidePanel]}</h2>
                      <button
                        type="button"
                        aria-label="Close panel"
                        onClick={() => setSidePanel(null)}
                        className="grid h-9 w-9 place-items-center rounded-full text-[#1f2425] hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
                      </button>
                    </div>
                  )}
                  <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-color:rgba(48,56,57,0.25)_transparent] [scrollbar-width:thin]">
                    {sidePanel === "text" && (
                      <AdminTextToolPanel
                        preset={textPlacementPreset}
                        onSelectPreset={(preset) => {
                          setTextPlacementPreset(preset);
                          insertTextLayer(preset);
                        }}
                      />
                    )}
                    {sidePanel === "uploads" && <AdminUploadsPanel onInsertAsset={addImageFromAdminAsset} currentAssetIds={currentAssetIds} />}
                    {sidePanel === "background" && (
                      <AdminBackgroundPanel
                        template={t}
                        paletteSource={openedTemplate}
                        activePage={activePage}
                        onPatchPage={(pageId: string, patch: Record<string, unknown>) => commit(patchPage(t, pageId, patch))}
                        onBackgroundLayer={addBackground}
                        hasBackgroundLayer={layersForPage(t, activePage).some((layer: any) => layer.type === "background")}
                      />
                    )}
                    {(sidePanel === "elements" || sidePanel === "icons") && (
                      <CustomerElementsPanel
                        key={sidePanel}
                        onInsertElement={addElement}
                        adminMode
                        initialView={sidePanel === "icons" ? "graphics" : "home"}
                        onClose={() => setSidePanel(null)}
                        // Native inserters: shapes, lines, frames, QR codes and
                        // text stay real Husnalogy objects, created by the
                        // studio's own commands.
                        onAddShape={addShape}
                        onAddLine={addLineStyle}
                        onAddTextPreset={(preset, text) => insertPresetText(text, preset)}
                        onAddFrame={addFrameWithMask}
                        onAddQRCode={() => addQRCode()}
                        allowShapes
                        allowLines
                        allowText
                        allowFrames
                        allowQRCode
                      />
                    )}
                    {sidePanel === "options" && (
                      <AdminProductOptionsPanel
                        layout="panel"
                        productOptions={productOptions}
                        quantityOptions={quantityOptions}
                        onOptionsChange={(key: string, entries: any[]) => onProductOptionsChange?.(key, entries)}
                        onQuantityOptionsChange={(values: string[]) => onQuantityOptionsChange?.(values)}
                      />
                    )}
                    {sidePanel === "moment" && (
                      <AdminFieldsPanel
                        layout="panel"
                        template={t}
                        onFieldPatch={onFieldPatch}
                        onFieldReorder={onFieldReorder}
                        onToggleRequired={(layerId: string, required: boolean) => onFieldPatch(layerId, { required })}
                        onSelectLayer={(layerId: string) => {
                          const layer = getLayer(t, layerId);
                          if (layer) setActivePage(layer.page);
                          setSelectedLayerId(layerId);
                        }}
                      />
                    )}
                    {sidePanel === "layers" && (
                      <AdminLayersPanel
                        template={t}
                        pageId={activePage}
                        selectedLayerId={selectedLayerId}
                        selectedLayerIds={selectedLayerIds}
                        editingGroupId={editingGroupId}
                        onSelect={onCanvasSelect}
                        onEnterGroup={enterAdminGroup}
                        onLayerPatch={onLayerPatch}
                        onReorderToTarget={onReorderToTarget}
                        onDuplicate={onDuplicate}
                        onRemove={onRemove}
                      />
                    )}
                    {sidePanel === "pages" && (
                      <div id="admin-pages-section">
                        <AdminPagesPanel
                          template={t}
                          activePage={activePage}
                          onSelectPage={(pageId: string) => {
                            setActivePage(pageId);
                            setSelectedLayerId(null);
                          }}
                          onAddPage={handleAddPage}
                          onDuplicatePage={handleDuplicatePage}
                          onRenamePage={(pageId: string, label: string) => commit(renamePage(t, pageId, label))}
                          onMovePage={(pageId: string, dir: "up" | "down") => commit(movePage(t, pageId, dir))}
                          onDeletePage={handleDeletePage}
                          onPatchPage={(pageId: string, patch: any) => commit(patchPage(t, pageId, patch))}
                        />
                      </div>
                    )}
                  </div>
                </aside>
              )}
              </div>
            </div>

            <main className="relative min-h-0 min-w-[420px] flex-1 bg-[#F3F1EC]">
              {/* Page position, mirroring the customer editor's canvas label. */}
              {selectedLayerIds.length === 0 && (
                <p className="pointer-events-none absolute inset-x-0 top-3 z-20 text-center text-[11px] font-semibold text-[#303839]/40">
                  {(() => {
                    const index = enabledPages.findIndex((page: any) => page.id === activePage);
                    const current = enabledPages[index];
                    return `Page ${index + 1} of ${enabledPages.length}${current?.label ? ` · ${current.label}` : ""}`;
                  })()}
                </p>
              )}
              {/* Crop brings its own bar; the selection toolbar would sit on top of it. */}
              {selectedLayerIds.length > 0 && !croppingLayerId && !erasingLayerId && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
                  <AdminContextToolbar
                    selectedLayers={selectedLayers}
                    dpi={t.dpi}
                    editingText={editingTextLayerId === selectedLayerId}
                    canTransform={canTransformSelection()}
                    canDelete={selectedLayers.some((layer: any) => !layer.locked && layer.adminEditable !== false)}
                    approvedColors={Array.isArray(settings.allowedCustomerColors) ? settings.allowedCustomerColors : []}
                    groupAction={groupActionState()}
                    maskAction={selectedLayerIds.length === 2 ? clipMaskState() : undefined}
                    onStylePatch={onSelectedTextStylePatch}
                    onStylePreview={onSelectedTextStylePreview}
                    onStyleCancel={onSelectedTextStyleCancel}
                    onLayerPropsPatch={onSelectedShapePatch}
                    onLayerPropsPreview={onSelectedShapePreview}
                    onLayerPropsCancel={onSelectedTextStyleCancel}
                    onCopy={copySelectedLayers}
                    onDelete={() => deleteSelectedLayers()}
                    onScale={runScale}
                    onGroup={groupSelectedLayers}
                    onUngroup={ungroupSelectedLayer}
                    onMask={clipSelectedLayers}
                    onFit={runFit}
                    onChangeImage={changeSelectedImage}
                    canCrop={selectedLayerIds.length === 1 && isAdminCroppableLayer(selectedLayer)}
                    onCrop={() => selectedLayerId && requestCrop(selectedLayerId)}
                    canErase={selectedLayerIds.length === 1 && isAdminCroppableLayer(selectedLayer)}
                    onErase={() => selectedLayerId && requestErase(selectedLayerId)}
                    alignmentOpen={alignmentOpen}
                    onToggleAlignment={() => setAlignmentOpen((open) => !open)}
                  />
                </div>
              )}

              <AdminCanvas
                template={t}
                pageId={activePage}
                values={{}}
                selectedLayerId={selectedLayerId}
                selectedLayerIds={selectedLayerIds}
                onSelectionChange={onCanvasSelectionChange}
                onCropChange={setCroppingLayerId}
                cropRequest={cropRequest}
                onEraseChange={setErasingLayerId}
                eraseRequest={eraseRequest}
                // Eraser Apply: one committed change, one undo step. No marks left = no mask.
                onEraseCommit={(layerId: string, eraseMask: unknown) => onLayerPatch(layerId, { eraseMask: eraseMask || undefined })}
                // Crop Done: one committed change, one undo step.
                onImageTransformCommit={(layerId: string, imageTransform: Record<string, unknown>) => onLayerPatch(layerId, { imageTransform })}
                // The selection the menu acts on is the one the canvas just
                // set, so the menu is keyed to it explicitly.
                onLayerContextMenu={(layerId: string, position: { x: number; y: number }) =>
                  openContextMenu(position, undefined, selectedLayerIds.includes(layerId) ? selectionKey : layerId)}
                onCanvasContextMenu={(position: { x: number; y: number }, point: { x: number; y: number }) => {
                  if (clipboardRef.current.layers.length) openContextMenu(position, point, "");
                }}
                onBeginChange={beginGesture}
                onLayerChange={onCanvasLayerChange}
                onLayersChange={onCanvasLayersChange}
                editTextRequest={editTextRequest}
                  onTextEditStart={onCanvasTextEditStart}
                  onTextDraftChange={onCanvasTextDraftChange}
                  onTextMultilineActivate={onCanvasTextMultilineActivate}
                  onTextCancel={onCanvasTextCancel}
                  onTextDiscard={onCanvasTextDiscard}
                onEditingTextChange={setEditingTextLayerId}
                onExitTextTool={() => dispatchTool({ type: "escape" })}
                onTextCommit={onCanvasTextCommit}
                editingGroupId={editingGroupId}
                onEnterGroup={enterAdminGroup}
                onExitGroup={exitAdminGroup}
                onFitZoomChange={onCanvasFitZoom}
                zoom={zoom}
                panX={viewport.panX}
                panY={viewport.panY}
                onPanChange={setPan}
                onViewportChange={(next: ViewportState) => setViewport(next)}
                showSafeArea={Boolean(settings.showSafeArea)}
                showBleed={Boolean(settings.showBleed)}
                snapEnabled={snapEnabled}
                activeTool={activeTool}
                guides={(t.guides || []).filter((guide: any) => guide.pageId === activePage)}
                onGuideChange={(guideId: string, patch: any) => {
                  const guide = (tRef.current.guides || []).find((entry: any) => entry.id === guideId);
                  if (!guide) return;
                  if (!patch.deleted && Object.entries(patch).every(([key, value]) => Object.is(guide[key], value))) return;
                  flushGestureHistory();
                  apply({
                    ...tRef.current,
                    guides: patch.deleted
                      ? (tRef.current.guides || []).filter((entry: any) => entry.id !== guideId)
                      : (tRef.current.guides || []).map((entry: any) => entry.id === guideId ? { ...entry, ...patch } : entry),
                  });
                }}
              />
              {contextMenu && contextMenuGroups.length > 0 && (
                <CustomerCanvasContextMenu
                  groups={contextMenuGroups}
                  x={contextMenu.x}
                  y={contextMenu.y}
                  onAction={runContextMenuAction}
                  onClose={() => setContextMenu(null)}
                />
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex items-center justify-center px-3">
                <AdminCanvasBar
                  zoom={zoom}
                  onZoomChange={setZoom}
                  onFit={fitToPage}
                  onActualSize={resetViewport}
                  actualSizeZoom={actualSizeZoomValue}
                  snapEnabled={snapEnabled}
                  onToggleSnap={() => setSnapEnabled((value) => !value)}
                  showSafeArea={Boolean(settings.showSafeArea)}
                  onToggleSafeArea={() => commit({ ...t, settings: { ...settings, showSafeArea: !settings.showSafeArea } })}
                  showBleed={Boolean(settings.showBleed)}
                  onToggleBleed={() => commit({ ...t, settings: { ...settings, showBleed: !settings.showBleed } })}
                  panActive={activeTool === "pan"}
                  onTogglePan={() => dispatchTool({ type: "togglePan" })}
                  onAddGuide={addGuide}
                  orientation={artboardOrientation}
                  onOrientationChange={setArtboardOrientation}
                />
              </div>
            </main>

            {/* Right inspector: the configuration surface for the selection. */}
            <aside className="flex w-[clamp(300px,21vw,360px)] shrink-0 flex-col border-l border-[#303839]/8 bg-white max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[48%] max-lg:w-full max-lg:rounded-t-2xl max-lg:border-l-0 max-lg:border-t max-lg:shadow-[0_-8px_32px_rgba(48,56,57,0.14)]">
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(48,56,57,0.18)_transparent] [scrollbar-width:thin]">
                {alignmentOpen && selectedLayerIds.length > 0 ? (
                  <AdminAlignmentPanel
                    selectionCount={selectedLayerIds.length}
                    canTransform={canTransformSelection()}
                    rotation={sharedRotation(selectedLayers)}
                    onClose={() => setAlignmentOpen(false)}
                    onAlign={runAlign}
                    onDistribute={runDistribute}
                    onFlip={runFlip}
                    onScale={runScale}
                    onRotateBy={runRotateBy}
                  />
                ) : <AdminPropertiesPanel
                  template={t}
                  layer={selectedLayer}
                  onLayerPatch={onLayerPatch}
                  onStylePatch={onStylePatch}
                  onFieldPatch={onFieldPatch}
                  onLinkField={onLinkField}
                  onUnlinkField={onUnlinkField}
                  onToggleCustomerEditable={onToggleCustomerEditable}
                  onReplaceImage={replaceImageOnLayer}
                  onDuplicate={onDuplicate}
                  onRemove={onRemove}
                  onReorderToTarget={onReorderToTarget}
                  onBringToFront={(id: string) => commit(bringLayerToFront(t, id))}
                  onSendToBack={(id: string) => commit(sendLayerToBack(t, id))}
                />}
              </div>
            </aside>
          </>
        )}

        {tab === "fields" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AdminFieldsPanel
              template={t}
              onFieldPatch={onFieldPatch}
              onFieldReorder={onFieldReorder}
              onToggleRequired={(layerId: string, required: boolean) => onFieldPatch(layerId, { required })}
              onSelectLayer={(layerId: string) => {
                const layer = getLayer(t, layerId);
                if (layer) setActivePage(layer.page);
                setSelectedLayerId(layerId);
                            setTab("design");
              }}
            />
          </div>
        )}

        {tab === "options" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AdminProductOptionsPanel
              productOptions={productOptions}
              quantityOptions={quantityOptions}
              onOptionsChange={(key: string, entries: any[]) => onProductOptionsChange?.(key, entries)}
              onQuantityOptionsChange={(values: string[]) => onQuantityOptionsChange?.(values)}
            />
          </div>
        )}

        {tab === "preview" && (
          <div className="min-h-0 flex-1">
            <AdminCustomerPreview template={t} product={product || { title: productName }} />
          </div>
        )}

        {tab === "mockups" && (
          <AdminMockupEditor
            template={t}
            product={product || { title: productName }}
            onChange={(next: any) => commit(next)}
            // Loading or saving the normalized mockup tables is its own save
            // path; reflecting its result must not mark the draft unsaved.
            onSyncedChange={(next: any) => {
              tRef.current = next;
              onChangeRef.current(next);
            }}
          />
        )}

        {tab === "settings" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AdminTemplateSettings
              template={t}
              onChange={(next: any) => commit(next)}
              productName={productName}
              productId={product?.id}
              productType={product?.productType}
            />
            {/* Publishing (spec §19): what is live, and when it was published. */}
            <div className="mx-auto w-full max-w-7xl px-4 pb-4 md:px-6 2xl:px-8">
              <section className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(31,36,37,0.08)]">
                <h4 className="text-[14px] font-bold text-[#1f2425]">Customizer publishing</h4>
                <p className="mt-1 text-[13px] leading-relaxed text-[#303839]/75">
                  Publishing makes the current design live for new customers. Customer designs, cart items and orders
                  already made keep the design they were created with.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[10px] bg-[#F2F3F5] p-3">
                    <p className="text-[12.5px] font-semibold text-[#303839]/75">Draft status</p>
                    <p className="mt-1 text-[14px] font-semibold text-[#1f2425]">{dirtySinceSave ? "Unpublished changes" : currentPublished ? "Up to date" : "Not published yet"}</p>
                  </div>
                  <div className="rounded-[10px] bg-[#F2F3F5] p-3">
                    <p className="text-[12.5px] font-semibold text-[#303839]/75">Last published</p>
                    <p className="mt-1 text-[14px] font-semibold text-[#1f2425]">{currentPublished?.createdAt ? new Date(currentPublished.createdAt).toLocaleString() : "Not published yet"}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" data-shape="round" onClick={requestPublish} className="h-9 cursor-pointer rounded-full bg-[#27307A] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#1f2766]">Publish</button>
                </div>
                <h5 className="mt-6 text-[14px] font-bold text-[#1f2425]">Publish history</h5>
                {versions.length === 0 ? (
                  <p className="mt-2 text-[13px] text-[#303839]/70">Nothing published yet.</p>
                ) : (
                  <ul className="mt-2 grid gap-1.5">
                    {versions.map((version: any, index: number) => (
                      <li key={version.id} className="flex items-center justify-between rounded-[10px] bg-[#F2F3F5] px-3 py-2.5 text-[13px]">
                        <span className="font-semibold text-[#1f2425]">{index === 0 ? "Live design" : "Published"}</span>
                        <span className="text-[12.5px] text-[#303839]/70">
                          {version.createdAt ? new Date(version.createdAt).toLocaleString() : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <div className="mx-auto w-full max-w-7xl px-4 pb-8 md:px-6 2xl:px-8">
              <button
                type="button"
                onClick={deactivate}
                className="rounded-full border border-red-200 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                Deactivate customizer for this product
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Publish dialog: checks, then one Publish action. */}
      {publishCheck && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#1f2425]/45 p-4" onClick={() => setPublishCheck(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Publish Changes"
            className="w-full max-w-[440px] rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(31,36,37,0.28)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[19px] font-semibold leading-tight text-[#1f2425]">Publish changes</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#303839]/75">
                  Customers see the published design straight away. Orders already placed keep the design they were made with.
                </p>
              </div>
              <button
                type="button"
                data-shape="round"
                aria-label="Close"
                onClick={() => setPublishCheck(null)}
                className="-mr-2 -mt-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-[#1f2425] transition-colors hover:bg-[#F2F3F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>

            {publishCheck.errors.length > 0 && (
              <div className="mt-4 rounded-[10px] bg-red-50 p-3.5">
                <p className="text-[13px] font-semibold text-red-700">Fix these before publishing</p>
                <ul className="mt-1.5 grid gap-1 text-[13px] leading-snug text-red-700">
                  {publishCheck.errors.map((error) => (
                    <li key={error}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}

            {publishCheck.warnings.length > 0 && (
              <div className="mt-4 rounded-[10px] bg-[#FFF6DD] p-3.5">
                <p className="text-[13px] font-semibold text-[#6b5414]">Check before publishing</p>
                <ul className="mt-1.5 grid gap-1 text-[13px] leading-snug text-[#6b5414]">
                  {publishCheck.warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {!publishCheck.errors.length && !publishCheck.warnings.length && (
              <p className="mt-4 flex items-center gap-2.5 rounded-[10px] bg-[#F2F3F5] px-3.5 py-3 text-[13.5px] text-[#1f2425]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-600 text-white" aria-hidden>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>
                </span>
                All checks passed. The template is ready to publish.
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                data-shape="round"
                onClick={() => setPublishCheck(null)}
                className="h-10 cursor-pointer rounded-full border-[1.5px] border-[#27307A] bg-white px-5 text-[13.5px] font-semibold text-[#27307A] transition-colors hover:bg-[#27307A]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2"
              >
                Cancel
              </button>
              {!publishCheck.errors.length && (
                <button
                  type="button"
                  data-shape="round"
                  onClick={confirmPublish}
                  disabled={Boolean(studioBusy || saving)}
                  className="h-10 cursor-pointer rounded-full bg-[#27307A] px-6 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#1f2766] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
                >
                  {studioBusy === "publishing" ? "Publishing…" : "Publish"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(studio, document.body);
}
