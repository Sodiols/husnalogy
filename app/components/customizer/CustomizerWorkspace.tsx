"use client";

// Central canvas of the customer customizer. The design itself is drawn by the
// shared CustomizerPreview renderer; a transparent overlay adds selection,
// drag, and resize — but ONLY for layers the administrator made customer
// editable (plus the customer's own added text). Locked and decorative layers
// never receive pointer interaction.

import { useLayoutEffect, useRef, useState } from "react";
import CustomizerPreview from "./CustomizerPreview";
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

type Props = {
  template: any;
  values: Record<string, any>;
  editorState: EditorState;
  pageId: string;
  zoom?: number;
  selectedLayerId?: string | null;
  onSelectLayer?: (layerId: string | null) => void;
  onLayerTransform?: (layerId: string, patch: any, phase: "start" | "move") => void;
  onTextLayerActivate?: (layerId: string) => void;
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
  onTextLayerActivate,
  previewMode = false,
  showWatermark = false,
  showSafeArea,
  showBleed,
  maxCanvasWidth = 620,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const [containerWidth, setContainerWidth] = useState(0);

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

  const padding = 32;
  const baseWidth = Math.min(Math.max((containerWidth || 480) - padding * 2, 220), maxCanvasWidth);
  const displayW = baseWidth * zoom;
  const displayH = displayW * (canvasH / canvasW);
  const scale = displayW / canvasW;

  const layers = getEffectiveLayersForPage(template, pageId, editorState);
  const interactiveLayers = previewMode
    ? []
    : layers.filter((layer: any) => layer.isUserLayer || isLayerCustomerInteractive(layer));

  const canMove = (layer: any) => layer.isUserLayer || getLayerPermissions(layer).move;
  const canResize = (layer: any) => layer.isUserLayer || getLayerPermissions(layer).resize;

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

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.began) {
      drag.began = true;
      onLayerTransform?.(drag.layerId, {}, "start");
    }
    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;

    if (drag.mode === "move") {
      onLayerTransform?.(
        drag.layerId,
        { x: Math.round(drag.startX + dx), y: Math.round(drag.startY + dy) },
        "move",
      );
      return;
    }

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
    const w = Math.round(nr - nl);
    const h = Math.round(nb - nt);
    onLayerTransform?.(
      drag.layerId,
      { x: Math.round(nl + w / 2), y: Math.round(nt + h / 2), width: w, height: h },
      "move",
    );
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className="flex h-full w-full items-start justify-center overflow-auto p-4 sm:p-8"
      onPointerDown={() => onSelectLayer?.(null)}
    >
      <div
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
          const isText = layer.type === "text" || layer.isUserLayer;

          return (
            <div
              key={layer.id}
              data-canvas-layer={layer.id}
              role="button"
              tabIndex={0}
              aria-label={`Edit ${layer.name || (isText ? "text" : "photo")}`}
              onPointerDown={(e) => onLayerPointerDown(e, layer)}
              onDoubleClick={() => isText && onTextLayerActivate?.(layer.id)}
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
              {selected && resizable &&
                HANDLES.map((h) => (
                  <span
                    key={h.id}
                    onPointerDown={(e) => onHandlePointerDown(e, layer, h.id)}
                    style={{
                      position: "absolute",
                      left: `calc(${h.cx * 100}% - 5px)`,
                      top: `calc(${h.cy * 100}% - 5px)`,
                      width: 10,
                      height: 10,
                      background: "#ffffff",
                      border: "2px solid #D4AF37",
                      borderRadius: 2,
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
