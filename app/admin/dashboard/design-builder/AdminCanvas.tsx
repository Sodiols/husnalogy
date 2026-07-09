"use client";

// Interactive editing canvas. The base is the SHARED SVG renderer
// (CustomizerPreview) so what admin arranges is exactly what the customer sees.
// A transparent overlay adds selection, drag, and resize on top.

import { useLayoutEffect, useRef, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import { layersForPage } from "./builder-utils";

const HANDLES: Array<{ id: string; cx: number; cy: number; cursor: string }> = [
  { id: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { id: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { id: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { id: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
];

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
}: any) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const dragRef = useRef<any>(null);

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

  const baseWidth = Math.min(containerWidth || 480, 560);
  const displayW = baseWidth * zoom;
  const displayH = displayW * (canvasH / canvasW);
  const scale = displayW / canvasW;

  const layers = layersForPage(template, pageId);

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
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Take exactly one history snapshot at the start of a real drag/resize.
    if (!drag.began) {
      drag.began = true;
      onBeginChange?.();
    }
    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;

    if (drag.mode === "move") {
      onLayerChange(drag.layerId, { x: Math.round(drag.startX + dx), y: Math.round(drag.startY + dy) });
      return;
    }

    // Resize anchoring the opposite corner.
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
    const w = Math.round(nr - nl);
    const h = Math.round(nb - nt);
    onLayerChange(drag.layerId, { x: Math.round(nl + w / 2), y: Math.round(nt + h / 2), width: w, height: h });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div ref={wrapRef} className="flex w-full justify-center overflow-auto bg-[#F8F8F8] p-4">
      <div
        className="relative shrink-0 bg-white shadow-sm"
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
                outline: selected ? "2px solid #111111" : "1px dashed rgba(48,56,57,0.25)",
                background: "transparent",
                touchAction: "none",
              }}
            >
              {layer.locked && selected && (
                <span className="absolute -top-5 left-0 bg-[#111111] px-1 text-[9px] font-bold text-white">Locked</span>
              )}
              {selected && !layer.locked &&
                HANDLES.map((h) => (
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
                      border: "2px solid #111111",
                      cursor: h.cursor,
                      touchAction: "none",
                    }}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
