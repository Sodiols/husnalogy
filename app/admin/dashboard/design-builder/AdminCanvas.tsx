"use client";

// Interactive admin editing canvas. The base render is the SHARED renderer
// (CustomizerPreview) so what admin arranges is exactly what customers get.
// The overlay adds selection, drag, resize, rotation, snapping with alignment
// guides, and a live position/size readout.

import { useLayoutEffect, useRef, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import { layersForPage } from "./builder-utils";

const HANDLES: Array<{ id: string; cx: number; cy: number; cursor: string }> = [
  { id: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { id: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { id: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { id: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
];

const SNAP_PX = 8; // screen pixels

type Guide = { type: "v" | "h"; at: number };

export default function AdminCanvas({
  template,
  pageId,
  values = {},
  selectedLayerId,
  onSelect,
  onLayerChange,
  onBeginChange,
  zoom = 1,
  showSafeArea,
  showBleed,
  snapEnabled = true,
}: any) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const dragRef = useRef<any>(null);
  const [guides, setGuides] = useState<Guide[]>([]);

  const canvasW = template?.canvasWidthPx || 1500;
  const canvasH = template?.canvasHeightPx || 2100;

  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseWidth = Math.min(Math.max((containerWidth || 520) - 64, 260), 640);
  const displayW = baseWidth * zoom;
  const displayH = displayW * (canvasH / canvasW);
  const scale = displayW / canvasW;
  const snapTolerance = SNAP_PX / scale;

  const layers = layersForPage(template, pageId);

  // Snap targets: page centre, page edges, safe-area edges, other layer centres.
  const buildSnapTargets = (excludeId: string) => {
    const safe = template?.safeArea || {};
    const xs = [canvasW / 2, 0, canvasW, Number(safe.left || 0), canvasW - Number(safe.right || 0)];
    const ys = [canvasH / 2, 0, canvasH, Number(safe.top || 0), canvasH - Number(safe.bottom || 0)];
    layers.forEach((l: any) => {
      if (l.id === excludeId || l.hidden) return;
      xs.push(l.x);
      ys.push(l.y);
    });
    return { xs, ys };
  };

  const applySnap = (x: number, y: number, excludeId: string) => {
    if (!snapEnabled) return { x, y, guides: [] as Guide[] };
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

  const onLayerPointerDown = (e: React.PointerEvent, layer: any) => {
    e.stopPropagation();
    onSelect(layer.id);
    if (layer.locked || layer.adminEditable === false) return;
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
      shiftLock: false,
    };
  };

  const onRotatePointerDown = (e: React.PointerEvent, layer: any) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "rotate",
      layerId: layer.id,
      startRotation: Number(layer.rotation || 0),
      centerX: layer.x,
      centerY: layer.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.began) {
      drag.began = true;
      onBeginChange?.();
    }

    if (drag.mode === "rotate") {
      const rect = (wrapRef.current?.querySelector("[data-canvas-surface]") as HTMLElement)?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.left + drag.centerX * scale;
      const cy = rect.top + drag.centerY * scale;
      const angle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      let rotation = Math.round(angle);
      // Snap to 15° increments near them; Shift disables snapping.
      if (!e.shiftKey) {
        const nearest = Math.round(rotation / 15) * 15;
        if (Math.abs(rotation - nearest) <= 4) rotation = nearest;
      }
      rotation = ((rotation % 360) + 360) % 360;
      onLayerChange(drag.layerId, { rotation });
      return;
    }

    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;

    if (drag.mode === "move") {
      const snapped = applySnap(drag.startX + dx, drag.startY + dy, drag.layerId);
      setGuides(snapped.guides);
      onLayerChange(drag.layerId, { x: snapped.x, y: snapped.y });
      return;
    }

    // Resize anchoring the opposite corner. Shift keeps the aspect ratio.
    const left = drag.startX - drag.startW / 2;
    const top = drag.startY - drag.startH / 2;
    const right = drag.startX + drag.startW / 2;
    const bottom = drag.startY + drag.startH / 2;
    const min = 20;
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
    onLayerChange(drag.layerId, { x: Math.round(nl + w / 2), y: Math.round(nt + h / 2), width: w, height: h });
  };

  const endDrag = () => {
    dragRef.current = null;
    setGuides([]);
  };

  return (
    <div ref={wrapRef} className="flex h-full w-full items-start justify-center overflow-auto bg-[#F8F6F1] p-8">
      <div
        data-canvas-surface
        className="relative shrink-0 bg-white shadow-[0_10px_40px_rgba(48,56,57,0.12)]"
        style={{ width: displayW, height: displayH }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerDown={() => onSelect(null)}
      >
        {/* Base render (shared with the customer) */}
        <div className="pointer-events-none absolute inset-0">
          <CustomizerPreview template={template} values={values} page={pageId} showSafeArea={showSafeArea} showBleed={showBleed} />
        </div>

        {/* Alignment guides */}
        {guides.map((guide, index) =>
          guide.type === "v" ? (
            <span
              key={`g${index}`}
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-[#D4AF37]"
              style={{ left: guide.at * scale }}
            />
          ) : (
            <span
              key={`g${index}`}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 h-px bg-[#D4AF37]"
              style={{ top: guide.at * scale }}
            />
          ),
        )}

        {/* Interactive overlay */}
        {layers.map((layer: any) => {
          if (layer.hidden) return null;
          const boxLeft = (layer.x - layer.width / 2) * scale;
          const boxTop = (layer.y - layer.height / 2) * scale;
          const boxW = layer.width * scale;
          const boxH = layer.height * scale;
          const selected = layer.id === selectedLayerId;

          return (
            <div
              key={layer.id}
              data-canvas-layer={layer.id}
              onPointerDown={(e) => onLayerPointerDown(e, layer)}
              style={{
                position: "absolute",
                left: boxLeft,
                top: boxTop,
                width: boxW,
                height: boxH,
                transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                cursor: layer.locked ? "default" : "move",
                outline: selected ? "2px solid #303839" : "1px dashed rgba(48,56,57,0.22)",
                background: "transparent",
                touchAction: "none",
              }}
            >
              {selected && (
                <span className="pointer-events-none absolute -top-6 left-0 z-10 whitespace-nowrap rounded bg-[#303839] px-1.5 py-0.5 text-[9px] font-bold text-white">
                  {layer.locked ? "🔒 " : ""}
                  {layer.name} · {Math.round(layer.x)},{Math.round(layer.y)} · {Math.round(layer.width)}×{Math.round(layer.height)}
                  {layer.rotation ? ` · ${Math.round(layer.rotation)}°` : ""}
                </span>
              )}
              {selected && !layer.locked && (
                <>
                  {HANDLES.map((h) => (
                    <span
                      key={h.id}
                      data-canvas-handle={h.id}
                      onPointerDown={(e) => onHandlePointerDown(e, layer, h.id)}
                      style={{
                        position: "absolute",
                        left: `calc(${h.cx * 100}% - 5px)`,
                        top: `calc(${h.cy * 100}% - 5px)`,
                        width: 10,
                        height: 10,
                        background: "#fff",
                        border: "2px solid #303839",
                        borderRadius: 2,
                        cursor: h.cursor,
                        touchAction: "none",
                      }}
                    />
                  ))}
                  {/* Rotation handle */}
                  <span
                    onPointerDown={(e) => onRotatePointerDown(e, layer)}
                    title="Rotate"
                    style={{
                      position: "absolute",
                      left: "calc(50% - 6px)",
                      top: -26,
                      width: 12,
                      height: 12,
                      background: "#fff",
                      border: "2px solid #303839",
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
                      top: -14,
                      width: 1,
                      height: 14,
                      background: "rgba(48,56,57,0.4)",
                      pointerEvents: "none",
                    }}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
