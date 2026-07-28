"use client";

// Layers panel (Section 29): every layer on the active page, top-most first,
// with select / rename / reorder / lock / hide / duplicate / delete.

import { useState } from "react";
import { layersForPage } from "./builder-utils";

function typeIcon(layer: any) {
  if (layer.type === "text") return "T";
  if (layer.type === "image") return layer.customerEditable ? "◉" : "▣";
  if (layer.type === "shape") return "◆";
  return "?";
}

export default function AdminLayersPanel({
  template,
  pageId,
  selectedLayerId,
  selectedLayerIds = [],
  editingGroupId = null,
  onSelect,
  onEnterGroup,
  onLayerPatch,
  onReorder,
  onDuplicate,
  onRemove,
}: any) {
  const layers = layersForPage(template, pageId).slice().reverse(); // top first
  const byId = new Map<string, any>(layers.map((layer: any) => [layer.id, layer]));
  const logicalSelectionId = (layer: any) => {
    let current = layer;
    const visited = new Set<string>();
    while (current?.groupId && !visited.has(current.groupId)) {
      if (editingGroupId && current.groupId === editingGroupId) return current.id;
      visited.add(current.groupId);
      const parent = byId.get(current.groupId);
      if (!parent) break;
      current = parent;
    }
    return current?.id || layer.id;
  };
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const commitRename = (layerId: string) => {
    if (renameValue.trim()) onLayerPatch(layerId, { name: renameValue.trim() });
    setRenamingId(null);
  };

  return (
    <div className="grid gap-0.5 px-2 pb-2">
      {layers.map((layer: any, index: number) => {
        const targetId = logicalSelectionId(layer);
        const selected = selectedLayerIds.length
          ? selectedLayerIds.includes(targetId)
          : targetId === selectedLayerId;
        return (
          <div
            key={layer.id}
            className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
              selected ? "bg-white/[0.14] text-white" : "text-white/65 hover:bg-white/[0.07] hover:text-white"
            }`}
          >
            <button
              type="button"
              onClick={(event) => onSelect(targetId, event.shiftKey || event.ctrlKey || event.metaKey)}
              onDoubleClick={() => {
                if (layer.type === "group") {
                  onEnterGroup?.(layer.id);
                  return;
                }
                setRenamingId(layer.id);
                setRenameValue(layer.name || "");
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              <span className={`shrink-0 text-[11px] ${selected ? "opacity-80" : "opacity-50"}`}>{typeIcon(layer)}</span>
              {renamingId === layer.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(layer.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(layer.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full rounded border border-white/20 bg-white/10 px-1 py-0.5 text-xs text-white outline-none focus:border-[#D4AF37]"
                  aria-label="Layer name"
                />
              ) : (
                <span className="truncate text-xs font-medium">{layer.name}</span>
              )}
              {layer.customerEditable && !renamingId && (
                <span className="shrink-0 rounded px-1 text-[8px] font-bold uppercase text-[#D4AF37]">
                  Edit
                </span>
              )}
            </button>

            <span className="flex shrink-0 items-center">
              <button
                type="button"
                aria-label={`Move ${layer.name} up`}
                disabled={index === 0}
                onClick={() => onReorder(layer.id, "up")}
                className="grid h-6 w-5 place-items-center text-[10px] opacity-60 hover:opacity-100 disabled:opacity-20"
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${layer.name} down`}
                disabled={index === layers.length - 1}
                onClick={() => onReorder(layer.id, "down")}
                className="grid h-6 w-5 place-items-center text-[10px] opacity-60 hover:opacity-100 disabled:opacity-20"
              >
                ▼
              </button>
              <button
                type="button"
                aria-label={layer.hidden ? `Show ${layer.name}` : `Hide ${layer.name}`}
                onClick={() => onLayerPatch(layer.id, { hidden: !layer.hidden })}
                className={`grid h-6 w-6 place-items-center text-[11px] ${layer.hidden ? "opacity-100" : "opacity-50 hover:opacity-100"}`}
                title={layer.hidden ? "Hidden" : "Visible"}
              >
                {layer.hidden ? "🚫" : "👁"}
              </button>
              <button
                type="button"
                aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                onClick={() => onLayerPatch(layer.id, { locked: !layer.locked })}
                className={`grid h-6 w-6 place-items-center text-[11px] ${layer.locked ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
                title={layer.locked ? "Locked" : "Unlocked"}
              >
                {layer.locked ? "🔒" : "🔓"}
              </button>
              <button
                type="button"
                aria-label={`Duplicate ${layer.name}`}
                onClick={() => onDuplicate(layer.id)}
                className="grid h-6 w-6 place-items-center text-[11px] opacity-50 hover:opacity-100"
                title="Duplicate"
              >
                ⧉
              </button>
              <button
                type="button"
                aria-label={`Delete ${layer.name}`}
                onClick={() => onRemove(layer.id)}
                className="grid h-6 w-6 place-items-center text-[11px] text-red-500 opacity-60 hover:opacity-100"
                title="Delete"
              >
                ✕
              </button>
            </span>
          </div>
        );
      })}
      {!layers.length && <p className="px-2 py-3 text-xs leading-relaxed text-white/35">No layers on this page yet. Add one from the tool rail.</p>}
    </div>
  );
}
