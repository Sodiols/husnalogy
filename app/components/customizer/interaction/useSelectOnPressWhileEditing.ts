"use client";

/**
 * A press on the canvas while inline text is being edited (both canvases).
 *
 * The interaction stage steps aside during editing so the DOM editor owns the
 * pointer, and the editor finishes on any press outside the text box. Without
 * this, that press only closed the editor: the object the person actually
 * clicked was never selected, and clicking empty canvas left the text selected.
 *
 * The listener is a document CAPTURE listener registered when the canvas
 * mounts, i.e. before the editor's own. It must read the editing state before
 * the editor's `finish()` re-renders the canvas: React flushes that update in a
 * microtask between the two listeners, so a React handler would already see
 * "not editing". The selection itself is applied after the editor has finished,
 * so committing (or discarding) the text cannot overwrite it.
 */

import { useEffect, useRef, type RefObject } from "react";
import { selectionTargetAt, type HitCandidate } from "@/lib/customizer/v2/interaction/hit-test";

type Candidate = HitCandidate & { capabilities?: { selectable?: boolean } };

export function useSelectOnPressWhileEditing({
  surfaceRef,
  editingTextId,
  nodes,
  editingGroupId,
  scale,
  onSelect,
}: {
  surfaceRef: RefObject<HTMLElement | null>;
  editingTextId: string | null;
  nodes: readonly Candidate[];
  editingGroupId: string | null;
  scale: number;
  onSelect: (ids: string[]) => void;
}) {
  const latest = useRef({ editingTextId, nodes, editingGroupId, scale, onSelect });
  latest.current = { editingTextId, nodes, editingGroupId, scale, onSelect };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const current = latest.current;
      if (!current.editingTextId) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const surface = surfaceRef.current;
      const target = event.target;
      if (!surface || !(target instanceof Node) || !surface.contains(target)) return;
      const rect = surface.getBoundingClientRect();
      const scale = Math.max(Math.abs(current.scale), 1e-6);
      const selected = selectionTargetAt(
        (event.clientX - rect.left) / scale,
        (event.clientY - rect.top) / scale,
        current.nodes,
        { editingGroupId: current.editingGroupId, scale },
      );
      // A press inside the text being edited keeps editing it.
      if (selected === current.editingTextId) return;
      window.setTimeout(() => latest.current.onSelect(selected ? [selected] : []), 0);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [surfaceRef]);
}
