"use client";

// Layers panel (Section 29): every layer on the active page, top-most first,
// with select / rename / reorder / lock / hide / duplicate / delete.
//
// Each layer is one light-grey card: a line icon for what it is, then its
// words (text) or a picture of it (images). The slim bar on the left is the
// drag grip, and marks the selected layer.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { layersForPage } from "./builder-utils";
import { useCanvasImageSource } from "@/app/components/customizer/canvas-image-source";
import { resolveLayerImage } from "@/app/components/customizer/customizer-utils";
import { isValidLayerDrop } from "@/lib/customizer/v2/interaction/layer-reorder";
import { planLayerRowDrag, resolveLayerRowDrop, type LayerRowDragPlan } from "@/lib/customizer/v2/interaction/layer-row-drag";
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
  // Drag reorder: the whole row is the handle. The dragged row (and, for an
  // open group, its children) follows the pointer while the rows it passes
  // slide out of its way, so the admin sees the new order before letting go.
  const [drag, setDrag] = useState<{ id: string; dy: number; shifts: Record<string, number>; block: string[] } | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startY: number;
    startScroll: number;
    scroller: HTMLElement | null;
    plan: LayerRowDragPlan | null;
    clientY: number;
    frame: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  // The dropped row eases from where it was let go into its new slot.
  const settleRef = useRef<{ id: string; top: number } | null>(null);
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
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const reorderRef = useRef(onReorderToTarget);
  reorderRef.current = onReorderToTarget;

  const measure = () => {
    const rects: Record<string, { top: number; bottom: number }> = {};
    for (const [id, el] of rowEls.current) {
      const rect = el.getBoundingClientRect();
      rects[id] = { top: rect.top, bottom: rect.bottom };
    }
    return rects;
  };

  const offsetOf = (state: NonNullable<typeof dragRef.current>) =>
    state.clientY - state.startY + ((state.scroller?.scrollTop || 0) - state.startScroll);

  const update = useCallback(() => {
    const state = dragRef.current;
    if (!state?.plan) return;
    state.frame = 0;
    // Edge auto-scroll while the pointer rests near the top or bottom of the panel.
    const box = state.scroller?.getBoundingClientRect();
    if (state.scroller && box) {
      const edge = 48;
      const speed =
        state.clientY < box.top + edge ? -(box.top + edge - state.clientY) / 4
          : state.clientY > box.bottom - edge ? (state.clientY - (box.bottom - edge)) / 4
            : 0;
      if (speed) {
        const before = state.scroller.scrollTop;
        state.scroller.scrollTop += speed;
        if (state.scroller.scrollTop !== before) state.frame = requestAnimationFrame(update);
      }
    }
    const view = resolveLayerRowDrop(state.plan, offsetOf(state));
    setDrag({ id: state.id, dy: view.dy, shifts: view.shifts, block: state.plan.block });
  }, []);

  const listeners = useRef<{ move: (event: PointerEvent) => void; up: (event: PointerEvent) => void; cancel: () => void } | null>(null);

  const endDrag = useCallback((commit: boolean) => {
    const state = dragRef.current;
    dragRef.current = null;
    if (listeners.current) {
      window.removeEventListener("pointermove", listeners.current.move);
      window.removeEventListener("pointerup", listeners.current.up);
      window.removeEventListener("pointercancel", listeners.current.cancel);
      listeners.current = null;
    }
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
    if (!state) return;
    if (state.frame) cancelAnimationFrame(state.frame);
    if (!state.plan) return; // a click, not a drag
    // The click that follows this pointerup must not also select the row.
    suppressClickRef.current = true;
    window.setTimeout(() => (suppressClickRef.current = false), 0);
    const view = resolveLayerRowDrop(state.plan, offsetOf(state));
    const el = rowEls.current.get(state.id);
    if (el) settleRef.current = { id: state.id, top: el.getBoundingClientRect().top };
    setDrag(null);
    if (commit && view.targetId && isValidLayerDrop(layersRef.current, state.id, view.targetId)) {
      reorderRef.current?.(state.id, view.targetId);
    }
  }, []);

  const onRowPointerDown = (event: ReactPointerEvent<HTMLDivElement>, layerId: string, movable: boolean) => {
    if (!movable || event.button !== 0 || dragRef.current || renamingId) return;
    if ((event.target as HTMLElement).closest("[data-no-row-drag], input, textarea")) return;
    let scroller: HTMLElement | null = event.currentTarget.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    dragRef.current = {
      id: layerId,
      pointerId: event.pointerId,
      startY: event.clientY,
      startScroll: scroller?.scrollTop || 0,
      scroller,
      plan: null,
      clientY: event.clientY,
      frame: 0,
    };
    // Window listeners, so the drag keeps tracking outside the panel.
    const move = (moveEvent: PointerEvent) => {
      const state = dragRef.current;
      if (!state || moveEvent.pointerId !== state.pointerId) return;
      state.clientY = moveEvent.clientY;
      if (!state.plan) {
        // A press only becomes a drag after a few pixels of travel, so a
        // click still selects and a double click still renames.
        if (Math.abs(moveEvent.clientY - state.startY) < 4) return;
        const plan = planLayerRowDrag(rowsRef.current, state.id, measure());
        if (!plan) return endDrag(false);
        state.plan = plan;
        document.body.style.setProperty("user-select", "none");
        document.body.style.setProperty("cursor", "grabbing");
      }
      if (!state.frame) state.frame = requestAnimationFrame(update);
    };
    const up = (upEvent: PointerEvent) => {
      if (dragRef.current && upEvent.pointerId === dragRef.current.pointerId) endDrag(true);
    };
    const cancel = () => endDrag(false);
    listeners.current = { move, up, cancel };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  useEffect(() => () => endDrag(false), [endDrag]);

  useLayoutEffect(() => {
    const settle = settleRef.current;
    if (!settle) return;
    settleRef.current = null;
    const el = rowEls.current.get(settle.id);
    if (!el) return;
    const delta = settle.top - el.getBoundingClientRect().top;
    if (!delta) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${delta}px)`;
    void el.offsetHeight;
    el.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
    el.style.transform = "";
    el.addEventListener("transitionend", () => el.style.removeProperty("transition"), { once: true });
  });

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
        const lifted = Boolean(drag?.block.includes(layer.id));
        const shift = drag?.shifts[layer.id] || 0;
        return (
          <div
            key={layer.id}
            ref={(el) => {
              if (el) rowEls.current.set(layer.id, el);
              else rowEls.current.delete(layer.id);
            }}
            data-layer-row
            data-layer-depth={depth}
            data-selected={selected || undefined}
            data-dragging={lifted || undefined}
            // The whole row is the drag handle (not the row's buttons). A drop
            // only lands within the layer's own parent, so a drag can never
            // silently re-parent a grouped layer.
            onPointerDown={(event) => onRowPointerDown(event, layer.id, movable)}
            onClickCapture={(event) => {
              if (!suppressClickRef.current) return;
              event.stopPropagation();
              event.preventDefault();
            }}
            title={movable ? "Drag to reorder" : "Layer order is locked"}
            style={{
              marginLeft: depth * 14,
              transform: lifted ? `translateY(${drag!.dy}px)` : shift ? `translateY(${shift}px)` : undefined,
              transition: lifted ? "none" : drag ? "transform 180ms cubic-bezier(0.2, 0, 0, 1)" : undefined,
              zIndex: lifted ? 10 : undefined,
            }}
            className={`group relative flex min-h-[60px] min-w-0 select-none items-center gap-2 rounded-[10px] py-2 pl-1.5 pr-3 ${
              lifted ? "bg-white shadow-[0_8px_24px_rgba(31,36,37,0.18)]" : selected ? "bg-[#E8EAED]" : "bg-[#F2F3F5] hover:bg-[#ECEEF0]"
            } ${lifted ? "cursor-grabbing" : movable ? "cursor-grab" : ""}`}
          >
            <span aria-hidden className="grid h-9 w-3 shrink-0 place-items-center">
              <span
                className={`block h-8 w-1 rounded-full transition-colors ${
                  selected || lifted ? "bg-[#303839]/35" : movable ? "bg-transparent group-hover:bg-[#303839]/15" : "bg-transparent"
                }`}
              />
            </span>
            {hasChildren && (
              <button
                type="button"
                data-no-row-drag
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
              className={`flex min-w-0 flex-1 cursor-[inherit] items-center gap-3 self-stretch rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-1 focus-visible:ring-offset-white ${layer.hidden ? "opacity-45" : ""}`}
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
            <span data-no-row-drag className={`shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex ${layer.hidden || layer.locked ? "flex" : "hidden"}`}>
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
