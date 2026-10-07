"use client";

// Layers panel (Section 29): every layer on the active page, top-most first,
// with select / rename / reorder / lock / hide / duplicate / delete.
//
// Each layer is one light-grey card: a line icon for what it is, then its
// words (text) or a picture of it (images). The slim bar on the left is the
// drag grip, and marks the selected layer.

import { useState, type DragEvent, type ReactNode } from "react";
import { layersForPage } from "./builder-utils";
import { useCanvasImageSource } from "@/app/components/customizer/canvas-image-source";
import { resolveLayerImage } from "@/app/components/customizer/customizer-utils";
import { isValidLayerDrop, resolveDropEdge } from "@/lib/customizer/v2/interaction/layer-reorder";
import { layerDisplayName, layerKindLabel } from "@/lib/customizer/v2/layer-label";

const line = (children: ReactNode, size = 22) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const ICONS: Record<string, ReactNode> = {
  // An outlined T, like the reference.
  text: line(<path d="M5 5h14v4h-1.5L16.5 7H13.5v11l2 .5V20h-7v-1.5l2-.5V7H7.5L6.5 9H5Z" />),
  image: line(<><rect x="4" y="4" width="16" height="16" rx="1.5" /><circle cx="9" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 2.5-2.5L20 18" /><path d="M4 20 20 4" opacity=".35" /></>),
  frame: line(<><rect x="4" y="4" width="16" height="16" rx="1.5" strokeDasharray="3 2.5" /><circle cx="12" cy="10" r="2.5" /><path d="M7.5 17a4.5 4.5 0 0 1 9 0" /></>),
  shape: line(<><rect x="4" y="9" width="10" height="11" rx="1" /><circle cx="15.5" cy="8.5" r="4.5" /></>),
  grid: line(<><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>),
  group: line(<><rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="3 2.5" /><rect x="7" y="7" width="6" height="6" rx="1" /><circle cx="15" cy="15" r="2.5" /></>),
  element: line(<path d="m12 4 2.3 4.7 5.2.8-3.8 3.6.9 5.1L12 15.8l-4.6 2.4.9-5.1-3.8-3.6 5.2-.8Z" />),
  background: line(<><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="m4 14 10-10M4 20 20 4M10 20 20 10" /></>),
  qrCode: line(<><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></>),
};

const ACTION_ICONS = {
  visible: line(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>, 16),
  hidden: line(<><path d="M4 4l16 16" /><path d="M9.9 5.8A9.7 9.7 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-3 3.8M6.3 7.6A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9" /></>, 16),
  locked: line(<><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, 16),
  unlocked: line(<><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 7.7-1.5" /></>, 16),
  duplicate: line(<><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>, 16),
};

/** A picture layer's own picture, through the canvas's resolver; a clean empty box until (or unless) it resolves. */
function LayerThumbnail({ layer }: { layer: any }) {
  const image = layer.type === "element" ? { asset: layer, url: String(layer.src || "") } : resolveLayerImage(layer, null, {});
  const { href, status } = useCanvasImageSource(image?.asset ?? null, String(image?.url || ""), 160);
  const ready = Boolean(href) && status !== "error";
  return (
    <span data-layer-thumbnail className="relative block h-9 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-white">
      {ready && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, already-resolved canvas asset URL
        <img src={href} alt="" draggable={false} className="h-full w-full object-contain" />
      )}
    </span>
  );
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
  onReorderToTarget,
  onDuplicate,
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
  // Drag reorder state. `dropTarget` drives the indicator line, so the admin
  // can see exactly where the layer will land before releasing.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: "before" | "after" } | null>(null);
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

  const actionClass =
    "grid h-7 w-7 place-items-center rounded-md text-[#303839]/70 transition-colors hover:bg-[#303839]/[0.08] hover:text-[#1f2425] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-1 focus-visible:ring-offset-white";

  return (
    <div className="grid gap-1.5 px-4 pb-4 pt-1">
      {rows.map(({ layer, depth, hasChildren }) => {
        const targetId = logicalSelectionId(layer);
        const selected = selectedLayerIds.length
          ? selectedLayerIds.includes(targetId)
          : targetId === selectedLayerId;
        const isGroup = layer.type === "group";
        const isCollapsed = collapsed.has(layer.id);
        const label = layerDisplayName(layer);
        const movable = !layer.locked && layer.adminEditable !== false;
        // Picture layers show their picture; everything else its name.
        const pictured = (layer.type === "image" || layer.type === "element") && renamingId !== layer.id;
        return (
          <div
            key={layer.id}
            data-layer-row
            data-layer-depth={depth}
            data-selected={selected || undefined}
            style={{ marginLeft: depth * 14 }}
            onDragOver={(event: DragEvent) => {
              if (!draggingId || draggingId === layer.id) return;
              if (!isValidLayerDrop(layers, draggingId, layer.id)) return;
              // A drop is only legal within one parent, so refusing here is
              // what stops a drag from silently re-parenting a grouped layer.
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              setDropTarget({ id: layer.id, edge: resolveDropEdge(event.clientY, rect.top, rect.height) });
            }}
            onDragLeave={() => setDropTarget((current) => (current?.id === layer.id ? null : current))}
            onDrop={(event: DragEvent) => {
              event.preventDefault();
              const sourceId = draggingId || event.dataTransfer.getData("text/plain");
              setDraggingId(null);
              setDropTarget(null);
              if (!sourceId || !isValidLayerDrop(layers, sourceId, layer.id)) return;
              onReorderToTarget?.(sourceId, layer.id);
            }}
            className={`group relative flex min-h-[60px] min-w-0 items-center gap-2 rounded-[10px] py-2 pl-1.5 pr-3 transition-colors ${
              selected ? "bg-[#E8EAED]" : "bg-[#F2F3F5] hover:bg-[#ECEEF0]"
            } ${draggingId === layer.id ? "opacity-40" : ""}`}
          >
            {dropTarget?.id === layer.id && (
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-x-2 h-0.5 rounded bg-[#303839] ${
                  dropTarget.edge === "before" ? "-top-1" : "-bottom-1"
                }`}
              />
            )}
            {/* Dragging is armed from this grip only. Making the whole row
                draggable turns every click-and-twitch into a reorder, which is
                how a layers panel starts restacking a design by accident. */}
            <span
              draggable={movable}
              onDragStart={(event: DragEvent) => {
                setDraggingId(layer.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", layer.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTarget(null);
              }}
              title={movable ? "Drag to reorder" : "Layer order is locked"}
              aria-hidden
              className={`grid h-9 w-3 shrink-0 place-items-center ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
            >
              <span
                className={`block h-8 w-1 rounded-full transition-colors ${
                  selected ? "bg-[#303839]/35" : movable ? "bg-transparent group-hover:bg-[#303839]/15" : "bg-transparent"
                }`}
              />
            </span>
            {hasChildren && (
              <button
                type="button"
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggleCollapsed(layer.id)}
                className="grid h-7 w-6 shrink-0 place-items-center rounded-md text-[#303839]/60 hover:bg-[#303839]/[0.08] hover:text-[#1f2425] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={isCollapsed ? "" : "rotate-90"}>
                  <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
                </svg>
              </button>
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
              aria-label={`${layerKindLabel(layer)}: ${label}`}
              aria-pressed={selected}
              className={`flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-1 focus-visible:ring-offset-white ${layer.hidden ? "opacity-45" : ""}`}
            >
              <span className="grid w-6 shrink-0 place-items-center text-[#1f2425]">{ICONS[layer.type] || ICONS.shape}</span>
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
                  className="w-full rounded-md border border-[#303839]/20 bg-white px-2 py-1 text-sm text-[#1f2425] outline-none focus:border-[#303839]/60"
                  aria-label="Layer name"
                />
              ) : pictured ? (
                <LayerThumbnail layer={layer} />
              ) : (
                <span data-layer-label className="min-w-0 flex-1 truncate text-center text-[15px] text-[#1f2425]">
                  {label}
                </span>
              )}
            </button>
            {layer.customerEditable && renamingId !== layer.id && (
              <span title="Customers can edit this" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#D4AF37]">
                <span className="sr-only">Customers can edit this</span>
              </span>
            )}

            {/* Row actions: shown on hover and keyboard focus; a hidden or
                locked layer keeps that state on show. The label gives way. */}
            <span className={`shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex ${layer.hidden || layer.locked ? "flex" : "hidden"}`}>
              <button
                type="button"
                aria-label={layer.hidden ? `Show ${label}` : `Hide ${label}`}
                onClick={() => onLayerPatch(layer.id, { hidden: !layer.hidden })}
                className={actionClass}
                title={layer.hidden ? "Hidden" : "Visible"}
              >
                {layer.hidden ? ACTION_ICONS.hidden : ACTION_ICONS.visible}
              </button>
              <button
                type="button"
                aria-label={layer.locked ? `Unlock ${label}` : `Lock ${label}`}
                onClick={() => onLayerPatch(layer.id, { locked: !layer.locked })}
                className={actionClass}
                title={layer.locked ? "Locked" : "Unlocked"}
              >
                {layer.locked ? ACTION_ICONS.locked : ACTION_ICONS.unlocked}
              </button>
              <button
                type="button"
                aria-label={`Duplicate ${label}`}
                onClick={() => onDuplicate(layer.id)}
                className={actionClass}
                title="Duplicate"
              >
                {ACTION_ICONS.duplicate}
              </button>
            </span>
          </div>
        );
      })}
      {!layers.length && <p className="py-3 text-sm leading-relaxed text-[#303839]/50">No layers on this page yet. Add one from the tool rail.</p>}
    </div>
  );
}
