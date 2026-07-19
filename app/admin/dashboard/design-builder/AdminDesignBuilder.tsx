"use client";

// Admin Design Studio (Sections 18–39). Lives inside the product form: the
// template is form state (onChange), product options are form state too, and
// Save Draft / Publish delegate to the form's existing save pipeline — so
// template versioning, validation, and persistence all keep working.
//
// Collapsed: a launch card with a live summary. Open: a full-screen
// professional editor (fixed overlay, no site chrome).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  validateCustomizerTemplateDetailed,
} from "@/lib/customizer";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import CustomizerZoomControls from "@/app/components/customizer/CustomizerZoomControls";
import AdminBuilderHeader from "./AdminBuilderHeader";
import AdminContextToolbar from "./AdminContextToolbar";
import AdminToolRail from "./AdminToolRail";
import AdminCanvas from "./AdminCanvas";
import AdminPropertiesPanel from "./AdminPropertiesPanel";
import AdminLayersPanel from "./AdminLayersPanel";
import AdminPagesPanel from "./AdminPagesPanel";
import AdminFieldsPanel from "./AdminFieldsPanel";
import AdminProductOptionsPanel from "./AdminProductOptionsPanel";
import AdminTemplateSettings from "./AdminTemplateSettings";
import AdminCustomerPreview from "./AdminCustomerPreview";
import AdminMockupEditor from "./AdminMockupEditor";
import CustomerElementsPanel, { type LibraryElement } from "@/app/components/customizer/CustomerElementsPanel";
import { createGridSlots } from "@/lib/customizer/v2/grids";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";
import {
  addLayer,
  addPage,
  alignLayers,
  bringLayerToFront,
  deletePage,
  distributeLayers,
  duplicateLayer,
  duplicatePage,
  getEnabledBuilderPages,
  getLayer,
  groupSelectedLayers,
  layersForPage,
  matchLayerSize,
  movePage,
  moveLayers,
  newImageLayer,
  newBackgroundLayer,
  newElementLayer,
  newGridLayer,
  newQRCodeLayer,
  newShapeLayer,
  newTextLayer,
  patchPage,
  removeLayer,
  renamePage,
  reorderLayer,
  sendLayerToBack,
  setCustomerEditable,
  updateConnectedField,
  updateLayer,
  updateLayerStyle,
  uploadBuilderImage,
  ungroupLayer,
  type AlignMode,
} from "./builder-utils";

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
  const gridsEnabled = isCustomizerFeatureEnabled(t, "customizer_v2_grids");
  const groupsEnabled = isCustomizerFeatureEnabled(t, "customizer_v2_groups");
  const [studioOpen, setStudioOpen] = useState(false);
  const [activeTool, setActiveTool] = useState("select");
  const [tab, setTab] = useState("design");
  const [activePage, setActivePage] = useState(t.defaultPage || "front");
  // Multi-selection (spec §7): the LAST id is the primary layer (shows
  // handles + drives the properties panel).
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const selectedLayerId = selectedLayerIds[selectedLayerIds.length - 1] || null;
  const setSelectedLayerId = (id: string | null) => setSelectedLayerIds(id ? [id] : []);
  const [zoom, setZoom] = useState(1);
  const [rightPanel, setRightPanel] = useState<"pages" | "layers">("pages");
  const [uploading, setUploading] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [publishCheck, setPublishCheck] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [dirtySinceSave, setDirtySinceSave] = useState(false);

  /* ----- history (deep-cloned snapshots, refs keep handlers stable) ----- */
  const clone = (obj: any) => (typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
  const tRef = useRef(t);
  tRef.current = t;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const undoStack = useRef<any[]>([]);
  const redoStack = useRef<any[]>([]);
  const [, forceTick] = useState(0);
  const bump = () => forceTick((x) => x + 1);

  const apply = (next: any) => {
    setDirtySinceSave(true);
    onChangeRef.current(next);
  };
  const snapshot = () => {
    undoStack.current.push(clone(tRef.current));
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
    redoStack.current.push(clone(tRef.current));
    apply(undoStack.current.pop());
    bump();
  };
  const redo = () => {
    if (!redoStack.current.length) return;
    undoStack.current.push(clone(tRef.current));
    apply(redoStack.current.pop());
    bump();
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
        if (k === "d" && selectedLayerId) {
          e.preventDefault();
          onDuplicate(selectedLayerId);
          return;
        }
      }
      if (typing || tab !== "design") return;
      const movableIds = selectedLayerIds.filter((id) => {
        const layer = getLayer(tRef.current, id);
        return layer && !layer.locked && layer.adminEditable !== false;
      });
      if (!movableIds.length) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        let next = tRef.current;
        for (const id of movableIds) next = removeLayer(next, id);
        commit(next);
        setSelectedLayerIds([]);
        return;
      }
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
  }, [studioOpen, tab, selectedLayerId, selectedLayerIds, activePage]);

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
  const addText = () => {
    const layer = newTextLayer(t, activePage);
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
  };
  const addPhotoArea = () => {
    const layer = newImageLayer(t, activePage);
    let next = addLayer(t, layer);
    // A Photo Area is customer-replaceable by definition — connect its field.
    next = setCustomerEditable(next, layer.id, true);
    commit(next);
    setSelectedLayerId(layer.id);
  };
  const addGrid = (columns: number, rows: number) => {
    if (!gridsEnabled) return;
    const layer = newGridLayer(t, activePage, columns, rows);
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
    setActiveTool("select");
  };
  const addShape = (shape: string) => {
    const layer = newShapeLayer(t, activePage, shape);
    if (shape === "rounded-rectangle") layer.borderRadius = 48;
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
    setActiveTool("select");
  };
  const addLine = () => addShape("line");
  const addQRCode = () => {
    const layer = newQRCodeLayer(t, activePage);
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
    setActiveTool("select");
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
  const groupSelection = () => {
    if (!groupsEnabled || selectedLayerIds.length < 2) return;
    const result = groupSelectedLayers(tRef.current, selectedLayerIds);
    if (result.groupId) {
      commit(result.template);
      setSelectedLayerIds([result.groupId]);
    }
  };
  const ungroupSelection = () => {
    if (!groupsEnabled) return;
    const group = selectedLayerIds.map((id) => getLayer(tRef.current, id)).find((layer) => layer?.type === "group");
    if (!group) return;
    const childIds = Array.isArray(group.childIds) ? group.childIds : [];
    commit(ungroupLayer(tRef.current, group.id));
    setSelectedLayerIds(childIds);
  };
  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadBuilderImage(file);
      if (url) {
        const layer = newImageLayer(t, activePage, url);
        commit(addLayer(t, layer));
        setSelectedLayerId(layer.id);
      }
    } finally {
      setUploading(false);
    }
  };

  /* ----- layer + field + permission actions ----- */
  const onLayerPatch = (id: string, patch: any) => {
    const current = getLayer(t, id);
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
    commit(updateLayer(t, id, patch));
  };
  const onStylePatch = (id: string, patch: any) => commit(updateLayerStyle(t, id, patch));
  const onFieldPatch = (id: string, patch: any) => commit(updateConnectedField(t, id, patch));
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
  const onCanvasLayerChange = (id: string, patch: any) => apply(updateLayer(tRef.current, id, patch));
  const onCanvasLayersChange = (patches: Record<string, any>) => {
    let next = tRef.current;
    for (const [id, patch] of Object.entries(patches)) next = updateLayer(next, id, patch);
    apply(next);
  };

  /* ----- selection + alignment commands (spec §7, §8) ----- */
  const onCanvasSelect = (id: string | null, shiftKey = false) => {
    if (!id) {
      setSelectedLayerIds([]);
      return;
    }
    if (!shiftKey) {
      setSelectedLayerIds([id]);
      return;
    }
    setSelectedLayerIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const selectAllOnPage = () => {
    setSelectedLayerIds(
      layersForPage(tRef.current, activePage)
        .filter((l: any) => !l.hidden)
        .map((l: any) => l.id),
    );
  };

  const runAlign = (mode: AlignMode) => {
    if (!selectedLayerIds.length) return;
    commit(alignLayers(tRef.current, selectedLayerIds, mode));
  };
  const runDistribute = (axis: "horizontal" | "vertical") => {
    if (selectedLayerIds.length < 3) return;
    commit(distributeLayers(tRef.current, selectedLayerIds, axis));
  };
  const runMatchSize = (dimension: "width" | "height" | "both") => {
    if (selectedLayerIds.length < 2) return;
    commit(matchLayerSize(tRef.current, selectedLayerIds, dimension));
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
    setPublishCheck(result);
  };

  const [publishNotice, setPublishNotice] = useState("");
  const [versions, setVersions] = useState<any[]>([]);

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
    if (studioOpen && tab === "settings") loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioOpen, tab]);

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
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          setPublishNotice(`Published as version ${data.version?.version}.`);
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

  /* ----- collapsed launch card ----- */
  if (!studioOpen) {
    return (
      <div className="grid gap-5 overflow-hidden border border-[#303839]/12 bg-[#F8F6F1] p-5 shadow-[0_18px_45px_rgba(48,56,57,0.08)] sm:p-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center xl:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4 xl:col-span-2">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#D4AF37]">Husnalogy Design Studio</p>
            <p className="mt-1 font-display text-2xl text-[#303839]">{settings.templateName || productName || "Product template"}</p>
            <p className="mt-1 text-xs font-semibold text-[#303839]/55">
              {enabledPages.length} page{enabledPages.length === 1 ? "" : "s"} · {layerCount} layer{layerCount === 1 ? "" : "s"} · {fieldCount} customer field{fieldCount === 1 ? "" : "s"} · v{t.version || 1}
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
    <div className="fixed inset-0 z-[120] flex min-h-0 flex-col bg-[#F8F6F1] text-[#303839]">
      <AdminBuilderHeader
        templateName={settings.templateName || productName}
        productName={productName}
        statusChips={statusChips}
        saveStatusLabel={saving ? "Saving…" : ""}
        tab={tab}
        onTabChange={setTab}
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        onBack={() => setStudioOpen(false)}
        onSaveDraft={saveDraft}
        onPublish={requestPublish}
        publishLabel={isPublished ? "Update Published" : "Publish"}
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

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {tab === "design" && (
          <>
            <AdminToolRail
              activeTool={activeTool}
              onSelectTool={(tool) => {
                setActiveTool(tool);
                if (tool === "select") setSelectedLayerId(null);
              }}
              onAddText={addText}
              onUploadImage={uploadImage}
              onAddPhotoArea={addPhotoArea}
              onAddGrid={addGrid}
              onAddShape={addShape}
              onAddLine={addLine}
              onAddQRCode={addQRCode}
              onOpenElements={() => setActiveTool("elements")}
              onGroup={groupSelection}
              onUngroup={ungroupSelection}
              canGroup={selectedLayerIds.length >= 2}
              canUngroup={selectedLayerIds.some((id) => getLayer(t, id)?.type === "group")}
              gridsEnabled={gridsEnabled}
              groupsEnabled={groupsEnabled}
              onAddBackground={addBackground}
              onAddGuide={addGuide}
              onPan={() => setActiveTool((current) => current === "pan" ? "select" : "pan")}
              onPreview={() => setTab("preview")}
              onOpenPanel={setRightPanel}
              onGoTab={setTab}
              uploading={uploading}
            />

            <aside className="w-[clamp(260px,18vw,360px)] shrink-0 overflow-y-auto border-r border-[#303839]/10 bg-white shadow-[8px_0_24px_rgba(48,56,57,0.035)]">
              {activeTool === "elements" ? (
                <div className="h-full overflow-y-auto">
                  <div className="border-b border-[#303839]/10 bg-[#F8F6F1] px-4 py-3">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#D4AF37]">Elements library</p>
                    <p className="mt-1 text-xs text-[#303839]/55">Choose an approved element to add it to this page.</p>
                  </div>
                  <CustomerElementsPanel onInsertElement={addElement} />
                </div>
              ) : <AdminPropertiesPanel
                template={t}
                layer={selectedLayer}
                onLayerPatch={onLayerPatch}
                onStylePatch={onStylePatch}
                onFieldPatch={onFieldPatch}
                onToggleCustomerEditable={onToggleCustomerEditable}
                onDuplicate={onDuplicate}
                onRemove={onRemove}
                onReorder={onReorder}
                onBringToFront={(id: string) => commit(bringLayerToFront(t, id))}
                onSendToBack={(id: string) => commit(sendLayerToBack(t, id))}
              />}
            </aside>

            <main className="relative min-h-0 min-w-[420px] flex-1 bg-[radial-gradient(circle_at_center,rgba(248,246,241,0.88),transparent_58%)]">
              {selectedLayerIds.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
                  <AdminContextToolbar
                    layer={selectedLayer}
                    selectionCount={selectedLayerIds.length}
                    onStylePatch={(patch) => selectedLayer && onStylePatch(selectedLayer.id, patch)}
                    onAlign={runAlign}
                    onDistribute={runDistribute}
                    onMatchSize={runMatchSize}
                  />
                </div>
              )}

              <AdminCanvas
                template={t}
                pageId={activePage}
                values={{}}
                selectedLayerId={selectedLayerId}
                selectedLayerIds={selectedLayerIds}
                onSelect={onCanvasSelect}
                onBeginChange={snapshot}
                onLayerChange={onCanvasLayerChange}
                onLayersChange={onCanvasLayersChange}
                zoom={zoom}
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
                  <CustomizerZoomControls zoom={zoom} onZoomChange={setZoom} onFit={() => setZoom(1)} />
                  <button
                    type="button"
                    aria-pressed={snapEnabled}
                    onClick={() => setSnapEnabled((v) => !v)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-bold shadow-[0_4px_18px_rgba(48,56,57,0.10)] ${
                      snapEnabled ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/12 bg-white text-[#303839]/60"
                    }`}
                  >
                    Snap
                  </button>
                  <button
                    type="button"
                    aria-pressed={Boolean(settings.showSafeArea)}
                    onClick={() => commit({ ...t, settings: { ...settings, showSafeArea: !settings.showSafeArea } })}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-bold shadow-[0_4px_18px_rgba(48,56,57,0.10)] ${
                      settings.showSafeArea ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/12 bg-white text-[#303839]/60"
                    }`}
                  >
                    Safe area
                  </button>
                  <button
                    type="button"
                    aria-pressed={Boolean(settings.showBleed)}
                    onClick={() => commit({ ...t, settings: { ...settings, showBleed: !settings.showBleed } })}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-bold shadow-[0_4px_18px_rgba(48,56,57,0.10)] ${
                      settings.showBleed ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/12 bg-white text-[#303839]/60"
                    }`}
                  >
                    Bleed
                  </button>
                </div>
              </div>
            </main>

            <aside className="flex w-[clamp(220px,15vw,310px)] shrink-0 flex-col border-l border-[#303839]/10 bg-white shadow-[-8px_0_24px_rgba(48,56,57,0.035)]">
              <div className="flex shrink-0 gap-1 border-b border-[#303839]/10 bg-[#F8F6F1]/70 p-1.5">
                {(["pages", "layers"] as const).map((panel) => (
                  <button
                    key={panel}
                    type="button"
                    onClick={() => setRightPanel(panel)}
                    aria-pressed={rightPanel === panel}
                    className={`flex-1 rounded-md px-2 py-2 text-xs font-bold capitalize transition ${
                      rightPanel === panel ? "bg-[#303839] text-white shadow-sm" : "text-[#303839]/50 hover:bg-white hover:text-[#303839]"
                    }`}
                  >
                    {panel}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {rightPanel === "pages" ? (
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
                ) : (
                  <AdminLayersPanel
                    template={t}
                    pageId={activePage}
                    selectedLayerId={selectedLayerId}
                    onSelect={setSelectedLayerId}
                    onLayerPatch={onLayerPatch}
                    onReorder={onReorder}
                    onDuplicate={onDuplicate}
                    onRemove={onRemove}
                  />
                )}
              </div>
            </aside>
          </>
        )}

        {tab === "fields" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AdminFieldsPanel
              template={t}
              onFieldPatch={onFieldPatch}
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
              templateVersion={t.version}
            />
            {/* Version history (spec §19) */}
            <div className="mx-auto w-full max-w-7xl px-4 pb-4 md:px-6 2xl:px-8">
              <section className="rounded-lg border border-[#303839]/10 bg-white p-4">
                <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-[#303839]/70">Version history</h4>
                <p className="mt-1 text-xs text-[#303839]/55">
                  Publishing freezes an immutable snapshot. Existing customer designs, cart items, and orders keep the
                  version they were created with; new customers always get the latest published version.
                </p>
                {versions.length === 0 ? (
                  <p className="mt-3 text-sm text-[#303839]/50">No published versions yet — draft v{t.version || 1}.</p>
                ) : (
                  <ul className="mt-3 grid gap-1.5">
                    {versions.map((version: any) => (
                      <li key={version.id} className="flex items-center justify-between rounded-md bg-[#F8F6F1] px-3 py-2 text-sm">
                        <span className="font-bold text-[#303839]">Version {version.version}</span>
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
            aria-label="Publish checks"
            className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-2xl text-[#303839]">Publish checks</h3>

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

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPublishCheck(null)}
                className="rounded-full border border-[#303839]/15 px-4 py-2 text-xs font-bold text-[#303839] hover:bg-[#F8F6F1]"
              >
                Back to editing
              </button>
              {!publishCheck.errors.length && (
                <button
                  type="button"
                  onClick={confirmPublish}
                  className="rounded-full bg-[#303839] px-5 py-2 text-xs font-bold text-white hover:bg-[#434c4d]"
                >
                  {publishCheck.warnings.length ? "Publish anyway" : isPublished ? "Update Published" : "Publish"}
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
