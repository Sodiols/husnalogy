"use client";

// Admin-only visual Design Builder. Composes the toolbar, interactive canvas,
// and layer panel into a Canva-style editor. The customer never sees this — they
// only get the finished design plus the fields admin marked editable.

import { useEffect, useRef, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import AdminDesignToolbar from "./AdminDesignToolbar";
import AdminPageSwitcher from "./AdminPageSwitcher";
import AdminCanvas from "./AdminCanvas";
import AdminLayerPanel from "./AdminLayerPanel";
import AdminProductSettings from "./AdminProductSettings";
import AdminEditableFieldsPanel from "./AdminEditableFieldsPanel";
import {
  addLayer,
  bringLayerToFront,
  duplicateLayer,
  getEnabledBuilderPages,
  newImageLayer,
  newShapeLayer,
  newTextLayer,
  removeLayer,
  reorderLayer,
  sendLayerToBack,
  setCustomerEditable,
  updateConnectedField,
  updateLayer,
  updateLayerStyle,
  uploadBuilderImage,
} from "./builder-utils";

export default function AdminDesignBuilder({ template, onChange, productName = "Product" }: any) {
  const t = template || {};
  const [activePage, setActivePage] = useState("front");
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [previewMode, setPreviewMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // History with deep-cloned snapshots. Refs keep the latest template/onChange so
  // the keyboard handler stays stable; a tick forces re-render for button state.
  const clone = (obj: any) => (typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
  const tRef = useRef(t);
  tRef.current = t;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const undoStack = useRef<any[]>([]);
  const redoStack = useRef<any[]>([]);
  const [, forceTick] = useState(0);
  const bump = () => forceTick((x) => x + 1);

  const apply = (next: any) => onChangeRef.current(next);
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
  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Don't hijack undo/redo while the admin is typing in a field.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as any).isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = String(e.key).toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Intentionally empty deps: undo/redo use refs, so they stay correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settings = t.settings || {};

  /* ----- enable gate ----- */
  if (!t.enabled) {
    return (
      <button
        type="button"
        onClick={() => onChange({ ...t, enabled: true })}
        className="flex w-full items-center justify-between gap-3 border border-[#111111]/12 bg-white p-4 text-left hover:bg-[#F8F8F8]"
      >
        <span>
          <span className="block text-sm font-bold text-[#111111]">Enable product customizer</span>
          <span className="mt-0.5 block text-xs text-[#111111]/55">Turn on to design an editable template. When off, this product works normally.</span>
        </span>
        <span className="relative h-6 w-11 shrink-0 rounded-full bg-[#111111]/20">
          <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white" />
        </span>
      </button>
    );
  }

  /* ----- toolbar actions ----- */
  const addText = () => {
    const layer = newTextLayer(t, activePage);
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
  };
  const addPhotoPlaceholder = () => {
    const layer = newImageLayer(t, activePage);
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
  };
  const addShape = (kind: string) => {
    const layer = newShapeLayer(t, activePage, kind);
    commit(addLayer(t, layer));
    setSelectedLayerId(layer.id);
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
  const setBackground = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadBuilderImage(file);
      if (url) {
        commit({
          ...t,
          pages: (t.pages || []).map((p: any) => (p.id === activePage ? { ...p, backgroundImage: url, thumbnail: p.thumbnail || url } : p)),
        });
      }
    } finally {
      setUploading(false);
    }
  };
  const toggleBack = (on: boolean) => {
    commit({ ...t, pages: (t.pages || []).map((p: any) => (p.id === "back" ? { ...p, enabled: on } : p)) });
    if (!on && activePage === "back") setActivePage("front");
  };

  /* ----- layer panel actions ----- */
  const onLayerPatch = (id: string, patch: any) => commit(updateLayer(t, id, patch));
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
  const onBringToFront = (id: string) => commit(bringLayerToFront(t, id));
  const onSendToBack = (id: string) => commit(sendLayerToBack(t, id));
  // Canvas drag applies without a history entry per move; one snapshot is taken at
  // the start of a drag/resize via onBeginChange.
  const onCanvasLayerChange = (id: string, patch: any) => apply(updateLayer(tRef.current, id, patch));

  const enabledPages = getEnabledBuilderPages(t);

  return (
    <div className="overflow-hidden border border-[#111111]/12 bg-white">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#111111]/10 bg-white px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="max-w-[180px] truncate font-body text-lg text-[#111111]">{productName}</span>
          <AdminPageSwitcher template={t} activePage={activePage} onSelect={setActivePage} onToggleBack={toggleBack} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" className="border border-[#111111]/15 px-2 py-1 text-xs font-bold hover:bg-[#F8F8F8] disabled:opacity-40 disabled:hover:bg-white">Undo</button>
          <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" className="border border-[#111111]/15 px-2 py-1 text-xs font-bold hover:bg-[#F8F8F8] disabled:opacity-40 disabled:hover:bg-white">Redo</button>
          <button type="button" onClick={() => setPreviewMode((v) => !v)} className={`px-3 py-1 text-xs font-bold ${previewMode ? "bg-[#111111] text-white" : "border border-[#111111]/15 hover:bg-[#F8F8F8]"}`}>
            {previewMode ? "Editing off" : "Preview"}
          </button>
          <button type="button" onClick={() => onChange({ ...t, enabled: false })} className="border border-red-200 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50">Disable</button>
        </div>
      </div>

      {uploading && <div className="bg-[#F8F8F8] px-3 py-1 text-center text-[11px] font-bold text-[#111111]/70">Uploading image…</div>}

      <div className="flex min-h-[600px]">
        {!previewMode && (
          <AdminDesignToolbar
            onAddText={addText}
            onUploadImage={uploadImage}
            onAddPhotoPlaceholder={addPhotoPlaceholder}
            onAddShape={addShape}
            onSetBackground={setBackground}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenFields={() => setFieldsOpen(true)}
          />
        )}

        {/* Center */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end gap-1 border-b border-[#111111]/10 bg-white px-3 py-1.5">
            <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} className="grid h-6 w-6 place-items-center border border-[#111111]/15 text-sm">−</button>
            <span className="w-10 text-center text-[11px] font-bold text-[#111111]/60">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))} className="grid h-6 w-6 place-items-center border border-[#111111]/15 text-sm">+</button>
          </div>

          {previewMode ? (
            <div className="flex flex-wrap justify-center gap-6 overflow-auto bg-[#F8F8F8] p-6">
              {enabledPages.map((page: any) => (
                <div key={page.id} className="w-[320px]">
                  <p className="mb-1.5 text-center text-xs font-bold uppercase tracking-wide text-[#111111]/55">{page.label}</p>
                  <div className="border border-[#111111]/10 bg-white p-2">
                    <CustomizerPreview template={t} values={{}} page={page.id} showSafeArea={Boolean(settings.showSafeArea)} showBleed={Boolean(settings.showBleed)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <AdminCanvas
              template={t}
              pageId={activePage}
              values={{}}
              selectedLayerId={selectedLayerId}
              onSelect={setSelectedLayerId}
              onBeginChange={snapshot}
              onLayerChange={onCanvasLayerChange}
              zoom={zoom}
              showSafeArea={Boolean(settings.showSafeArea)}
              showBleed={Boolean(settings.showBleed)}
            />
          )}
        </div>

        {/* Right panel */}
        {!previewMode && (
          <div className="w-80 shrink-0 border-l border-[#111111]/10 bg-white">
            <AdminLayerPanel
              template={t}
              pageId={activePage}
              selectedLayerId={selectedLayerId}
              onSelect={setSelectedLayerId}
              onLayerPatch={onLayerPatch}
              onStylePatch={onStylePatch}
              onFieldPatch={onFieldPatch}
              onToggleCustomerEditable={onToggleCustomerEditable}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
              onReorder={onReorder}
              onBringToFront={onBringToFront}
              onSendToBack={onSendToBack}
            />
          </div>
        )}
      </div>

      {settingsOpen && <AdminProductSettings template={t} onChange={(next: any) => commit(next)} onClose={() => setSettingsOpen(false)} />}
      {fieldsOpen && <AdminEditableFieldsPanel template={t} onSelectLayer={setSelectedLayerId} onClose={() => setFieldsOpen(false)} />}
    </div>
  );
}
