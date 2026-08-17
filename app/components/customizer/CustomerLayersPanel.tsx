"use client";

import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { anyGridSlotGrantsPhotoEditing } from "@/lib/customizer/v2/grids";
import { getLayerPermissions } from "./customizer-utils";

const typeLabel: Record<string, string> = {
  text: "T",
  image: "IMG",
  frame: "FR",
  grid: "GR",
  shape: "SH",
  element: "EL",
  group: "GP",
  background: "BG",
  qrCode: "QR",
};

const orderActions = [
  ["bringToFront", "Front"],
  ["bringForward", "Forward"],
  ["sendBackward", "Backward"],
  ["sendToBack", "Back"],
] as const;

export default function CustomerLayersPanel({ layers, selectedIds, selectedGridSlotId, onSelectionChange, onGridSlotSelect, onEnterGroup, onArrange, onReorder, onToggleVisibility, onToggleLock, onRename, onDuplicate, onDelete }: any) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const customerLayers = useMemo(
    () => layers.filter((layer: any) => {
      if (layer.isUserLayer) return true;
      if (layer.customerInteractionDisabled) return false;
      // A fixed grid with individually editable slots is something the customer
      // may act on, so it belongs in their layer list (spec §17, §18) even
      // though the container itself is not customer editable.
      if (layer.type === "grid" && anyGridSlotGrantsPhotoEditing(layer)) return true;
      return Boolean(layer.customerEditable);
    }),
    [layers],
  );
  const visibleLayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return customerLayers;
    const byId = new Map(customerLayers.map((layer: any) => [layer.id, layer]));
    const included = new Set<string>();
    for (const layer of customerLayers) {
      const searchable = `${layer.name || ""} ${layer.type || ""}`.toLowerCase();
      if (!searchable.includes(normalizedQuery)) continue;
      included.add(layer.id);
      let parentId = String(layer.groupId || "");
      while (parentId && byId.has(parentId)) {
        included.add(parentId);
        parentId = String((byId.get(parentId) as any)?.groupId || "");
      }
    }
    return customerLayers.filter((layer: any) => included.has(layer.id));
  }, [customerLayers, query]);
  const byParent = useMemo(() => {
    const result = new Map<string, any[]>();
    const visibleIds = new Set(visibleLayers.map((layer: any) => layer.id));
    for (const layer of visibleLayers) {
      const parentId = String(layer.groupId || "");
      const key = visibleIds.has(parentId) ? parentId : "";
      result.set(key, [...(result.get(key) || []), layer]);
    }
    for (const entries of result.values()) entries.sort((a, b) => Number(b.zIndex || 0) - Number(a.zIndex || 0));
    return result;
  }, [visibleLayers]);

  const commit = (layer: any) => {
    if (name.trim() && layer.isUserLayer) onRename(layer.id, name.trim());
    setRenaming(null);
  };
  const toggleCollapsed = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const onDrop = (event: DragEvent, target: any) => {
    event.preventDefault();
    const sourceId = draggingId || event.dataTransfer.getData("text/plain");
    const source = customerLayers.find((layer: any) => layer.id === sourceId);
    setDraggingId(null);
    if (!source || source.id === target.id || String(source.groupId || "") !== String(target.groupId || "")) return;
    onReorder?.(source.id, target.id);
  };

  const renderLayer = (layer: any, depth = 0): ReactNode => {
    const selected = selectedIds.includes(layer.id);
    const locked = Boolean((layer.isUserLayer && layer.locked) || layer.customerLocked || layer.positionLocked);
    const adminLocked = Boolean(!layer.isUserLayer && layer.locked);
    const children = byParent.get(layer.id) || [];
    const expandable = layer.type === "group" || layer.type === "grid";
    const isCollapsed = collapsed.has(layer.id);
    // Resolve through getLayerPermissions like every other consumer — including
    // the save validator. Reading the raw `customerPermissions` object was
    // wrong: for a non-grid layer that object is NOT the source of truth (the
    // "Customer editable" switch expands into the full bundle), so a layer that
    // stored no explicit object lost its Hide, Copy and reorder controls even
    // though the server would have accepted all three.
    const permissions = getLayerPermissions(layer);
    const canHide = layer.isUserLayer || Boolean(permissions.hide);
    const canDuplicate = layer.isUserLayer || Boolean(permissions.duplicate);
    const canReorder = !locked && !layer.customerInteractionDisabled
      && (layer.isUserLayer || Boolean(permissions.changeLayerOrder));
    const selectedSurface = selected ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/10 bg-white text-[#303839]";
    const quietButton = selected ? "hover:bg-white/10" : "hover:bg-[#303839]/5";
    return (
      <div key={layer.id} className="grid gap-1.5">
        <article
          draggable={canReorder}
          onDragStart={(event) => {
            setDraggingId(layer.id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", layer.id);
          }}
          onDragEnd={() => setDraggingId(null)}
          onDragOver={(event) => {
            if (draggingId && draggingId !== layer.id) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => onDrop(event, layer)}
          className={`grid gap-1.5 rounded-xl border p-1.5 transition ${selectedSurface} ${draggingId === layer.id ? "opacity-45" : "opacity-100"}`}
          style={{ marginLeft: depth * 14 }}
        >
          <div className="flex min-w-0 items-center gap-1">
            <span className={`grid h-11 w-5 shrink-0 place-items-center text-xs font-black ${canReorder ? "cursor-grab active:cursor-grabbing" : "opacity-25"}`} title={canReorder ? "Drag to reorder" : "Layer order is locked"} aria-hidden>⋮⋮</span>
            {expandable ? (
              <button type="button" aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${layer.name || layer.type}`} aria-expanded={!isCollapsed} onClick={() => toggleCollapsed(layer.id)} className={`grid h-11 w-8 shrink-0 place-items-center rounded-lg text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${quietButton}`}>
                {isCollapsed ? "+" : "-"}
              </button>
            ) : <span className="w-2 shrink-0" />}
            <button
              type="button"
              onClick={(event) => {
                if (layer.groupId) onEnterGroup?.(layer.groupId);
                // Rows follow the canvas contract: a click selects that layer
                // alone, Ctrl / Cmd / Shift click builds up the selection.
                onSelectionChange(layer.id, event.shiftKey || event.ctrlKey || event.metaKey);
              }}
              onDoubleClick={() => {
                if (layer.type === "group") onEnterGroup?.(layer.id);
                else if (layer.isUserLayer) {
                  setRenaming(layer.id);
                  setName(layer.name || "");
                }
              }}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[8px] font-black ${selected ? "bg-white/12" : "bg-white"}`}>{typeLabel[layer.type] || "OB"}</span>
              <span className="min-w-0 flex-1">
                {renaming === layer.id ? (
                  <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onBlur={() => commit(layer)} onKeyDown={(event) => { if (event.key === "Enter") commit(layer); if (event.key === "Escape") setRenaming(null); }} onClick={(event) => event.stopPropagation()} className="h-9 w-full rounded-md bg-white px-2 text-xs text-[#303839]" aria-label="Layer name" />
                ) : <span className="block truncate text-xs font-bold">{layer.name || `Customer ${layer.type}`}</span>}
                <span className={`block truncate text-[9px] font-semibold ${selected ? "text-white/60" : "text-[#303839]/45"}`}>
                  {layer.hidden ? "Hidden" : layer.isUserLayer ? locked ? "Customer created · locked" : "Customer created" : locked ? "Admin layer · position locked" : adminLocked ? "Admin lock · customer editable" : "Admin layer · editable"}
                </span>
              </span>
            </button>
          </div>
          <div className={`grid grid-cols-4 gap-1 border-t pt-1 ${selected ? "border-white/10" : "border-[#303839]/8"}`}>
            {canHide ? <button type="button" aria-label={layer.hidden ? "Show layer" : "Hide layer"} onClick={() => onToggleVisibility(layer.id, !layer.hidden)} className={`min-h-11 rounded-lg px-1 text-[9px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${quietButton}`}>{layer.hidden ? "Show" : "Hide"}</button> : <span />}
            {layer.isUserLayer ? <button type="button" aria-label={locked ? "Unlock layer" : "Lock layer"} onClick={() => onToggleLock(layer.id, !locked)} className={`min-h-11 rounded-lg px-1 text-[9px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${quietButton}`}>{locked ? "Unlock" : "Lock"}</button> : <span />}
            {canDuplicate ? <button type="button" aria-label="Duplicate layer" onClick={() => onDuplicate(layer.id)} className={`min-h-11 rounded-lg px-1 text-[9px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${quietButton}`}>Copy</button> : <span />}
            {layer.isUserLayer ? <button type="button" aria-label="Delete layer" onClick={() => onDelete(layer.id)} className={`min-h-11 rounded-lg px-1 text-[9px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${selected ? "text-red-200 hover:bg-white/10" : "text-red-700 hover:bg-red-50"}`}>Delete</button> : <span />}
          </div>
        </article>
        {!isCollapsed && layer.type === "grid" && (layer.slots || []).map((slot: any, index: number) => (
          <button key={slot.id} type="button" aria-pressed={selectedGridSlotId === slot.id} onClick={() => { onSelectionChange(layer.id, false); onGridSlotSelect?.(layer.id, slot.id); }} className={`ml-7 flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${selectedGridSlotId === slot.id ? "border-[#D4AF37] bg-white text-[#303839]" : "border-[#303839]/8 bg-white text-[#303839]/60"}`} style={{ marginLeft: 28 + depth * 14 }}>
            <span className="grid h-7 w-7 place-items-center rounded-md bg-white">{index + 1}</span>
            <span>{slot.src || slot.assetId ? `Photo slot ${index + 1}` : `Empty slot ${index + 1}`}</span>
          </button>
        ))}
        {!isCollapsed && children.map((child) => renderLayer(child, depth + 1))}
      </div>
    );
  };

  const roots = byParent.get("") || [];
  return (
    <div className="grid gap-3 p-4" aria-label="Customer layers">
      <div>
        <label htmlFor="customer-layer-search" className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/50">Find a layer</label>
        <div className="relative">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#303839]/40" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.4-3.4" /></svg>
          <input id="customer-layer-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or type" className="h-11 w-full border border-[#303839]/12 bg-white pl-9 pr-12 text-xs font-semibold text-[#303839] outline-none transition placeholder:text-[#303839]/35 focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/15" />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-extrabold text-[#303839]/40">{visibleLayers.length}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Layer order">
        {orderActions.map(([action, label]) => (
          <button key={action} type="button" disabled={!selectedIds.length} onClick={() => onArrange(action)} className="min-h-11 flex-1 rounded-lg border border-[#303839]/12 bg-white px-2 text-[10px] font-extrabold text-[#303839] transition hover:border-[#D4AF37] hover:bg-[#303839]/5 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">{label}</button>
        ))}
      </div>
      <p className="text-[10px] leading-4 text-[#303839]/45">Drag unlocked layers to reorder. Double-click a customer layer name to rename it.</p>
      <div className="grid gap-1.5">{roots.map((layer) => renderLayer(layer))}</div>
      {!visibleLayers.length && <p className="rounded-xl bg-white p-4 text-xs leading-5 text-[#303839]/55">{query ? "No customer-visible layers match this search." : "This template has no customer-visible layers on this page."}</p>}
    </div>
  );
}
