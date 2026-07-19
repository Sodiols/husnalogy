"use client";

import { useMemo, useState } from "react";

const typeLabel: Record<string, string> = {
  text: "T", image: "IMG", frame: "FR", grid: "GR", shape: "SH", element: "EL", group: "GP", background: "BG", qrCode: "QR",
};

export default function CustomerLayersPanel({ layers, selectedIds, selectedGridSlotId, onSelectionChange, onGridSlotSelect, onEnterGroup, onArrange, onToggleVisibility, onToggleLock, onRename, onDuplicate, onDelete }: any) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const visibleLayers = useMemo(() => layers.filter((layer: any) => layer.isUserLayer || (!layer.customerInteractionDisabled && layer.customerEditable)), [layers]);
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
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderLayer = (layer: any, depth = 0): React.ReactNode => {
    const selected = selectedIds.includes(layer.id);
    const locked = Boolean((layer.isUserLayer && layer.locked) || layer.customerLocked || layer.positionLocked);
    const adminLocked = Boolean(!layer.isUserLayer && layer.locked);
    const children = byParent.get(layer.id) || [];
    const expandable = layer.type === "group" || layer.type === "grid";
    const isCollapsed = collapsed.has(layer.id);
    const canHide = layer.isUserLayer || layer.customerPermissions?.hide;
    return (
      <div key={layer.id} className="grid gap-1.5">
        <div className={`grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-xl border px-2 py-1.5 ${selected ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/10 bg-white text-[#303839]"}`} style={{ marginLeft: depth * 14 }}>
          <div className="flex min-w-0 items-center gap-1">
            {expandable ? <button type="button" aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${layer.name || layer.type}`} aria-expanded={!isCollapsed} onClick={() => toggleCollapsed(layer.id)} className="grid h-11 w-8 shrink-0 place-items-center rounded-lg text-sm font-black hover:bg-white/10">{isCollapsed ? "+" : "−"}</button> : <span className="w-2 shrink-0" />}
            <button type="button" onClick={(event) => { if (layer.groupId) onEnterGroup?.(layer.groupId); onSelectionChange(layer.id, event.shiftKey || event.ctrlKey || event.metaKey); }} onDoubleClick={() => { if (layer.type === "group") onEnterGroup?.(layer.id); else if (layer.isUserLayer) { setRenaming(layer.id); setName(layer.name || ""); } }} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[8px] font-black ${selected ? "bg-white/12" : "bg-[#F8F6F1]"}`}>{typeLabel[layer.type] || "OB"}</span>
              <span className="min-w-0">
                {renaming === layer.id ? <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onBlur={() => commit(layer)} onKeyDown={(event) => { if (event.key === "Enter") commit(layer); if (event.key === "Escape") setRenaming(null); }} onClick={(event) => event.stopPropagation()} className="h-9 w-full rounded-md bg-white px-2 text-xs text-[#303839]" aria-label="Layer name" /> : <span className="block truncate text-xs font-bold">{layer.name || `Customer ${layer.type}`}</span>}
                <span className={`block text-[9px] font-semibold ${selected ? "text-white/60" : "text-[#303839]/45"}`}>{layer.hidden ? "Hidden" : layer.customerInteractionDisabled ? "Noninteractive" : layer.isUserLayer ? locked ? "Customer created · locked" : "Customer created" : locked ? "Administrator · customer position locked" : adminLocked ? "Administrator lock · customer editable" : "Administrator · editable"}</span>
              </span>
            </button>
          </div>
          <span className="flex items-center">
            {canHide && <button type="button" aria-label={layer.hidden ? "Show layer" : "Hide layer"} onClick={() => onToggleVisibility(layer.id, !layer.hidden)} className="min-h-11 rounded-lg px-2 text-[9px] font-bold hover:bg-white/10">{layer.hidden ? "Show" : "Hide"}</button>}
            {layer.isUserLayer && <button type="button" aria-label={locked ? "Unlock layer" : "Lock layer"} onClick={() => onToggleLock(layer.id, !locked)} className="min-h-11 rounded-lg px-2 text-[9px] font-bold hover:bg-white/10">{locked ? "Unlock" : "Lock"}</button>}
            {(layer.isUserLayer || layer.customerPermissions?.duplicate) && <button type="button" aria-label="Duplicate layer" onClick={() => onDuplicate(layer.id)} className="min-h-11 rounded-lg px-2 text-[9px] font-bold hover:bg-white/10">Copy</button>}
            {layer.isUserLayer && <button type="button" aria-label="Delete layer" onClick={() => onDelete(layer.id)} className="min-h-11 rounded-lg px-2 text-[9px] font-bold text-red-300 hover:bg-white/10">Delete</button>}
          </span>
        </div>
        {!isCollapsed && layer.type === "grid" && (layer.slots || []).map((slot: any, index: number) => (
          <button key={slot.id} type="button" aria-pressed={selectedGridSlotId === slot.id} onClick={() => { onSelectionChange(layer.id, false); onGridSlotSelect?.(layer.id, slot.id); }} className={`ml-7 flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-[10px] font-bold ${selectedGridSlotId === slot.id ? "border-[#D4AF37] bg-[#F8F6F1] text-[#303839]" : "border-[#303839]/8 bg-white text-[#303839]/60"}`} style={{ marginLeft: 28 + depth * 14 }}><span className="grid h-7 w-7 place-items-center rounded-md bg-[#F8F6F1]">{index + 1}</span><span>{slot.src || slot.assetId ? `Photo slot ${index + 1}` : `Empty slot ${index + 1}`}</span></button>
        ))}
        {!isCollapsed && children.map((child) => renderLayer(child, depth + 1))}
      </div>
    );
  };

  const roots = byParent.get("") || [];
  return (
    <div className="grid gap-2 p-3" aria-label="Customer layers">
      <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Layer order">
        {[["bringToFront", "Front"], ["bringForward", "Forward"], ["sendBackward", "Backward"], ["sendToBack", "Back"]].map(([action, label]) => (
          <button key={action} type="button" disabled={!selectedIds.length} onClick={() => onArrange(action)} className="min-h-11 flex-1 rounded-lg border border-[#303839]/12 bg-white px-2 text-[10px] font-extrabold text-[#303839] hover:border-[#D4AF37] disabled:opacity-35">{label}</button>
        ))}
      </div>
      <div className="grid gap-1.5">{roots.map((layer) => renderLayer(layer))}</div>
      {!visibleLayers.length && <p className="rounded-xl bg-[#F8F6F1] p-4 text-xs leading-5 text-[#303839]/55">This template has no customer-visible layers on this page.</p>}
    </div>
  );
}
