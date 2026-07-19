"use client";

// Central canvas of the customer customizer. The design itself is drawn by the
// shared CustomizerPreview renderer; a transparent overlay adds selection,
// drag, resize, rotation, snapping, and photo crop mode — but ONLY for layers
// the administrator made customer editable (plus the customer's own added
// layers). Locked and decorative layers never receive pointer interaction.

import { useLayoutEffect, useRef, useState } from "react";
import CustomizerPreview from "./CustomizerPreview";
import { getGridSlotRect, normalizeGridSlot } from "@/lib/customizer/v2/grids";
import { CustomizerWatermark } from "./CustomizerProtectionOverlay";
import {
  getEffectiveLayersForPage,
  getLayerPermissions,
  isLayerCustomerInteractive,
  type EditorState,
} from "./customizer-utils";
import { layersInsideSelection, selectionBounds } from "@/lib/customizer/v2/customer-actions";

const HANDLES: Array<{ id: string; cx: number; cy: number; cursor: string }> = [
  { id: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { id: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { id: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { id: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
];

const SNAP_PX = 8; // screen pixels

type Guide = { type: "v" | "h"; at: number };

type Props = {
  template: any;
  values: Record<string, any>;
  editorState: EditorState;
  pageId: string;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  selectedLayerId?: string | null;
  selectedLayerIds?: string[];
  onSelectLayer?: (layerId: string | null) => void;
  onSelectionChange?: (layerIds: string[]) => void;
  onLayerTransform?: (layerId: string, patch: any, phase: "start" | "move") => void;
  // Crop mode: drag/zoom the photo INSIDE its fixed frame (spec §11).
  cropLayerId?: string | null;
  onImageTransform?: (layerId: string, patch: any, phase: "start" | "move") => void;
  cropGridSlotId?: string | null;
  onGridSlotTransform?: (layerId: string, slotId: string, patch: any, phase: "start" | "move") => void;
  onGridSlotSelect?: (layerId: string, slotId: string) => void;
  onGridSlotAssetDrop?: (layerId: string, slotId: string, asset: any) => void;
  onElementDrop?: (element: any, position: { x: number; y: number }) => void;
  onTextLayerActivate?: (layerId: string) => void;
  onImageLayerActivate?: (layerId: string) => void;
  previewMode?: boolean;
  showWatermark?: boolean;
  showSafeArea?: boolean;
  showBleed?: boolean;
  maxCanvasWidth?: number;
  embedded?: boolean;
  interactionRotation?: number;
  editingGroupId?: string | null;
  onEnterGroup?: (groupId: string) => void;
};

export default function CustomizerWorkspace({
  template,
  values,
  editorState,
  pageId,
  zoom = 1,
  onZoomChange,
  selectedLayerId,
  selectedLayerIds,
  onSelectLayer,
  onSelectionChange,
  onLayerTransform,
  cropLayerId = null,
  onImageTransform,
  cropGridSlotId = null,
  onGridSlotTransform,
  onGridSlotSelect,
  onGridSlotAssetDrop,
  onElementDrop,
  onTextLayerActivate,
  onImageLayerActivate,
  previewMode = false,
  showWatermark = false,
  showSafeArea,
  showBleed,
  maxCanvasWidth = 620,
  embedded = false,
  interactionRotation = 0,
  editingGroupId = null,
  onEnterGroup,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const gestureRef = useRef<any>(null);
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const [containerWidth, setContainerWidth] = useState(0);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [selectionBox, setSelectionBox] = useState<null | { startX: number; startY: number; x: number; y: number; additive: boolean }>(null);

  const canvasW = template?.canvasWidthPx || 1500;
  const canvasH = template?.canvasHeightPx || 2100;
  const snappingEnabled = template?.settings?.snapping !== false;

  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padding = embedded ? 0 : 32;
  const baseWidth = Math.min(Math.max((containerWidth || 480) - padding * 2, 220), maxCanvasWidth);
  const displayW = baseWidth * zoom;
  const displayH = displayW * (canvasH / canvasW);
  const scale = displayW / canvasW;
  const snapTolerance = SNAP_PX / Math.max(scale, 1e-6);

  const layers = getEffectiveLayersForPage(template, pageId, editorState);
  const cropLayer = cropLayerId ? layers.find((layer: any) => layer.id === cropLayerId) : null;
  const cropGridLayer = cropGridSlotId ? layers.find((layer: any) => layer.type === "grid" && (layer.slots || []).some((slot: any) => slot.id === cropGridSlotId)) : null;
  const cropGridSlot = cropGridLayer ? normalizeGridSlot(cropGridLayer.slots.find((slot: any) => slot.id === cropGridSlotId)) : null;
  const cropGridRect = cropGridLayer && cropGridSlot ? getGridSlotRect(cropGridLayer, cropGridSlot) : null;
  const interactiveLayers = previewMode
    ? []
    : cropLayer
      ? [] // while cropping, the crop surface owns all interaction
      : cropGridLayer
        ? []
      : layers
        .filter((layer: any) => layer.isUserLayer || isLayerCustomerInteractive(layer))
        .filter((layer: any) => {
          if (layer.type === "group" && editingGroupId === layer.id) return false;
          if (layer.groupId && layer.groupId !== editingGroupId) {
            const parent = layers.find((candidate: any) => candidate.id === layer.groupId);
            if (parent && (parent.isUserLayer || isLayerCustomerInteractive(parent))) return false;
          }
          return true;
        });

  const activeSelection = selectedLayerIds?.length ? selectedLayerIds : selectedLayerId ? [selectedLayerId] : [];

  const isTransformLocked = (layer: any) => Boolean((layer.isUserLayer && layer.locked) || layer.customerLocked || layer.positionLocked || layer.customerInteractionDisabled);
  const canMove = (layer: any) => !isTransformLocked(layer) && (layer.isUserLayer || getLayerPermissions(layer).move);
  const canResize = (layer: any) => !isTransformLocked(layer) && (layer.isUserLayer || getLayerPermissions(layer).resize);
  const canRotate = (layer: any) => !isTransformLocked(layer) && (layer.isUserLayer || getLayerPermissions(layer).rotate);
  const selectedInteractiveLayers = interactiveLayers.filter((layer: any) => activeSelection.includes(layer.id));
  const multiBounds = activeSelection.length > 1 ? selectionBounds(selectedInteractiveLayers, activeSelection) : null;
  const multiCanResize = Boolean(multiBounds && selectedInteractiveLayers.length === activeSelection.length && selectedInteractiveLayers.every((layer: any) => canMove(layer) && canResize(layer)));
  const multiCanRotate = Boolean(multiBounds && selectedInteractiveLayers.length === activeSelection.length && selectedInteractiveLayers.every((layer: any) => canMove(layer) && canRotate(layer)));

  /* ---- snapping (canvas centre/edges, safe area, other object centres) ---- */
  const buildSnapTargets = (excludeId: string) => {
    const safe = template?.safeArea || {};
    const xs = [canvasW / 2, 0, canvasW, Number(safe.left || 0), canvasW - Number(safe.right || 0)];
    const ys = [canvasH / 2, 0, canvasH, Number(safe.top || 0), canvasH - Number(safe.bottom || 0)];
    layers.forEach((l: any) => {
      if (l.id === excludeId || l.hidden) return;
      xs.push(l.x, l.x - l.width / 2, l.x + l.width / 2);
      ys.push(l.y, l.y - l.height / 2, l.y + l.height / 2);
    });
    return { xs, ys };
  };

  const applySnap = (x: number, y: number, excludeId: string) => {
    if (!snappingEnabled) return { x: Math.round(x), y: Math.round(y), guides: [] as Guide[] };
    const { xs, ys } = buildSnapTargets(excludeId);
    let outX = x;
    let outY = y;
    const activeGuides: Guide[] = [];
    let bestDx = snapTolerance;
    xs.forEach((target) => {
      const d = Math.abs(x - target);
      if (d < bestDx) {
        bestDx = d;
        outX = target;
      }
    });
    if (outX !== x) activeGuides.push({ type: "v", at: outX });
    let bestDy = snapTolerance;
    ys.forEach((target) => {
      const d = Math.abs(y - target);
      if (d < bestDy) {
        bestDy = d;
        outY = target;
      }
    });
    if (outY !== y) activeGuides.push({ type: "h", at: outY });
    return { x: Math.round(outX), y: Math.round(outY), guides: activeGuides };
  };

  /* ---- pointer interactions ---- */
  const onLayerPointerDown = (e: React.PointerEvent, layer: any) => {
    if (gestureRef.current) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const nextSelection = additive
      ? activeSelection.includes(layer.id) ? activeSelection.filter((id) => id !== layer.id) : [...activeSelection, layer.id]
      : activeSelection.includes(layer.id) && activeSelection.length > 1 ? activeSelection : [layer.id];
    if (onSelectionChange) onSelectionChange(nextSelection);
    else onSelectLayer?.(nextSelection[nextSelection.length - 1] || null);
    if (!nextSelection.includes(layer.id)) return;
    if (!canMove(layer)) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "move",
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: layer.x,
      startY: layer.y,
      selected: nextSelection.filter((id) => {
        const item = interactiveLayers.find((candidate: any) => candidate.id === id);
        return item && canMove(item);
      }).map((id) => {
        const item = interactiveLayers.find((candidate: any) => candidate.id === id);
        return { id, x: item.x, y: item.y };
      }),
    };
  };

  const onSurfacePointerDown = (e: React.PointerEvent) => {
    if (gestureRef.current) return;
    if (previewMode || cropLayer || cropGridLayer || e.button !== 0) return;
    if (e.target !== surfaceRef.current) return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) {
      if (onSelectionChange) onSelectionChange([]);
      else onSelectLayer?.(null);
    }
    setSelectionBox({ startX: x, startY: y, x, y, additive });
    dragRef.current = { mode: "marquee" };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onHandlePointerDown = (e: React.PointerEvent, layer: any, handle: string) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "resize",
      handle,
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: layer.x,
      startY: layer.y,
      startW: layer.width,
      startH: layer.height,
    };
  };

  const onRotatePointerDown = (e: React.PointerEvent, layer: any) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "rotate",
      layerId: layer.id,
      centerX: layer.x,
      centerY: layer.y,
    };
  };

  const onMultiHandlePointerDown = (e: React.PointerEvent, handle: string) => {
    if (!multiBounds || !multiCanResize) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "multi-resize",
      handle,
      layerId: selectedInteractiveLayers[0]?.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      bounds: multiBounds,
      selected: selectedInteractiveLayers.map((layer: any) => ({ id: layer.id, x: layer.x, y: layer.y, width: layer.width, height: layer.height })),
    };
  };

  const onMultiRotatePointerDown = (e: React.PointerEvent) => {
    if (!multiBounds || !multiCanRotate) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerClientX = rect.left + multiBounds.x * scale;
    const centerClientY = rect.top + multiBounds.y * scale;
    dragRef.current = {
      mode: "multi-rotate",
      layerId: selectedInteractiveLayers[0]?.id,
      centerX: multiBounds.x,
      centerY: multiBounds.y,
      startAngle: Math.atan2(e.clientY - centerClientY, e.clientX - centerClientX),
      selected: selectedInteractiveLayers.map((layer: any) => ({ id: layer.id, x: layer.x, y: layer.y, rotation: Number(layer.rotation) || 0 })),
    };
  };

  const onCropPointerDown = (e: React.PointerEvent, layer: any) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const transform = layer.imageTransform || {};
    dragRef.current = {
      mode: "crop-pan",
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: Number(transform.offsetX) || 0,
      startOffsetY: Number(transform.offsetY) || 0,
    };
  };

  const onGridCropPointerDown = (e: React.PointerEvent, layer: any, slot: any) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "grid-crop-pan",
      layerId: layer.id,
      slotId: slot.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: Number(slot.transform?.offsetX) || 0,
      startOffsetY: Number(slot.transform?.offsetY) || 0,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === "marquee") {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSelectionBox((current) => current ? { ...current, x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale } : current);
      return;
    }
    if (!drag.began) {
      drag.began = true;
      if (drag.mode === "crop-pan") onImageTransform?.(drag.layerId, {}, "start");
      else if (drag.mode === "grid-crop-pan") onGridSlotTransform?.(drag.layerId, drag.slotId, {}, "start");
      else onLayerTransform?.(drag.layerId, {}, "start");
    }

    if (drag.mode === "crop-pan") {
      const dx = (e.clientX - drag.startClientX) / scale;
      const dy = (e.clientY - drag.startClientY) / scale;
      onImageTransform?.(
        drag.layerId,
        { offsetX: Math.round(drag.startOffsetX + dx), offsetY: Math.round(drag.startOffsetY + dy) },
        "move",
      );
      return;
    }
    if (drag.mode === "grid-crop-pan") {
      const dx = (e.clientX - drag.startClientX) / scale;
      const dy = (e.clientY - drag.startClientY) / scale;
      onGridSlotTransform?.(drag.layerId, drag.slotId, { offsetX: Math.round(drag.startOffsetX + dx), offsetY: Math.round(drag.startOffsetY + dy) }, "move");
      return;
    }

    if (drag.mode === "rotate" || drag.mode === "multi-rotate") {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + drag.centerX * scale;
      const cy = rect.top + drag.centerY * scale;
      if (drag.mode === "multi-rotate") {
        const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
        let delta = ((currentAngle - drag.startAngle) * 180) / Math.PI;
        if (!e.shiftKey) delta = Math.round(delta / 15) * 15;
        const radians = (delta * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        drag.selected.forEach((item: any) => {
          const dx = item.x - drag.centerX;
          const dy = item.y - drag.centerY;
          onLayerTransform?.(item.id, {
            x: Math.round(drag.centerX + dx * cos - dy * sin),
            y: Math.round(drag.centerY + dx * sin + dy * cos),
            rotation: ((Math.round(item.rotation + delta) % 360) + 360) % 360,
          }, "move");
        });
        return;
      }
      const angle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      let rotation = Math.round(angle);
      // Snap near 15° increments; hold Shift for free rotation.
      if (!e.shiftKey) {
        const nearest = Math.round(rotation / 15) * 15;
        if (Math.abs(rotation - nearest) <= 4) rotation = nearest;
      }
      rotation = ((rotation % 360) + 360) % 360;
      onLayerTransform?.(drag.layerId, { rotation }, "move");
      return;
    }

    const rawDx = (e.clientX - drag.startClientX) / scale;
    const rawDy = (e.clientY - drag.startClientY) / scale;
    const radians = (-interactionRotation * Math.PI) / 180;
    const dx = rawDx * Math.cos(radians) - rawDy * Math.sin(radians);
    const dy = rawDx * Math.sin(radians) + rawDy * Math.cos(radians);

    if (drag.mode === "move") {
      const snapped = applySnap(drag.startX + dx, drag.startY + dy, drag.layerId);
      setGuides(snapped.guides);
      const selected = Array.isArray(drag.selected) && drag.selected.length ? drag.selected : [{ id: drag.layerId, x: drag.startX, y: drag.startY }];
      selected.forEach((item: any) => {
        if (item.id === drag.layerId) onLayerTransform?.(item.id, { x: snapped.x, y: snapped.y }, "move");
        else onLayerTransform?.(item.id, { x: Math.round(item.x + dx), y: Math.round(item.y + dy) }, "move");
      });
      return;
    }

    if (drag.mode === "multi-resize") {
      const start = drag.bounds;
      const min = 24;
      let left = start.left, top = start.top, right = start.right, bottom = start.bottom;
      if (drag.handle.includes("w")) left = Math.min(start.left + dx, start.right - min);
      if (drag.handle.includes("e")) right = Math.max(start.right + dx, start.left + min);
      if (drag.handle.includes("n")) top = Math.min(start.top + dy, start.bottom - min);
      if (drag.handle.includes("s")) bottom = Math.max(start.bottom + dy, start.top + min);
      let width = right - left;
      let height = bottom - top;
      if (e.shiftKey) {
        const scaleFactor = Math.max(width / start.width, height / start.height);
        width = start.width * scaleFactor;
        height = start.height * scaleFactor;
        if (drag.handle.includes("w")) left = right - width; else right = left + width;
        if (drag.handle.includes("n")) top = bottom - height; else bottom = top + height;
      }
      const scaleX = width / start.width;
      const scaleY = height / start.height;
      drag.selected.forEach((item: any) => {
        onLayerTransform?.(item.id, {
          x: Math.round(left + (item.x - start.left) * scaleX),
          y: Math.round(top + (item.y - start.top) * scaleY),
          width: Math.max(1, Math.round(item.width * scaleX)),
          height: Math.max(1, Math.round(item.height * scaleY)),
        }, "move");
      });
      return;
    }

    // Resize anchored to the opposite corner; Shift keeps aspect ratio.
    const left = drag.startX - drag.startW / 2;
    const top = drag.startY - drag.startH / 2;
    const right = drag.startX + drag.startW / 2;
    const bottom = drag.startY + drag.startH / 2;
    const min = 24;
    let nl = left, nt = top, nr = right, nb = bottom;
    if (drag.handle.includes("w")) nl = Math.min(left + dx, right - min);
    if (drag.handle.includes("e")) nr = Math.max(right + dx, left + min);
    if (drag.handle.includes("n")) nt = Math.min(top + dy, bottom - min);
    if (drag.handle.includes("s")) nb = Math.max(bottom + dy, top + min);
    let w = Math.round(nr - nl);
    let h = Math.round(nb - nt);
    if (e.shiftKey && drag.startW > 0 && drag.startH > 0) {
      const ratio = drag.startW / drag.startH;
      if (w / h > ratio) w = Math.round(h * ratio);
      else h = Math.round(w / ratio);
      if (drag.handle.includes("w")) nl = nr - w;
      else nr = nl + w;
      if (drag.handle.includes("n")) nt = nb - h;
      else nb = nt + h;
    }
    onLayerTransform?.(
      drag.layerId,
      { x: Math.round(nl + w / 2), y: Math.round(nt + h / 2), width: w, height: h },
      "move",
    );
  };

  const endDrag = () => {
    if (dragRef.current?.mode === "marquee" && selectionBox) {
      const found = layersInsideSelection({ left: selectionBox.startX, top: selectionBox.startY, right: selectionBox.x, bottom: selectionBox.y }, interactiveLayers);
      const next = selectionBox.additive ? Array.from(new Set([...activeSelection, ...found])) : found;
      if (onSelectionChange) onSelectionChange(next);
      else onSelectLayer?.(next[next.length - 1] || null);
    }
    dragRef.current = null;
    setGuides([]);
    setSelectionBox(null);
  };

  // Wheel zoom while cropping (spec §11).
  const onCropWheel = (e: React.WheelEvent, layer: any) => {
    e.preventDefault();
    e.stopPropagation();
    const transform = layer.imageTransform || {};
    const current = Number(transform.zoom) > 0 ? Number(transform.zoom) : 1;
    const next = Math.min(8, Math.max(1, current * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    onImageTransform?.(layer.id, { zoom: Number(next.toFixed(3)) }, "move");
  };

  const onGridCropWheel = (e: React.WheelEvent, layer: any, slot: any) => {
    e.preventDefault();
    e.stopPropagation();
    const current = Number(slot.transform?.zoom) > 0 ? Number(slot.transform.zoom) : 1;
    const next = Math.min(8, Math.max(1, current * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    onGridSlotTransform?.(layer.id, slot.id, { zoom: Number(next.toFixed(3)) }, "move");
  };

  const onGesturePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointsRef.current.size !== 2) return;
    const [first, second] = [...touchPointsRef.current.values()];
    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;
    gestureRef.current = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      centerX,
      centerY,
      zoom,
      cropZoom: Number(cropLayer?.imageTransform?.zoom) || 1,
      gridZoom: Number(cropGridSlot?.transform?.zoom) || 1,
      scrollLeft: wrapRef.current?.scrollLeft || 0,
      scrollTop: wrapRef.current?.scrollTop || 0,
    };
    dragRef.current = null;
    setSelectionBox(null);
    if (cropLayer) onImageTransform?.(cropLayer.id, {}, "start");
    if (cropGridLayer && cropGridSlot) onGridSlotTransform?.(cropGridLayer.id, cropGridSlot.id, {}, "start");
  };

  const onGesturePointerMove = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch" || !touchPointsRef.current.has(event.pointerId)) return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (!gesture || touchPointsRef.current.size < 2) return;
    event.preventDefault();
    const [first, second] = [...touchPointsRef.current.values()];
    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    const ratio = distance / Math.max(1, gesture.distance);
    const centerX = (first.x + second.x) / 2;
    const centerY = (first.y + second.y) / 2;
    if (cropLayer) {
      onImageTransform?.(cropLayer.id, { zoom: Number(Math.min(8, Math.max(1, gesture.cropZoom * ratio)).toFixed(3)) }, "move");
    } else if (cropGridLayer && cropGridSlot) {
      onGridSlotTransform?.(cropGridLayer.id, cropGridSlot.id, { zoom: Number(Math.min(8, Math.max(1, gesture.gridZoom * ratio)).toFixed(3)) }, "move");
    } else {
      onZoomChange?.(Math.min(3, Math.max(0.35, gesture.zoom * ratio)));
      if (wrapRef.current) {
        wrapRef.current.scrollLeft = gesture.scrollLeft - (centerX - gesture.centerX);
        wrapRef.current.scrollTop = gesture.scrollTop - (centerY - gesture.centerY);
      }
    }
  };

  const onGesturePointerUp = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    touchPointsRef.current.delete(event.pointerId);
    if (touchPointsRef.current.size < 2) gestureRef.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className={embedded ? "flex h-full w-full items-start justify-center overflow-hidden" : "flex h-full w-full items-start justify-center overflow-auto p-4 sm:p-8"}
    >
      <div
        ref={surfaceRef}
        className="relative shrink-0 bg-white shadow-[0_10px_40px_rgba(48,56,57,0.12)]"
        style={{ width: displayW, height: displayH, touchAction: "none" }}
        onPointerDownCapture={onGesturePointerDown}
        onPointerMoveCapture={onGesturePointerMove}
        onPointerUpCapture={onGesturePointerUp}
        onPointerCancelCapture={onGesturePointerUp}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerDown={onSurfacePointerDown}
        onPointerCancel={endDrag}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-husnalogy-element")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("application/x-husnalogy-element")) return;
          event.preventDefault();
          try {
            const element = JSON.parse(event.dataTransfer.getData("application/x-husnalogy-element"));
            const rect = surfaceRef.current?.getBoundingClientRect();
            if (!rect) return;
            onElementDrop?.(element, { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale });
          } catch {
            // Ignore malformed external drag payloads.
          }
        }}
      >
        {/* Shared renderer — identical output to thumbnails, review, exports. */}
        <div className="pointer-events-none absolute inset-0">
          <CustomizerPreview
            template={template}
            values={values}
            editorState={editorState}
            page={pageId}
            showSafeArea={previewMode ? false : showSafeArea}
            showBleed={previewMode ? false : showBleed}
          />
        </div>

        {showWatermark && <CustomizerWatermark />}

        {/* Alignment guides while dragging */}
        {guides.map((guide, index) =>
          guide.type === "v" ? (
            <span
              key={`g${index}`}
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-40 w-px bg-[#D4AF37]"
              style={{ left: guide.at * scale }}
            />
          ) : (
            <span
              key={`g${index}`}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 z-40 h-px bg-[#D4AF37]"
              style={{ top: guide.at * scale }}
            />
          ),
        )}

        {selectionBox && (
          <span aria-hidden className="pointer-events-none absolute z-50 border border-[#D4AF37] bg-[#D4AF37]/10" style={{ left: Math.min(selectionBox.startX, selectionBox.x) * scale, top: Math.min(selectionBox.startY, selectionBox.y) * scale, width: Math.abs(selectionBox.x - selectionBox.startX) * scale, height: Math.abs(selectionBox.y - selectionBox.startY) * scale }} />
        )}

        {/* Crop mode surface: frame stays fixed, photo pans/zooms inside. */}
        {cropLayer && (
          <>
            <div className="pointer-events-none absolute inset-0 z-30 bg-[#303839]/25" aria-hidden />
            <div
              role="application"
              aria-label="Crop photo — drag to reposition, scroll to zoom"
              onPointerDown={(e) => onCropPointerDown(e, cropLayer)}
              onWheel={(e) => onCropWheel(e, cropLayer)}
              className="absolute z-40 cursor-grab active:cursor-grabbing"
              style={{
                left: (cropLayer.x - cropLayer.width / 2) * scale,
                top: (cropLayer.y - cropLayer.height / 2) * scale,
                width: cropLayer.width * scale,
                height: cropLayer.height * scale,
                transform: cropLayer.rotation ? `rotate(${cropLayer.rotation}deg)` : undefined,
                outline: "2px solid #D4AF37",
                outlineOffset: 2,
                boxShadow: "0 0 0 9999px rgba(48,56,57,0.0)",
                touchAction: "none",
                background: "transparent",
              }}
            >
              {/* Rule-of-thirds grid */}
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/70" />
            </div>
          </>
        )}

        {cropGridLayer && cropGridSlot && cropGridRect && (
          <>
            <div className="pointer-events-none absolute inset-0 z-30 bg-[#303839]/25" aria-hidden />
            <div
              role="application"
              aria-label="Crop grid photo — drag to reposition, scroll to zoom"
              onPointerDown={(event) => onGridCropPointerDown(event, cropGridLayer, cropGridSlot)}
              onWheel={(event) => onGridCropWheel(event, cropGridLayer, cropGridSlot)}
              className="absolute z-40 cursor-grab outline outline-2 outline-[#D4AF37] active:cursor-grabbing"
              style={{
                left: cropGridRect.x * scale,
                top: cropGridRect.y * scale,
                width: cropGridRect.width * scale,
                height: cropGridRect.height * scale,
                transform: cropGridLayer.rotation ? `rotate(${cropGridLayer.rotation}deg)` : undefined,
                transformOrigin: `${(cropGridLayer.x - cropGridRect.x) * scale}px ${(cropGridLayer.y - cropGridRect.y) * scale}px`,
                touchAction: "none",
              }}
            >
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/70" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/70" />
            </div>
          </>
        )}

        {multiBounds && (
          <div
            aria-label={`${activeSelection.length} selected objects`}
            className="pointer-events-none absolute z-[45] border-2 border-[#D4AF37]"
            style={{
              left: multiBounds.left * scale,
              top: multiBounds.top * scale,
              width: multiBounds.width * scale,
              height: multiBounds.height * scale,
            }}
          >
            {multiCanResize && HANDLES.map((handle) => (
              <span
                key={`multi-${handle.id}`}
                role="slider"
                aria-label={`Resize ${activeSelection.length} selected objects from ${handle.id}`}
                aria-valuenow={Math.round(multiBounds.width)}
                aria-valuemin={24}
                onPointerDown={(event) => onMultiHandlePointerDown(event, handle.id)}
                className="pointer-events-auto absolute h-[18px] w-[18px] rounded border-2 border-[#D4AF37] bg-white shadow-sm"
                style={{ left: `calc(${handle.cx * 100}% - 9px)`, top: `calc(${handle.cy * 100}% - 9px)`, cursor: handle.cursor, touchAction: "none" }}
              />
            ))}
            {multiCanRotate && (
              <>
                <span
                  role="slider"
                  aria-label={`Rotate ${activeSelection.length} selected objects`}
                  aria-valuenow={0}
                  aria-valuemin={0}
                  aria-valuemax={359}
                  onPointerDown={onMultiRotatePointerDown}
                  className="pointer-events-auto absolute -top-11 left-1/2 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-[#D4AF37] bg-white shadow-sm"
                  style={{ cursor: "grab", touchAction: "none" }}
                />
                <span aria-hidden className="absolute -top-6 left-1/2 h-6 w-px bg-[#D4AF37]" />
              </>
            )}
          </div>
        )}

        {/* Interaction overlay: only customer-editable layers. */}
        {interactiveLayers.map((layer: any) => {
          if (layer.hidden) return null;
          const boxLeft = (layer.x - layer.width / 2) * scale;
          const boxTop = (layer.y - layer.height / 2) * scale;
          const boxW = layer.width * scale;
          const boxH = layer.height * scale;
          const selected = activeSelection.includes(layer.id);
          const movable = canMove(layer);
          const resizable = canResize(layer);
          const rotatable = canRotate(layer);
          const isText = layer.type === "text";
          const isImage = layer.type === "image" || layer.type === "frame";

          return (
            <div
              key={layer.id}
              data-canvas-layer={layer.id}
              role="button"
              tabIndex={0}
              aria-label={`Edit ${layer.name || (isText ? "text" : "photo")}`}
              onPointerDown={(e) => onLayerPointerDown(e, layer)}
              onDoubleClick={() => {
                if (layer.type === "group") onEnterGroup?.(layer.id);
                else if (isText) onTextLayerActivate?.(layer.id);
                else if (isImage) onImageLayerActivate?.(layer.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (e.key === "Enter" && layer.type === "group") {
                    onEnterGroup?.(layer.id);
                    return;
                  }
                  if (onSelectionChange) onSelectionChange([layer.id]);
                  else onSelectLayer?.(layer.id);
                }
              }}
              className="absolute outline-none"
              style={{
                left: boxLeft,
                top: boxTop,
                width: boxW,
                height: boxH,
                transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                cursor: movable ? "move" : "pointer",
                outline: selected ? "2px solid #D4AF37" : "1px solid transparent",
                outlineOffset: 1,
                touchAction: "none",
                zIndex: 30,
              }}
            >
              {layer.type === "grid" && (layer.slots || []).map((rawSlot: any, index: number) => {
                const slot = normalizeGridSlot(rawSlot, index);
                const rect = getGridSlotRect(layer, slot);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    aria-label={`Select photo grid slot ${index + 1}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (onSelectionChange) onSelectionChange([layer.id]);
                      else onSelectLayer?.(layer.id);
                      onGridSlotSelect?.(layer.id, slot.id);
                    }}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes("application/x-husnalogy-photo")) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      try {
                        const asset = JSON.parse(event.dataTransfer.getData("application/x-husnalogy-photo"));
                        onGridSlotAssetDrop?.(layer.id, slot.id, asset);
                        onGridSlotSelect?.(layer.id, slot.id);
                      } catch {
                        // Ignore malformed external drag payloads.
                      }
                    }}
                    className="absolute cursor-pointer border border-transparent bg-transparent hover:border-[#D4AF37]/70 focus-visible:border-[#D4AF37] focus-visible:outline-none"
                    style={{
                      left: (rect.x - (layer.x - layer.width / 2)) * scale,
                      top: (rect.y - (layer.y - layer.height / 2)) * scale,
                      width: rect.width * scale,
                      height: rect.height * scale,
                    }}
                  />
                );
              })}
              {selected && activeSelection.length === 1 && resizable &&
                HANDLES.map((h) => (
                  <span
                    key={h.id}
                    onPointerDown={(e) => onHandlePointerDown(e, layer, h.id)}
                    style={{
                      position: "absolute",
                      left: `calc(${h.cx * 100}% - 6px)`,
                      top: `calc(${h.cy * 100}% - 6px)`,
                      width: 12,
                      height: 12,
                      background: "#ffffff",
                      border: "2px solid #D4AF37",
                      borderRadius: 2,
                      cursor: h.cursor,
                      touchAction: "none",
                    }}
                  />
                ))}
              {selected && activeSelection.length === 1 && rotatable && (
                <>
                  <span
                    onPointerDown={(e) => onRotatePointerDown(e, layer)}
                    role="slider"
                    aria-label="Rotate"
                    aria-valuenow={Math.round(Number(layer.rotation) || 0)}
                    aria-valuemin={0}
                    aria-valuemax={359}
                    title="Rotate (hold Shift for free rotation)"
                    style={{
                      position: "absolute",
                      left: "calc(50% - 7px)",
                      top: -30,
                      width: 14,
                      height: 14,
                      background: "#ffffff",
                      border: "2px solid #D4AF37",
                      borderRadius: "50%",
                      cursor: "grab",
                      touchAction: "none",
                    }}
                  />
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: "calc(50% - 0.5px)",
                      top: -16,
                      width: 1,
                      height: 16,
                      background: "rgba(212,175,55,0.7)",
                      pointerEvents: "none",
                    }}
                  />
                </>
              )}
              {selected && Number(layer.rotation || 0) !== 0 && (
                <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#303839] px-1.5 py-0.5 text-[9px] font-bold text-white">
                  {Math.round(layer.rotation)}°
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
