"use client";

// Admin Design Studio (Sections 18–39). Lives inside the product form: the
// template is form state (onChange), product options are form state too, and
// Save Draft / Publish delegate to the form's existing save pipeline — so
// template versioning, validation, and persistence all keep working.
//
// Collapsed: a launch card with a live summary. Open: a full-screen
// professional editor (fixed overlay, no site chrome).

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  validateCustomizerTemplateDetailed,
} from "@/lib/customizer";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import CustomizerZoomControls from "@/app/components/customizer/CustomizerZoomControls";
import { fitViewport, INITIAL_VIEWPORT, type ViewportState } from "@/lib/customizer/v2/viewport-pan";
import AdminBuilderHeader from "./AdminBuilderHeader";
import AdminContextToolbar from "./AdminContextToolbar";
import AdminToolRail from "./AdminToolRail";
import AdminTextToolPanel from "./AdminTextToolPanel";
import AdminCanvas from "./AdminCanvas";
import AdminPropertiesPanel from "./AdminPropertiesPanel";
import AdminLayersPanel from "./AdminLayersPanel";
import AdminPagesPanel from "./AdminPagesPanel";
import AdminFieldsPanel from "./AdminFieldsPanel";
import AdminProductOptionsPanel from "./AdminProductOptionsPanel";
import AdminTemplateSettings from "./AdminTemplateSettings";
import AdminCustomerPreview from "./AdminCustomerPreview";
import AdminMockupEditor from "./AdminMockupEditor";
import AdminUploadsPanel, { type AdminUploadAsset } from "./AdminUploadsPanel";
import CustomerElementsPanel, { type LibraryElement } from "@/app/components/customizer/CustomerElementsPanel";
import { createGridSlots } from "@/lib/customizer/v2/grids";
import { evaluateGroupAction, groupLayers, ungroupLayers } from "@/lib/customizer/v2/groups";
import { DEFAULT_LINE_HEIGHT, createCanvasMeasure, getTextResizeConstraints, isSingleLineAutoSizeText } from "@/lib/customizer/v2/text-layout";
import { resolveLayerSelectionGeometry } from "@/lib/customizer/v2/selection-geometry";
import { resolveSelection, sanitizeSelection, selectionsEqual, type SelectionIntent } from "@/lib/customizer/v2/selection";
import {
  canonicalTextLayerUpdate,
  type TextPlacementPreset,
} from "@/lib/customizer/v2/text-editing";
import { getFieldById, resolveLayerText } from "@/app/components/customizer/customizer-utils";
import { formatCustomizerVersion, nextCustomizerVersion, type CustomizerUpdateType } from "@/lib/customizer/public-version";
import {
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
  genId,
  layersForPage,
  linkLayerToField,
  matchLayerSize,
  movePage,
  moveConnectedField,
  moveLayers,
  newImageLayer,
  newBackgroundLayer,
  newElementLayer,
  newImageLayerFromAdminAsset,
  newQRCodeLayer,
  newShapeLayer,
  newTextLayer,
  patchPage,
  removeLayer,
  renamePage,
  reorderLayer,
  selectableLayersForPage,
  sendLayerToBack,
  setCustomerEditable,
  updateConnectedField,
  updateLayer,
  updateLayerStyle,
  type AlignMode,
  type DistributionMode,
  type LayerArrangeMode,
} from "./builder-utils";

const builderTextMeasure = createCanvasMeasure();

function constrainTextLayerBox(template: any, layerId: string): any {
  const layer = getLayer(template, layerId);
  if (!layer || layer.type !== "text") return template;
  const style = layer.textStyle || {};
  let constraints = getTextResizeConstraints({
    text: String(layer.text || ""),
    width: layer.width,
    height: layer.height,
    fontFamily: style.fontFamily || "Cormorant Garamond",
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
    fontFamily: style.fontFamily || "Cormorant Garamond",
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
  const nextY = style.fitMode === "auto-height" || String(layer.text || "").includes("\n")
    ? layer.y - layer.height / 2 + nextHeight / 2
    : layer.y;
  if (nextWidth === layer.width && nextHeight === layer.height && nextY === layer.y) return template;
  return updateLayer(template, layerId, { width: nextWidth, height: nextHeight, y: nextY });
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
  // activeTool is the canvas INTERACTION mode only — Select (the resting
  // state) or Pan. Insertion tools are one-shot commands, and library panels
  // are inspector content, so neither can leave the editor stuck in a mode
  // that keeps creating objects on every canvas click (spec §10–§12, §35).
  const [activeTool, setActiveTool] = useState<"select" | "pan">("select");
  const [activePanel, setActivePanel] = useState<"properties" | "text" | "uploads" | "elements">("properties");
  const [textPlacementPreset, setTextPlacementPreset] = useState<TextPlacementPreset>("body");
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [editTextRequest, setEditTextRequest] = useState<{ layerId: string; requestId: number; created: boolean } | null>(null);
  const [tab, setTab] = useState("design");
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
  const setZoom = (next: number) => setViewport((current) => ({ ...current, zoom: next }));
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
  type BuilderHistoryEntry = { template: any; selectedLayerIds: string[]; activePage: string; editingGroupId: string | null };
  const undoStack = useRef<BuilderHistoryEntry[]>([]);
  const redoStack = useRef<BuilderHistoryEntry[]>([]);
  const activeTextHistoryIdRef = useRef<string | null>(null);
  const activeTextDirtyBeforeRef = useRef(false);
  // Open toolbar interaction (typing in a numeric field, dragging the colour
  // picker): holds the template to restore on Escape and whether the
  // interaction already pushed its single undo entry.
  const textStylePreviewRef = useRef<{ baseline: any; snapshotted: boolean } | null>(null);
  const [, forceTick] = useState(0);
  const bump = () => forceTick((x) => x + 1);

  const apply = (next: any) => {
    // Several editor callbacks intentionally run in the same input event
    // (promote-to-multiline, then publish the exact textarea value). Keep the
    // canonical ref synchronous so the second write cannot overwrite the first
    // with the previous render's template.
    tRef.current = next;
    setDirtySinceSave(true);
    onChangeRef.current(next);
  };
  const historyEntry = (): BuilderHistoryEntry => ({
    template: clone(tRef.current),
    selectedLayerIds: selectedLayerIdsRef.current.slice(),
    activePage: activePageRef.current,
    editingGroupId: editingGroupIdRef.current,
  });
  const snapshot = () => {
    undoStack.current.push(historyEntry());
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
    bump();
  };
  const commit = (next: any) => {
    snapshot();
    apply(next);
  };
  const undo = () => {
    if (!undoStack.current.length) return;
    redoStack.current.push(historyEntry());
    const entry = undoStack.current.pop()!;
    apply(entry.template);
    setActivePage(entry.activePage);
    setEditingGroupId(entry.editingGroupId);
    setSelectedLayerIds(entry.selectedLayerIds);
    bump();
  };
  const redo = () => {
    if (!redoStack.current.length) return;
    undoStack.current.push(historyEntry());
    const entry = redoStack.current.pop()!;
    apply(entry.template);
    setActivePage(entry.activePage);
    setEditingGroupId(entry.editingGroupId);
    setSelectedLayerIds(entry.selectedLayerIds);
    bump();
  };
  const deleteSelectedLayers = (layerIds: string[] = selectedLayerIds) => {
    const ids = [...new Set(layerIds.filter(Boolean))];
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
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as any).isContentEditable);
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
        setActiveTool("select");
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
    activeTextDirtyBeforeRef.current = dirtySinceSave;
    snapshot();
    apply(addLayer(current, layer));
    activeTextHistoryIdRef.current = layer.id;
    setSelectedLayerIds([layer.id]);
    setActiveTool("select");
    // The canvas owns the inline editor, so the new object is handed to it for
    // immediate typing. Leaving it empty discards it again.
    setEditTextRequest((request) => ({ layerId: layer.id, requestId: (request?.requestId || 0) + 1, created: true }));
    return layer.id;
  };
  const addText = () => {
    setActivePanel("text");
    insertTextLayer();
  };
  const addPhotoArea = () => {
    const layer = newImageLayer(t, activePage);
    let next = addLayer(t, layer);
    // A Photo Area is customer-replaceable by definition — connect its field.
    next = setCustomerEditable(next, layer.id, true);
    commit(next);
    setSelectedLayerId(layer.id);
    setActiveTool("select");
    setActivePanel("properties");
  };
  const addShape = (shape: string) => {
    const layer = newShapeLayer(t, activePage, shape);
    if (shape === "rounded-rectangle") layer.borderRadius = 48;
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
    setActiveTool("select");
    setActivePanel("properties");
  };
  const addLine = () => addShape("line");
  const addQRCode = () => {
    const layer = newQRCodeLayer(t, activePage);
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
    setActiveTool("select");
    setActivePanel("properties");
  };
  const addElement = (element: LibraryElement) => {
    const layer = newElementLayer(tRef.current, activePage, element);
    commit(addLayer(tRef.current, layer));
    setSelectedLayerId(layer.id);
    setActiveTool("select");
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
    setActiveTool("select");
    setActivePanel("properties");
  };
  const addGuide = (axis: "horizontal" | "vertical") => {
    const guide = {
      id: `guide_${Math.random().toString(36).slice(2, 8)}`,
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
  const onFieldPatch = (id: string, patch: any) => commit(updateConnectedField(t, id, patch));
  const onFieldReorder = (id: string, direction: "up" | "down") => commit(moveConnectedField(t, id, direction));
  const onLinkField = (id: string, targetFieldId: string) => commit(linkLayerToField(t, id, targetFieldId));
  const onToggleCustomerEditable = (id: string, v: boolean) => commit(setCustomerEditable(t, id, v));
  const onDuplicate = (id: string) => {
    const { template: nt, newId } = duplicateLayer(t, id);
    commit(nt);
    if (newId) setSelectedLayerId(newId);
  };
  const onRemove = (id: string) => {
    commit(removeLayer(t, id));
    setSelectedLayerId(null);
  };
  const onReorder = (id: string, dir: "up" | "down") => commit(reorderLayer(t, id, dir));
  const onCanvasLayerChange = (id: string, patch: any) => {
    const { textStyle, ...layerPatch } = patch || {};
    let next = Object.keys(layerPatch).length ? updateLayer(tRef.current, id, layerPatch) : tRef.current;
    if (textStyle && typeof textStyle === "object") next = updateLayerStyle(next, id, textStyle);
    apply(next);
  };
  const onCanvasTextEditStart = (id: string) => {
    if (activeTextHistoryIdRef.current === id) return;
    activeTextDirtyBeforeRef.current = dirtySinceSave;
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
    apply(constrainTextLayerBox(updateLayer(tRef.current, id, update), id));
  };
  const onCanvasTextMultilineActivate = (id: string) => {
    const current = getLayer(tRef.current, id);
    if (!current || current.type !== "text") return;
    const style = current.textStyle || {};
    if (style.multiline && style.autoSizeMode === "height" && style.fitMode === "auto-height") return;
    apply(constrainTextLayerBox(updateLayerStyle(tRef.current, id, {
      multiline: true,
      autoSizeMode: "height",
      fitMode: "auto-height",
    }), id));
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
      const next = constrainTextLayerBox(updateLayer(tRef.current, id, update), id);
      if (activeTextHistoryIdRef.current === id) apply(next);
      else commit(next);
    }
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
      setDirtySinceSave(activeTextDirtyBeforeRef.current);
      bump();
    }
  };
  const onCanvasTextDiscard = (id: string) => {
    if (activeTextHistoryIdRef.current !== id) return;
    apply(removeLayer(tRef.current, id));
    undoStack.current.pop();
    redoStack.current = [];
    activeTextHistoryIdRef.current = null;
    setDirtySinceSave(activeTextDirtyBeforeRef.current);
    setSelectedLayerIds([]);
    bump();
  };
  const onCanvasLayersChange = (patches: Record<string, any>) => {
    let next = tRef.current;
    for (const [id, patch] of Object.entries(patches)) next = updateLayer(next, id, patch);
    apply(next);
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

  // One object aligns to the card, several align to each other — both are real
  // behaviours of alignLayers, so a single selection is not blocked (spec §18).
  const runAlign = (mode: AlignMode) => {
    if (!canTransformSelection() || selectedLayerIds.length < 1) return;
    commit(alignLayers(tRef.current, selectedLayerIds, mode, resolvedGeometryForSelection()));
  };
  const runDistribute = (axis: "horizontal" | "vertical", mode: DistributionMode = "spacing") => {
    if (selectedLayerIds.length < 3 || !canTransformSelection()) return;
    commit(distributeLayers(tRef.current, selectedLayerIds, axis, mode, resolvedGeometryForSelection()));
  };
  const runMatchSize = (dimension: "width" | "height" | "both") => {
    if (selectedLayerIds.length < 2) return;
    commit(matchLayerSize(tRef.current, selectedLayerIds, dimension));
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
  const duplicateSelectedLayers = () => {
    if (!selectedLayerIds.length) return;
    let next = tRef.current;
    const newIds: string[] = [];
    for (const id of selectedLayerIds) {
      const result = duplicateLayer(next, id);
      next = result.template;
      if (result.newId) newIds.push(result.newId);
    }
    if (!newIds.length) return;
    commit(next);
    setSelectedLayerIds(newIds);
  };
  const arrangeSelectedLayers = (action: LayerArrangeMode) => {
    if (!selectedLayerIds.length) return;
    commit(arrangeLayerSelection(tRef.current, selectedLayerIds, action));
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

  /* ----- save / publish ----- */
  const isPublished = productStatus === "active";
  const statusChips = [
    isPublished ? "Published" : "Draft",
    t.enabled ? "Active" : "Inactive",
    ...(dirtySinceSave ? ["Unsaved"] : []),
  ];

  const requestPublish = () => {
    const result = validateCustomizerTemplateDetailed(tRef.current);
    setUpdateType("minor");
    setPublishCheck(result);
  };

  const [publishNotice, setPublishNotice] = useState("");
  const [versions, setVersions] = useState<any[]>([]);
  const currentPublished = versions[0] || null;
  const currentPublicVersion = currentPublished
    ? { major: currentPublished.major, revision: currentPublished.revision }
    : { major: 2, revision: 0 };
  const currentDisplayVersion = currentPublished?.display || formatCustomizerVersion(currentPublicVersion);
  const nextPublicVersion = nextCustomizerVersion(currentPublicVersion, updateType);

  const loadVersions = async () => {
    if (!product?.id) return;
    try {
      const res = await fetch(`/api/admin/customizer/templates/${encodeURIComponent(product.id)}/versions`);
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
        onClick={() => onChange({ ...t, enabled: true })}
        className="group flex w-full items-center justify-between gap-4 border border-[#303839]/12 bg-[#F8F6F1] p-5 text-left shadow-[0_12px_32px_rgba(48,56,57,0.05)] transition hover:border-[#D4AF37]/60 hover:bg-[#F8F6F1]/45 sm:p-6"
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#D4AF37]">Husnalogy Design Studio</span>
          <span className="mt-1 block text-base font-bold text-[#303839]">Enable product customizer</span>
          <span className="mt-1 block max-w-2xl text-xs leading-5 text-[#303839]/55">
            Turn on to design an editable template in the Design Studio. When off, this product works normally.
          </span>
        </span>
        <span className="relative h-7 w-12 shrink-0 rounded-full bg-[#303839] shadow-inner transition group-hover:bg-[#434c4d]">
          <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-[#D4AF37] shadow-sm" />
        </span>
      </button>
    );
  }

  const confirmPublish = async () => {
    setPublishCheck(null);
    setPublishNotice("");
    // 1) Persist the draft through the product form's save pipeline.
    await onSave?.("publish");
    setDirtySinceSave(false);
    // 2) Freeze the published state as an immutable version snapshot
    //    (spec §19). Existing designs keep their version; new customers get
    //    this one.
    if (product?.id) {
      try {
        const res = await fetch(`/api/admin/customizer/templates/${encodeURIComponent(product.id)}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updateType, notes: updateNotes }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          setPublishNotice(`Published as Version ${data.version?.display}.`);
          setUpdateNotes("");
          loadVersions();
        } else {
          setPublishNotice(data?.errors?.[0] || data?.error || "Saved, but the version snapshot failed.");
        }
      } catch {
        setPublishNotice("Saved, but the version snapshot failed.");
      }
    }
  };

  const saveDraft = async () => {
    await onSave?.(isPublished ? "publish" : "draft");
    setDirtySinceSave(false);
  };

  const deactivate = () => {
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
  const onSelectedTextStylePreview = (patch: Record<string, unknown>) => {
    if (!textStylePreviewRef.current) {
      const snapshotted = !editingSelectedText();
      const baseline = clone(tRef.current);
      if (snapshotted) snapshot();
      textStylePreviewRef.current = { baseline, snapshotted };
    }
    apply(buildSelectedTextStyle(patch));
  };
  const onSelectedTextStylePatch = (patch: Record<string, unknown>) => {
    const next = buildSelectedTextStyle(patch);
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
    apply(session.baseline);
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
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#D4AF37]">Husnalogy Design Studio</p>
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
        saveStatusLabel={saving ? "Saving…" : ""}
        publicVersion={currentDisplayVersion}
        tab={tab}
        onTabChange={setTab}
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        onBack={() => setStudioOpen(false)}
        onSaveDraft={saveDraft}
        onPublish={requestPublish}
        publishLabel="Publish Changes"
        saving={saving}
      />

      {errorMessage && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700" role="alert">
          {errorMessage}
        </p>
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
            <AdminToolRail
              activeTool={activeTool}
              activePanel={activePanel}
              onSelectTool={(tool) => {
                if (tool === "select") {
                  setActiveTool("select");
                  setActivePanel("properties");
                  setSelectedLayerId(null);
                  return;
                }
                setActivePanel(tool as "uploads" | "elements");
              }}
              onAddText={addText}
              onAddPhotoArea={addPhotoArea}
              onAddShape={addShape}
              onAddLine={addLine}
              onAddQRCode={addQRCode}
              onOpenElements={() => setActivePanel("elements")}
              onAddBackground={addBackground}
              onAddGuide={addGuide}
              onPan={() => setActiveTool((current) => current === "pan" ? "select" : "pan")}
              // Pages now live permanently in the left sidebar, so the rail
              // button brings that section into view rather than swapping panels.
              onOpenPanel={() => {
                document.getElementById("admin-pages-section")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }}
            />

            {/* Left workspace sidebar: layers over pages, sharing the tool
                rail's dark surface so the editor reads as one unit. */}
            <aside className="flex w-[clamp(168px,16vw,280px)] shrink-0 flex-col border-r border-white/8 bg-[#2A3132]">
              <div className="flex min-h-0 flex-1 flex-col">
                <p className="shrink-0 px-4 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Layers</p>
                <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]" data-admin-dark-panel>
                  <AdminLayersPanel
                    template={t}
                    pageId={activePage}
                    selectedLayerId={selectedLayerId}
                    selectedLayerIds={selectedLayerIds}
                    editingGroupId={editingGroupId}
                    onSelect={onCanvasSelect}
                    onEnterGroup={enterAdminGroup}
                    onLayerPatch={onLayerPatch}
                    onReorder={onReorder}
                    onDuplicate={onDuplicate}
                    onRemove={onRemove}
                  />
                </div>
              </div>
              <div id="admin-pages-section" className="flex max-h-[42%] min-h-0 shrink-0 flex-col border-t border-white/8">
                <p className="shrink-0 px-4 pb-2 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Pages</p>
                <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]" data-admin-dark-panel>
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
              </div>
            </aside>

            <main className="relative min-h-0 min-w-[420px] flex-1 bg-[#F0EDED]">
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
              {selectedLayerIds.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
                  <AdminContextToolbar
                    layer={selectedLayer}
                    selectedLayers={selectedLayers}
                    selectionCount={selectedLayerIds.length}
                    editingText={editingTextLayerId === selectedLayerId}
                    canTransformSelection={canTransformSelection()}
                    approvedColors={Array.isArray(settings.allowedCustomerColors) ? settings.allowedCustomerColors : []}
                    groupAction={groupActionState()}
                    onEnterGroup={() => selectedLayerId && enterAdminGroup(selectedLayerId)}
                    onStylePatch={onSelectedTextStylePatch}
                    onStylePreview={onSelectedTextStylePreview}
                    onStyleCancel={onSelectedTextStyleCancel}
                    onAlign={runAlign}
                    onDistribute={runDistribute}
                    onMatchSize={runMatchSize}
                    onGroup={groupSelectedLayers}
                    onUngroup={ungroupSelectedLayer}
                    onDuplicate={duplicateSelectedLayers}
                    onLayerOrder={arrangeSelectedLayers}
                    onDelete={() => deleteSelectedLayers()}
                  />
                </div>
              )}

              <AdminCanvas
                template={t}
                pageId={activePage}
                values={{}}
                selectedLayerId={selectedLayerId}
                selectedLayerIds={selectedLayerIds}
                onSelectionChange={setSelectedLayerIds}
                onBeginChange={snapshot}
                onLayerChange={onCanvasLayerChange}
                onLayersChange={onCanvasLayersChange}
                editTextRequest={editTextRequest}
                  onTextEditStart={onCanvasTextEditStart}
                  onTextDraftChange={onCanvasTextDraftChange}
                  onTextMultilineActivate={onCanvasTextMultilineActivate}
                  onTextCancel={onCanvasTextCancel}
                  onTextDiscard={onCanvasTextDiscard}
                onEditingTextChange={setEditingTextLayerId}
                onExitTextTool={() => setActiveTool("select")}
                onTextCommit={onCanvasTextCommit}
                editingGroupId={editingGroupId}
                onEnterGroup={enterAdminGroup}
                onExitGroup={exitAdminGroup}
                onFitZoomChange={onCanvasFitZoom}
                zoom={zoom}
                panX={viewport.panX}
                panY={viewport.panY}
                onPanChange={setPan}
                showSafeArea={Boolean(settings.showSafeArea)}
                showBleed={Boolean(settings.showBleed)}
                snapEnabled={snapEnabled}
                activeTool={activeTool}
                guides={(t.guides || []).filter((guide: any) => guide.pageId === activePage)}
                onGuideChange={(guideId: string, patch: any) => apply({
                  ...tRef.current,
                  guides: patch.deleted
                    ? (tRef.current.guides || []).filter((guide: any) => guide.id !== guideId)
                    : (tRef.current.guides || []).map((guide: any) => guide.id === guideId ? { ...guide, ...patch } : guide),
                })}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex items-center justify-center gap-2">
                <div className="pointer-events-auto flex items-center gap-2">
                  <CustomizerZoomControls
                    zoom={zoom}
                    onZoomChange={setZoom}
                    fitZoom={1}
                    actualSizeZoom={actualSizeZoomValue}
                    usePresetSteps
                    onFit={fitToPage}
                    onActualSize={resetViewport}
                  />
                  {/* One segmented group instead of three separate pills. */}
                  <div
                    role="group"
                    aria-label="Canvas guides"
                    className="flex min-h-11 items-center gap-0.5 rounded-full border border-[#303839]/8 bg-white p-1 shadow-[0_2px_12px_rgba(48,56,57,0.08)]"
                  >
                    <button
                      type="button"
                      aria-pressed={snapEnabled}
                      onClick={() => setSnapEnabled((v) => !v)}
                      className={`min-h-9 rounded-full px-3.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                        snapEnabled ? "bg-[#303839] text-white" : "text-[#303839]/50 hover:bg-[#F8F6F1] hover:text-[#303839]"
                      }`}
                    >
                      Snap
                    </button>
                    <button
                      type="button"
                      aria-pressed={Boolean(settings.showSafeArea)}
                      onClick={() => commit({ ...t, settings: { ...settings, showSafeArea: !settings.showSafeArea } })}
                      className={`min-h-9 rounded-full px-3.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                        settings.showSafeArea ? "bg-[#303839] text-white" : "text-[#303839]/50 hover:bg-[#F8F6F1] hover:text-[#303839]"
                      }`}
                    >
                      Safe area
                    </button>
                    <button
                      type="button"
                      aria-pressed={Boolean(settings.showBleed)}
                      onClick={() => commit({ ...t, settings: { ...settings, showBleed: !settings.showBleed } })}
                      className={`min-h-9 rounded-full px-3.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                        settings.showBleed ? "bg-[#303839] text-white" : "text-[#303839]/50 hover:bg-[#F8F6F1] hover:text-[#303839]"
                      }`}
                    >
                      Bleed
                    </button>
                  </div>
                </div>
              </div>
            </main>

            {/* Right inspector: the configuration surface for the selection. */}
            <aside className="flex w-[clamp(300px,21vw,360px)] shrink-0 flex-col border-l border-[#303839]/8 bg-white max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[48%] max-lg:w-full max-lg:rounded-t-2xl max-lg:border-l-0 max-lg:border-t max-lg:shadow-[0_-8px_32px_rgba(48,56,57,0.14)]">
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(48,56,57,0.18)_transparent] [scrollbar-width:thin]">
                {activePanel === "text" && !selectedLayer ? (
                  <AdminTextToolPanel
                    preset={textPlacementPreset}
                    onSelectPreset={(preset) => {
                      setTextPlacementPreset(preset);
                      insertTextLayer(preset);
                    }}
                  />
                ) : activePanel === "uploads" ? (
                  <AdminUploadsPanel onInsertAsset={addImageFromAdminAsset} currentAssetIds={currentAssetIds} />
                ) : activePanel === "elements" ? (
                  <div className="h-full overflow-y-auto">
                    <div className="border-b border-[#303839]/8 px-4 py-3.5">
                      <p className="font-display text-[19px] leading-tight text-[#303839]">Elements library</p>
                      <p className="mt-0.5 text-xs text-[#303839]/50">Choose an approved element to add it to this page.</p>
                    </div>
                    <CustomerElementsPanel onInsertElement={addElement} adminMode />
                  </div>
                ) : <AdminPropertiesPanel
                  template={t}
                  layer={selectedLayer}
                  onLayerPatch={onLayerPatch}
                  onStylePatch={onStylePatch}
                  onFieldPatch={onFieldPatch}
                  onLinkField={onLinkField}
                  onToggleCustomerEditable={onToggleCustomerEditable}
                  onDuplicate={onDuplicate}
                  onRemove={onRemove}
                  onReorder={onReorder}
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
                setActivePanel("properties");
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
          <AdminMockupEditor template={t} product={product || { title: productName }} onChange={(next: any) => commit(next)} />
        )}

        {tab === "settings" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AdminTemplateSettings
              template={t}
              onChange={(next: any) => commit(next)}
              productName={productName}
              productId={product?.id}
              productType={product?.productType}
              templateVersion={currentDisplayVersion}
            />
            {/* Version history (spec §19) */}
            <div className="mx-auto w-full max-w-7xl px-4 pb-4 md:px-6 2xl:px-8">
              <section className="rounded-lg border border-[#303839]/10 bg-white p-4">
                <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-[#303839]/70">Customizer publishing</h4>
                <p className="mt-1 text-xs text-[#303839]/55">
                  Publishing freezes an immutable snapshot. Existing customer designs, cart items, and orders keep the
                  version they were created with; new customers always get the latest published version.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md bg-[#F8F6F1] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#303839]/50">Current Published Version</p>
                    <p className="mt-1 font-display text-xl text-[#303839]">Version {currentDisplayVersion}</p>
                  </div>
                  <div className="rounded-md bg-[#F8F6F1] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#303839]/50">Draft Status</p>
                    <p className="mt-1 text-sm font-bold text-[#303839]">{dirtySinceSave ? "Unpublished changes" : `Draft based on Version ${currentDisplayVersion}`}</p>
                  </div>
                  <div className="rounded-md bg-[#F8F6F1] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#303839]/50">Last Published</p>
                    <p className="mt-1 text-sm font-bold text-[#303839]">{currentPublished?.createdAt ? new Date(currentPublished.createdAt).toLocaleString() : "Not published yet"}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={requestPublish} className="rounded-md bg-[#303839] px-4 py-2 text-xs font-bold text-white">Publish Minor Update</button>
                  <button type="button" onClick={() => { setUpdateType("major"); setPublishCheck(validateCustomizerTemplateDetailed(tRef.current)); }} className="rounded-md border border-[#303839]/15 px-4 py-2 text-xs font-bold text-[#303839]">Publish Major Update</button>
                </div>
                <h5 className="mt-5 text-[11px] font-extrabold uppercase tracking-wide text-[#303839]/70">Immutable version history</h5>
                {versions.length === 0 ? (
                  <p className="mt-3 text-sm text-[#303839]/50">No published versions yet. Draft based on Version {currentDisplayVersion}.</p>
                ) : (
                  <ul className="mt-3 grid gap-1.5">
                    {versions.map((version: any) => (
                      <li key={version.id} className="flex items-center justify-between rounded-md bg-[#F8F6F1] px-3 py-2 text-sm">
                        <span className="font-bold text-[#303839]">Version {version.display}</span>
                        <span className="text-xs text-[#303839]/55">
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

      {/* Publish validation dialog */}
      {publishCheck && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#303839]/40 p-4" onClick={() => setPublishCheck(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Publish Changes"
            className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-2xl text-[#303839]">Publish Changes</h3>
            <p className="mt-1 text-sm text-[#303839]/60">Choose update type. Minor Update is selected by default.</p>

            {publishCheck.errors.length > 0 && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-bold text-red-700">Fix these before publishing:</p>
                <ul className="mt-1 grid gap-0.5 text-sm text-red-700">
                  {publishCheck.errors.map((error) => (
                    <li key={error}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}

            {publishCheck.warnings.length > 0 && (
              <div className="mt-3 rounded-md border border-[#D4AF37]/50 bg-[#D4AF37]/10 p-3">
                <p className="text-sm font-bold text-[#8a701d]">Warnings:</p>
                <ul className="mt-1 grid gap-0.5 text-sm text-[#8a701d]">
                  {publishCheck.warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {!publishCheck.errors.length && !publishCheck.warnings.length && (
              <p className="mt-3 text-sm text-[#303839]/70">All checks passed. The template is ready to publish.</p>
            )}

            {!publishCheck.errors.length && (
              <div className="mt-4 grid gap-2">
                {(["minor", "major"] as const).map((type) => {
                  const next = nextCustomizerVersion(currentPublicVersion, type);
                  return (
                    <label key={type} className={`flex cursor-pointer items-center justify-between rounded-md border p-3 ${updateType === type ? "border-[#D4AF37] bg-[#D4AF37]/10" : "border-[#303839]/12"}`}>
                      <span>
                        <span className="block text-sm font-bold text-[#303839]">{type === "minor" ? "Minor Update" : "Major Update"}</span>
                        <span className="text-xs text-[#303839]/55">{currentDisplayVersion} → {formatCustomizerVersion(next)}</span>
                      </span>
                      <input type="radio" name="customizer-update-type" checked={updateType === type} onChange={() => setUpdateType(type)} />
                    </label>
                  );
                })}
                {updateType === "major" && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    This will create Version {formatCustomizerVersion(nextPublicVersion)} and reset the minor revision sequence. Version {currentDisplayVersion} and all previous revisions will remain unchanged.
                  </p>
                )}
                <label className="mt-1 text-xs font-bold text-[#303839]/70">
                  Update Notes <span className="font-normal">(optional)</span>
                  <textarea value={updateNotes} onChange={(event) => setUpdateNotes(event.target.value.slice(0, 2000))} rows={3} className="mt-1 w-full rounded-md border border-[#303839]/15 px-3 py-2 text-sm font-normal text-[#303839] outline-none focus:border-[#D4AF37]" placeholder="What changed in this update?" />
                </label>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPublishCheck(null)}
                className="rounded-full border border-[#303839]/15 px-4 py-2 text-xs font-bold text-[#303839] hover:bg-[#F8F6F1]"
              >
                Cancel
              </button>
              {!publishCheck.errors.length && (
                <button
                  type="button"
                  onClick={confirmPublish}
                  className="rounded-full bg-[#303839] px-5 py-2 text-xs font-bold text-white hover:bg-[#434c4d]"
                >
                  Publish
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
