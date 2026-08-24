"use client";

// Reusable SVG renderer for a single customizer page. Used identically in the
// admin setup preview and the customer customizer so what admin sees is what
// the customer gets. Customers cannot move design elements here — this only
// renders; interaction lives in the parent panels.
//
// V2: mask paths (incl. true arch shapes) come from the shared generator in
// lib/customizer/v2/masks, and text uses the shared layout service in
// lib/customizer/v2/text-layout — the same code the server renderer runs, so
// editor, thumbnails, review, previews, and print files all break lines and
// clip photos identically.

import { useEffect, useMemo, useState } from "react";
import { getLegacyMaskPath, getMaskPath } from "@/lib/customizer/v2/masks";
import { getGridSlotRect, normalizeGridSlot } from "@/lib/customizer/v2/grids";
import { DEFAULT_LINE_HEIGHT, layoutText, createCanvasMeasure, fallbackMeasure, resolveTextBox, type MeasureFn } from "@/lib/customizer/v2/text-layout";
import { hasImageFilters, imageFilterSvgPrimitives } from "@/lib/customizer/v2/image-filters";
import { resolveImageDrawBoxFromTransform } from "@/lib/customizer/v2/image-crop";
import { normalizeQRCodeStyle, qrModuleRects } from "@/lib/customizer/v2/qr";
import {
  applyGeometryOverrides,
  getEffectiveLayersForPage,
  getFieldById,
  getPageById,
  resolveLayerImage,
  resolveLayerText,
  type EditorState,
} from "./customizer-utils";
import { useGoogleFontMetricsRevision } from "./useGoogleFonts";

type Props = {
  template: any;
  values?: Record<string, any>;
  page?: string;
  showSafeArea?: boolean;
  showBleed?: boolean;
  className?: string;
  svgRef?: React.Ref<SVGSVGElement>;
  background?: string;
  // Customer edits (style/transform overrides + added text layers). The same
  // design data renders identically in the editor, thumbnails, review, and
  // exports because they all pass the same editorState here.
  editorState?: EditorState | null;
  hiddenLayerIds?: string[];
  /**
   * Transient geometry for layers being transformed right now, keyed by layer
   * id (spec: live resize/rotation must be accurate, not approximated).
   *
   * A resize is previewed by re-rendering the affected layers at their real
   * in-progress geometry rather than by scaling the drawn result. That matters
   * because scaling is only faithful for a uniform corner drag: dragging a side
   * handle stretches glyphs and squashes photos, so the customer would watch a
   * distorted object that "corrected itself" on release. Feeding real values
   * through the real renderer means text re-wraps and images re-fit live, and
   * what is on screen mid-gesture is exactly what lands in the document.
   *
   * These never touch the document, history or autosave — they are cleared the
   * moment the gesture ends.
   */
  geometryOverrides?: Record<string, Record<string, any>> | null;
};

let sharedMeasure: MeasureFn | null = null;
function getMeasure(): MeasureFn {
  if (!sharedMeasure) {
    sharedMeasure = typeof document === "undefined" ? fallbackMeasure : createCanvasMeasure();
  }
  return sharedMeasure;
}

// Re-render once webfonts finish loading so measured line wrapping is exact
// (spec §9: wait for document.fonts.ready before measuring).
function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (typeof document !== "undefined" && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => {
        if (!cancelled) setReady(true);
      });
    } else {
      setReady(true);
    }
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

function TextLayer({ layer, field, values, fontsReady, idPrefix, safeBounds }: any) {
  const style = layer.textStyle || {};
  const text = resolveLayerText(layer, field, values);
  const fontSize = Number(style.fontSize) || 48;

  const isPlaceholder =
    field && (values[field.id] === undefined || values[field.id] === "" || values[field.id] === null) && !field.defaultValue;
  // SSR and the first client hydration pass must use the same deterministic
  // fallback metrics. Once fonts are ready, switch both layout calculations
  // to the real canvas measurer in one normal client re-render.
  const measure = fontsReady ? getMeasure() : fallbackMeasure;

  // Auto-width layers take their box from the measured content, not the stored
  // width (which goes stale as soon as the customer types a longer name).
  const box = useMemo(
    () =>
      resolveTextBox(
        {
          x: layer.x,
          y: layer.y,
          width: layer.width || 0,
          height: layer.height || 0,
          text: String(text),
          fontFamily: style.fontFamily || "Cormorant Garamond",
          fontSize,
          fontWeight: style.fontWeight || "400",
          fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
          letterSpacing: Number(style.letterSpacing) || 0,
          lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT,
          uppercase: Boolean(style.uppercase),
          multiline: Boolean(style.multiline),
          textAlign: style.textAlign || "center",
          autoSizeMode: style.autoSizeMode,
          fitMode: style.fitMode,
        },
        measure,
        safeBounds,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, layer.x, layer.y, layer.width, layer.height, JSON.stringify(style), JSON.stringify(safeBounds), fontsReady],
  );

  const layout = useMemo(
    () =>
      layoutText(
        {
          text: String(text),
          width: box.width,
          height: box.height,
          fontFamily: style.fontFamily || "Cormorant Garamond",
          fontSize,
          minFontSize: Number(style.minFontSize) || undefined,
          fontWeight: style.fontWeight || "400",
          fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
          letterSpacing: Number(style.letterSpacing) || 0,
          lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT,
          textAlign: style.textAlign || "center",
          verticalAlign: style.verticalAlign || "middle",
          multiline: Boolean(style.multiline),
          // Once auto width has hit the safe-area limit, fall back to the
          // configured behaviour: wrap when multiline is allowed, otherwise
          // shrink. Below that limit the font size is never touched.
          fitMode: box.clampedBySafeArea && !style.multiline
            ? "shrink"
            : style.fitMode === "shrink" ? "shrink" : style.fitMode === "auto-height" ? "auto-height" : "fixed",
          maxLines: Number(layer.maxLines) > 0 ? Number(layer.maxLines) : undefined,
        },
        measure,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, box.width, box.height, box.clampedBySafeArea, JSON.stringify(style), fontsReady],
  );

  const boxLeft = box.x - box.width / 2;
  const boxTop = box.y - box.height / 2;
  const clipId = `${idPrefix}-text-clip-${String(layer.id).replace(/[^a-z0-9_-]/gi, "-")}`;

  return (
    <g transform={layer.rotation ? `rotate(${layer.rotation} ${box.x} ${box.y})` : undefined}>
      <defs>
        <clipPath id={clipId}>
          <rect x={boxLeft} y={boxTop} width={box.width} height={box.height} />
        </clipPath>
      </defs>
      <text
        clipPath={`url(#${clipId})`}
        xmlSpace="preserve"
        style={{
          fontFamily: `"${style.fontFamily || "Cormorant Garamond"}", serif`,
          fontSize: `${layout.fontSize}px`,
          fontWeight: style.fontWeight || "400",
          fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
          letterSpacing: `${Number(style.letterSpacing) || 0}px`,
          textDecoration: style.underline ? "underline" : undefined,
          fill: isPlaceholder ? "#9aa0a1" : style.color || "#303839",
        }}
        textAnchor={layout.anchor}
        dominantBaseline="middle"
      >
        {layout.lines.map((line, index) => (
          <tspan key={index} x={boxLeft + line.x} y={boxTop + line.y}>
            {line.text || " "}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function ShapeLayer({ layer }: any) {
  const x = layer.x - layer.width / 2;
  const y = layer.y - layer.height / 2;
  const transform = layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined;
  const common = {
    fill: layer.fill || "none",
    stroke: layer.stroke || "none",
    strokeWidth: layer.strokeWidth || 0,
  };

  if (layer.shape === "ellipse" || layer.shape === "circle" || layer.shape === "oval") {
    return <ellipse cx={layer.x} cy={layer.y} rx={layer.width / 2} ry={layer.height / 2} transform={transform} {...common} />;
  }
  if (layer.shape === "line") {
    const color = layer.stroke || layer.fill || "#303839";
    const thickness = Number(layer.strokeWidth) || 3;
    const capSize = Math.max(8, thickness * 3);
    return <g transform={transform}><line x1={x} y1={layer.y} x2={x + layer.width} y2={layer.y} stroke={color} strokeWidth={thickness} strokeDasharray={layer.lineStyle === "dashed" ? "12 8" : layer.lineStyle === "dotted" ? "2 8" : undefined} strokeLinecap={layer.lineCap || "round"} />{layer.lineStartCap === "circle" && <circle cx={x} cy={layer.y} r={capSize / 2} fill={color} />}{layer.lineEndCap === "circle" && <circle cx={x + layer.width} cy={layer.y} r={capSize / 2} fill={color} />}{layer.lineStartCap === "arrow" && <polygon points={`${x},${layer.y} ${x + capSize},${layer.y - capSize * 0.7} ${x + capSize},${layer.y + capSize * 0.7}`} fill={color} />}{layer.lineEndCap === "arrow" && <polygon points={`${x + layer.width},${layer.y} ${x + layer.width - capSize},${layer.y - capSize * 0.7} ${x + layer.width - capSize},${layer.y + capSize * 0.7}`} fill={color} />}</g>;
  }
  if (layer.shape === "triangle") {
    return <path d={`M ${layer.x} ${y} L ${x + layer.width} ${y + layer.height} L ${x} ${y + layer.height} Z`} transform={transform} {...common} />;
  }
  if (layer.shape === "polygon" && Array.isArray(layer.points) && layer.points.length >= 3) {
    const points = layer.points.map((point: any) => `${x + Number(point.x || 0) * layer.width},${y + Number(point.y || 0) * layer.height}`).join(" ");
    return <polygon points={points} transform={transform} {...common} />;
  }
  if (layer.shape === "arch") {
    const path = getMaskPath({ kind: "arch" }, { x, y, width: layer.width, height: layer.height });
    return <path d={path.d} transform={transform} {...common} />;
  }
  if (layer.shape === "path" && layer.path) return <path d={layer.path} transform={transform} {...common} />;
  return <rect x={x} y={y} width={layer.width} height={layer.height} rx={layer.borderRadius || 0} ry={layer.borderRadius || 0} transform={transform} {...common} />;
}

// Decorative element (customer-inserted or template). Monochrome tinting uses
// an feFlood/feComposite filter, which recolours every opaque pixel while
// keeping transparency — supported by browsers and the server renderer alike.
function ElementLayer({ layer, idPrefix }: any) {
  const frameX = layer.x - layer.width / 2;
  const frameY = layer.y - layer.height / 2;
  const filterId = `${idPrefix}-tint-${layer.id}`;
  const flipX = layer.flipX ? -1 : 1;
  const flipY = layer.flipY ? -1 : 1;
  const flip = layer.flipX || layer.flipY ? `translate(${layer.x} ${layer.y}) scale(${flipX} ${flipY}) translate(${-layer.x} ${-layer.y})` : "";
  const rotate = layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : "";
  const transform = [rotate, flip].filter(Boolean).join(" ") || undefined;

  if (!layer.src) return null;

  return (
    <g transform={transform}>
      {layer.tintColor ? (
        <defs>
          <filter id={filterId} x="0%" y="0%" width="100%" height="100%">
            <feFlood floodColor={layer.tintColor} result="tint" />
            <feComposite in="tint" in2="SourceAlpha" operator="in" />
          </filter>
        </defs>
      ) : null}
      <image
        href={layer.src}
        x={frameX}
        y={frameY}
        width={layer.width}
        height={layer.height}
        preserveAspectRatio="xMidYMid meet"
        filter={layer.tintColor ? `url(#${filterId})` : undefined}
        crossOrigin="anonymous"
      />
    </g>
  );
}

function ImageLayer({ layer, field, values, idPrefix }: any) {
  const image = resolveLayerImage(layer, field, values);

  // Defensive only — the server pipeline is the real guarantee. If an editor
  // variant turns out to be far smaller than the box it must fill (a legacy
  // thumbnail-sized editor), fall back to the full-quality original once.
  // Never falls back to the thumbnail, and never loops.
  // Declared before any early return so the hook order stays stable.
  const sourceUrl = String(image?.url || "");
  const fallbackUrl = String(layer.originalUrl || "");
  const [downgraded, setDowngraded] = useState(false);
  useEffect(() => setDowngraded(false), [sourceUrl, fallbackUrl]);
  useEffect(() => {
    if (downgraded || !sourceUrl || !fallbackUrl || fallbackUrl === sourceUrl) return;
    if (typeof window === "undefined" || typeof window.Image === "undefined") return;
    let cancelled = false;
    const probe = new window.Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      // Half the required resolution is an unambiguous variant problem, so
      // healthy images never trigger a second request.
      if (!cancelled && probe.naturalWidth > 0 && probe.naturalWidth < layer.width / 2) {
        console.warn(
          "Customizer image variant is too small for its layer "
          + `[layer=${layer.id}] [natural=${probe.naturalWidth}x${probe.naturalHeight}] `
          + `[required=${Math.round(layer.width)}] — falling back to the original.`,
        );
        setDowngraded(true);
      }
    };
    probe.src = sourceUrl;
    return () => { cancelled = true; };
  }, [sourceUrl, fallbackUrl, downgraded, layer.width, layer.id]);

  const frameX = layer.x - layer.width / 2;
  const frameY = layer.y - layer.height / 2;
  const clipId = `${idPrefix}-clip-${layer.id}`;
  const filterId = `${idPrefix}-filter-${layer.id}`;
  const filtered = hasImageFilters(layer.filters);

  // Shared mask generator — identical clipping in editor, exports, and print.
  const mask = layer.mask && typeof layer.mask === "object"
    ? getMaskPath(layer.mask, { x: frameX, y: frameY, width: layer.width, height: layer.height })
    : getLegacyMaskPath(layer.maskShape, { x: frameX, y: frameY, width: layer.width, height: layer.height });

  if (!image?.url) {
    return (
      <g transform={layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined}>
        <path
          d={mask.d}
          transform={mask.transform}
          fill={layer.backgroundColor || "#F8F6F1"}
          stroke="#c9bcbc"
          strokeWidth={3}
          strokeDasharray="14 12"
        />
        <text
          x={layer.x}
          y={layer.y}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontFamily: "system-ui, sans-serif", fontSize: `${Math.max(18, layer.width * 0.06)}px`, fill: "#9c8f8f" }}
        >
          {field?.label || "Photo"}
        </text>
      </g>
    );
  }

  const imageHref = downgraded && fallbackUrl ? fallbackUrl : String(image.url);

  // Identical formula to the server SVG renderer — one shared implementation so
  // the on-screen preview and the printed sheet cannot disagree (spec §16).
  const draw = resolveImageDrawBoxFromTransform(
    { frameX, frameY, frameWidth: layer.width, frameHeight: layer.height },
    { zoom: image.zoom, offsetX: image.offsetX, offsetY: image.offsetY, ...(image.crop || {}) },
  );
  const drawX = draw.x;
  const drawY = draw.y;
  const drawW = draw.width;
  const drawH = draw.height;

  // In-frame transforms: rotation and flips apply around the frame centre,
  // inside the clip, so the mask stays put while the photo moves (spec §11).
  const innerTransforms: string[] = [];
  if (image.imageRotation) innerTransforms.push(`rotate(${image.imageRotation} ${layer.x} ${layer.y})`);
  if (image.flipX || image.flipY) {
    innerTransforms.push(
      `translate(${layer.x} ${layer.y}) scale(${image.flipX ? -1 : 1} ${image.flipY ? -1 : 1}) translate(${-layer.x} ${-layer.y})`,
    );
  }

  return (
    <g transform={layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined}>
      <defs>
        <clipPath id={clipId}>
          <path d={mask.d} transform={mask.transform} />
        </clipPath>
        {filtered ? <filter id={filterId} colorInterpolationFilters="sRGB" dangerouslySetInnerHTML={{ __html: imageFilterSvgPrimitives(layer.filters) }} /> : null}
      </defs>
      {layer.backgroundColor ? <path d={mask.d} transform={mask.transform} fill={layer.backgroundColor} /> : null}
      <g clipPath={`url(#${clipId})`}>
        <g transform={innerTransforms.join(" ") || undefined}>
          <image
            href={imageHref}
            x={drawX}
            y={drawY}
            width={drawW}
            height={drawH}
            preserveAspectRatio={layer.fitMode === "contain" ? "xMidYMid meet" : "xMidYMid slice"}
            crossOrigin="anonymous"
            filter={filtered ? `url(#${filterId})` : undefined}
          />
        </g>
      </g>
      {Number(layer.borderWidth) > 0 ? (
        <path
          d={mask.d}
          transform={mask.transform}
          fill="none"
          stroke={layer.borderColor || "#303839"}
          strokeWidth={Number(layer.borderWidth)}
        />
      ) : null}
    </g>
  );
}

function GridLayer({ layer, idPrefix }: any) {
  const left = layer.x - layer.width / 2;
  const top = layer.y - layer.height / 2;
  return (
    <g transform={layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined}>
      {layer.backgroundColor ? (
        <rect x={left} y={top} width={layer.width} height={layer.height} rx={layer.cornerRadius || 0} fill={layer.backgroundColor} />
      ) : null}
      {(layer.slots || []).map((rawSlot: any, index: number) => {
        const slot = normalizeGridSlot(rawSlot, index);
        const rect = getGridSlotRect(layer, slot);
        const slotLayer = {
          id: `${layer.id}-${slot.id}`,
          x: rect.centerX,
          y: rect.centerY,
          width: rect.width,
          height: rect.height,
          rotation: 0,
          src: slot.src,
          imageTransform: slot.transform,
          filters: slot.filters,
          mask: slot.mask || (layer.cornerRadius ? { kind: "rounded", radius: layer.cornerRadius } : { kind: "rectangle" }),
          maskShape: slot.mask?.kind || (layer.cornerRadius ? "rounded" : "rectangle"),
          fitMode: slot.transform.fitMode || "cover",
          backgroundColor: layer.backgroundColor || "#F8F6F1",
          borderColor: layer.borderColor,
          borderWidth: layer.borderWidth,
        };
        return <ImageLayer key={slot.id} layer={slotLayer} field={null} values={{}} idPrefix={`${idPrefix}-${layer.id}-${index}`} />;
      })}
    </g>
  );
}

function BackgroundLayer({ layer }: any) {
  const x = layer.x - layer.width / 2;
  const y = layer.y - layer.height / 2;
  const filtered = hasImageFilters(layer.filters);
  const filterId = `background-filter-${String(layer.id).replace(/[^a-z0-9_-]/gi, "-")}`;
  return (
    <g transform={layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined}>
      {filtered ? <defs><filter id={filterId} colorInterpolationFilters="sRGB" dangerouslySetInnerHTML={{ __html: imageFilterSvgPrimitives(layer.filters) }} /></defs> : null}
      <rect x={x} y={y} width={layer.width} height={layer.height} fill={layer.color || "#ffffff"} />
      {layer.src ? (
        <image href={layer.src} x={x} y={y} width={layer.width} height={layer.height} preserveAspectRatio={layer.fitMode === "contain" ? "xMidYMid meet" : "xMidYMid slice"} crossOrigin="anonymous" filter={filtered ? `url(#${filterId})` : undefined} />
      ) : null}
    </g>
  );
}

function QRCodeLayer({ layer }: any) {
  const style = normalizeQRCodeStyle(layer);
  const qr = qrModuleRects(style);
  const size = Math.min(Number(layer.width) || 1, Number(layer.height) || 1);
  const moduleSize = size / qr.totalSize;
  const left = Number(layer.x) - size / 2;
  const top = Number(layer.y) - size / 2;
  const transform = layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined;
  return (
    <g transform={transform} shapeRendering="crispEdges">
      <rect x={left} y={top} width={size} height={size} fill={style.backgroundColor} />
      {qr.rects.map((rect) => (
        <rect
          key={`${rect.x}-${rect.y}`}
          x={left + rect.x * moduleSize}
          y={top + rect.y * moduleSize}
          width={moduleSize}
          height={moduleSize}
          rx={style.moduleStyle === "rounded" ? moduleSize * 0.32 : 0}
          fill={style.foregroundColor}
        />
      ))}
    </g>
  );
}

export default function CustomizerPreview({
  template,
  values = {},
  page,
  showSafeArea,
  showBleed,
  className,
  svgRef,
  background,
  editorState,
  hiddenLayerIds = [],
  geometryOverrides = null,
}: Props) {
  const width = template?.canvasWidthPx || 1500;
  const height = template?.canvasHeightPx || 2100;
  const fontsReady = useFontsReady();
  const activePage = useMemo(() => getPageById(template, page || template?.defaultPage), [template, page]);
  const resolvedLayers = useMemo(
    () => getEffectiveLayersForPage(template, activePage?.id, editorState),
    [template, activePage, editorState],
  );
  const googleFontMetricsRevision = useGoogleFontMetricsRevision(
    resolvedLayers.filter((layer: any) => layer?.type === "text").map((layer: any) => layer.textStyle?.fontFamily),
  );
  // Zero retains deterministic hydration metrics. Every confirmed face load
  // bumps this value, invalidating TextLayer's layout memo without touching
  // document state, selection, editing state, or Undo history.
  const fontMeasurementRevision = fontsReady ? googleFontMetricsRevision + 1 : 0;
  // Applied last, on top of every override the document already carries, so an
  // in-flight gesture always wins over the persisted value it is replacing.
  const layers = useMemo(
    () => applyGeometryOverrides(resolvedLayers, geometryOverrides),
    [resolvedLayers, geometryOverrides],
  );

  const safe = template?.safeArea || {};
  const bleed = template?.bleed || {};
  const bg = background || activePage?.backgroundImage || "";
  const idPrefix = `cz-${activePage?.id || "page"}`;

  // Auto-width text may grow only up to the safe area.
  const safeBounds = useMemo(
    () => ({
      left: Number(safe.left) || 0,
      top: Number(safe.top) || 0,
      right: width - (Number(safe.right) || 0),
      bottom: height - (Number(safe.bottom) || 0),
    }),
    [safe.left, safe.top, safe.right, safe.bottom, width, height],
  );

  const resolvedShowSafe = showSafeArea ?? template?.settings?.showSafeArea;
  const resolvedShowBleed = showBleed ?? template?.settings?.showBleed;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block", background: "#ffffff" }}
      role="img"
      aria-label="Design preview"
    >
      <rect x={0} y={0} width={width} height={height} fill={activePage?.backgroundColor || "#ffffff"} />

      {bg ? (
        <image href={bg} x={0} y={0} width={width} height={height} preserveAspectRatio="xMidYMid slice" crossOrigin="anonymous" />
      ) : null}

      {layers.map((layer: any) => {
        if (layer.hidden || hiddenLayerIds.includes(layer.id)) return null;
        const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
        const content =
          layer.type === "image" || layer.type === "frame" ? (
            <ImageLayer layer={layer} field={field} values={values} idPrefix={idPrefix} />
          ) : layer.type === "shape" ? (
            <ShapeLayer layer={layer} />
          ) : layer.type === "element" ? (
            <ElementLayer layer={layer} idPrefix={idPrefix} />
          ) : layer.type === "grid" ? (
            <GridLayer layer={layer} idPrefix={idPrefix} />
          ) : layer.type === "background" ? (
            <BackgroundLayer layer={layer} />
          ) : layer.type === "qrCode" ? (
            <QRCodeLayer layer={layer} />
          ) : layer.type === "group" ? null
          : layer.type === "text" ? (
            <TextLayer layer={layer} field={field} values={values} fontsReady={fontMeasurementRevision} idPrefix={idPrefix} safeBounds={safeBounds} />
          ) : (
            null
          );
        return (
          // `data-layer-id` is what lets the shared Konva interaction layer
          // apply a TRANSIENT transform to this exact group during a drag or a
          // rotation (spec §9). Moving the real artwork node costs one style
          // write per frame instead of a full React + SVG re-render, and it is
          // pixel-accurate by construction because it IS the production
          // renderer. The attribute is presentational metadata only: it is not
          // part of the document and never reaches `buildPageSvg`.
          <g key={layer.id} data-layer-id={layer.id} opacity={layer.opacity === undefined ? 1 : layer.opacity}>
            {content}
          </g>
        );
      })}

      {resolvedShowBleed ? (
        <rect
          x={bleed.left || 0}
          y={bleed.top || 0}
          width={width - (bleed.left || 0) - (bleed.right || 0)}
          height={height - (bleed.top || 0) - (bleed.bottom || 0)}
          fill="none"
          stroke="#D4AF37"
          strokeWidth={2}
          strokeDasharray="8 8"
          opacity={0.65}
        />
      ) : null}

      {resolvedShowSafe ? (
        <rect
          x={safe.left || 0}
          y={safe.top || 0}
          width={width - (safe.left || 0) - (safe.right || 0)}
          height={height - (safe.top || 0) - (safe.bottom || 0)}
          fill="none"
          stroke="#303839"
          strokeWidth={2}
          strokeDasharray="12 10"
          opacity={0.35}
        />
      ) : null}
    </svg>
  );
}
