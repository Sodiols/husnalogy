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
  selectedLayerId?: string | null;
  onSelectLayer?: (layerId: string | null) => void;
  onLayerTransform?: (layerId: string, patch: any, phase: "start" | "move") => void;
  // Crop mode: drag/zoom the photo INSIDE its fixed frame (spec §11).
  cropLayerId?: string | null;
  onImageTransform?: (layerId: string, patch: any, phase: "start" | "move") => void;
  cropGridSlotId?: string | null;
  onGridSlotTransform?: (layerId: string, slotId: string, patch: any, phase: "start" | "move") => void;
  onGridSlotSelect?: (layerId: string, slotId: string) => void;
  onGridSlotAssetDrop?: (layerId: string, slotId: string, asset: any) => void;
  onTextLayerActivate?: (layerId: string) => void;
  onImageLayerActivate?: (layerId: string) => void;
  previewMode?: boolean;
  showWatermark?: boolean;
  showSafeArea?: boolean;
  showBleed?: boolean;
  maxCanvasWidth?: number;
};

export default function CustomizerWorkspace({
  template,
  values,
  editorState,
  pageId,
  zoom = 1,
  selectedLayerId,
  onSelectLayer,
  onLayerTransform,
  cropLayerId = null,
  onImageTransform,
  cropGridSlotId = null,
  onGridSlotTransform,
  onGridSlotSelect,
  onGridSlotAssetDrop,
  onTextLayerActivate,
  onImageLayerActivate,
  previewMode = false,
  showWatermark = false,
  showSafeArea,
  showBleed,
  maxCanvasWidth = 620,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [guides, setGuides] = useState<Guide[]>([]);

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

  const padding = 32;
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
      : layers.filter((layer: any) => layer.isUserLayer || isLayerCustomerInteractive(layer));

  const canMove = (layer: any) => layer.isUserLayer || getLayerPermissions(layer).move;
  const canResize = (layer: any) => layer.isUserLayer || getLayerPermissions(layer).resize;
  const canRotate = (layer: any) => layer.isUserLayer || getLayerPermissions(layer).rotate;

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
    e.stopPropagation();
    onSelectLayer?.(layer.id);
    if (!canMove(layer)) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "move",
      layerId: layer.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: layer.x,
      startY: layer.y,
    };
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

    if (drag.mode === "rotate") {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + drag.centerX * scale;
      const cy = rect.top + drag.centerY * scale;
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

    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;

    if (drag.mode === "move") {
      const snapped = applySnap(drag.startX + dx, drag.startY + dy, drag.layerId);
      setGuides(snapped.guides);
      onLayerTransform?.(drag.layerId, { x: snapped.x, y: snapped.y }, "move");
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
    dragRef.current = null;
    setGuides([]);
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

  return (
    <div
      ref={wrapRef}
      className="flex h-full w-full items-start justify-center overflow-auto p-4 sm:p-8"
      onPointerDown={() => onSelectLayer?.(null)}
    >
      <div
        ref={surfaceRef}
        className="relative shrink-0 bg-white shadow-[0_10px_40px_rgba(48,56,57,0.12)]"
        style={{ width: displayW, height: displayH }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
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

        {/* Interaction overlay: only customer-editable layers. */}
        {interactiveLayers.map((layer: any) => {
          if (layer.hidden) return null;
          const boxLeft = (layer.x - layer.width / 2) * scale;
          const boxTop = (layer.y - layer.height / 2) * scale;
          const boxW = layer.width * scale;
          const boxH = layer.height * scale;
          const selected = layer.id === selectedLayerId;
          const movable = canMove(layer);
          const resizable = canResize(layer);
          const rotatable = canRotate(layer);
          const isText = layer.type === "text" || (layer.isUserLayer && layer.type !== "element");
          const isImage = layer.type === "image";

          return (
            <div
              key={layer.id}
              data-canvas-layer={layer.id}
              role="button"
              tabIndex={0}
              aria-label={`Edit ${layer.name || (isText ? "text" : "photo")}`}
              onPointerDown={(e) => onLayerPointerDown(e, layer)}
              onDoubleClick={() => {
                if (isText) onTextLayerActivate?.(layer.id);
                else if (isImage) onImageLayerActivate?.(layer.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectLayer?.(layer.id);
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
                      onSelectLayer?.(layer.id);
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
              {selected && resizable &&
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
              {selected && rotatable && (
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
