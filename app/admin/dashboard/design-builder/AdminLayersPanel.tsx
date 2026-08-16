"use client";

// Layers panel (Section 29): every layer on the active page, top-most first,
// with select / rename / reorder / lock / hide / duplicate / delete.

import { useState } from "react";
import { layersForPage } from "./builder-utils";

function typeIcon(layer: any) {
  if (layer.type === "text") return "T";
  if (layer.type === "image") return layer.customerEditable ? "◉" : "▣";
  if (layer.type === "shape") return "◆";
  if (layer.type === "group") return "▦";
  return "?";
}

/**
 * Flatten the page into display rows: a group is followed by its own children,
 * indented one level, so the panel mirrors the document tree instead of
 * listing containers and children as unrelated siblings.
 *
 * Children are only walked from their parent, never emitted at the top level,
 * which is what stops a child appearing twice.
 */
export function buildLayerRows(layers: any[], collapsed: Set<string>) {
  const childrenOf = new Map<string, any[]>();
  for (const layer of layers) {
    const parent = String(layer.groupId || "");
    if (!parent) continue;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(layer);
  }

  const rows: Array<{ layer: any; depth: number; hasChildren: boolean; hidden: boolean; locked: boolean }> = [];
  const visited = new Set<string>();

  const walk = (layer: any, depth: number, inheritedHidden: boolean, inheritedLocked: boolean) => {
    if (visited.has(layer.id)) return; // defensive: a corrupt cycle cannot hang the panel
    visited.add(layer.id);
    const children = childrenOf.get(layer.id) || [];
    const hidden = inheritedHidden || Boolean(layer.hidden);
    const locked = inheritedLocked || Boolean(layer.locked);
    rows.push({ layer, depth, hasChildren: children.length > 0, hidden, locked });
    if (collapsed.has(layer.id)) return;
    for (const child of children) walk(child, depth + 1, hidden, locked);
  };

  for (const layer of layers) {
    if (layer.groupId) continue; // reached through its parent
    walk(layer, 0, false, false);
  }
  return rows;
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
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const commitRename = (layerId: string) => {
    if (renameValue.trim()) onLayerPatch(layerId, { name: renameValue.trim() });
    setRenamingId(null);
  };
  const toggleCollapsed = (layerId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });

  const rows = buildLayerRows(layers, collapsed);

  return (
    <div className="grid gap-0.5 px-2 pb-2">
      {rows.map(({ layer, depth, hasChildren }, index) => {
        const targetId = logicalSelectionId(layer);
        const selected = selectedLayerIds.length
          ? selectedLayerIds.includes(targetId)
          : targetId === selectedLayerId;
        const isGroup = layer.type === "group";
        const isCollapsed = collapsed.has(layer.id);
        return (
          <div
            key={layer.id}
            data-layer-row
            data-layer-depth={depth}
            style={{ paddingLeft: 8 + depth * 12 }}
            className={`group flex items-center gap-1.5 rounded-lg py-1.5 pr-2 transition-colors ${
              selected ? "bg-white/[0.14] text-white" : "text-white/65 hover:bg-white/[0.07] hover:text-white"
            }`}
          >
            {hasChildren ? (
              <button
                type="button"
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${layer.name || "group"}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleCollapsed(layer.id)}
                className="grid h-5 w-4 shrink-0 place-items-center text-[9px] opacity-60 transition-transform hover:opacity-100"
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
            ) : (
              <span className="w-4 shrink-0" aria-hidden />
            )}
            <button
              type="button"
              // Same contract as the canvas: a click selects that row alone,
              // Ctrl / Cmd / Shift click builds up the selection.
              onClick={(event) => onSelect(targetId, event.shiftKey || event.ctrlKey || event.metaKey ? "toggle" : "replace")}
              onDoubleClick={() => {
                if (isGroup) {
                  onEnterGroup?.(layer.id);
                  return;
                }
                onSelect(targetId, "replace");
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
              {isGroup && !renamingId && (
                <span className="shrink-0 rounded bg-white/10 px-1 text-[8px] font-bold uppercase tracking-wide text-white/60">
                  Group
                </span>
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
                disabled={index === rows.length - 1}
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
