"use client";

// Reusable SVG renderer for a single customizer page. Used identically in the
// admin setup preview and the customer customizer so what admin sees is what
// the customer gets. Customers cannot move design elements here — this only
// renders; interaction lives in the parent panels.

import { useMemo } from "react";
import {
  getEffectiveLayersForPage,
  getFieldById,
  getPageById,
  resolveLayerImage,
  resolveLayerText,
  type EditorState,
} from "./customizer-utils";

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
};

function TextLayer({ layer, field, values }: any) {
  const style = layer.textStyle || {};
  const text = resolveLayerText(layer, field, values);
  const align = style.textAlign || "center";
  const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";

  const anchorX = align === "left" ? layer.x - layer.width / 2 : align === "right" ? layer.x + layer.width / 2 : layer.x;

  const fontSize = Number(style.fontSize) || 48;
  const lineHeight = (Number(style.lineHeight) || 1.15) * fontSize;
  const lines = style.multiline ? String(text).split("\n") : [String(text)];
  const startY = layer.y - ((lines.length - 1) * lineHeight) / 2;

  const isPlaceholder = field && (values[field.id] === undefined || values[field.id] === "" || values[field.id] === null) && !field.defaultValue;

  return (
    <text
      x={anchorX}
      textAnchor={anchor}
      transform={layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined}
      style={{
        fontFamily: `"${style.fontFamily || "Cormorant Garamond"}", serif`,
        fontSize: `${fontSize}px`,
        fontWeight: style.fontWeight || "400",
        fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
        letterSpacing: `${Number(style.letterSpacing) || 0}px`,
        fill: isPlaceholder ? "#9aa0a1" : style.color || "#303839",
      }}
      dominantBaseline="middle"
    >
      {lines.map((line: string, index: number) => (
        <tspan key={index} x={anchorX} y={startY + index * lineHeight}>
          {line || " "}
        </tspan>
      ))}
    </text>
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

  if (layer.shape === "ellipse") {
    return <ellipse cx={layer.x} cy={layer.y} rx={layer.width / 2} ry={layer.height / 2} transform={transform} {...common} />;
  }
  if (layer.shape === "line") {
    return <line x1={x} y1={layer.y} x2={x + layer.width} y2={layer.y} transform={transform} stroke={layer.stroke || layer.fill || "#303839"} strokeWidth={layer.strokeWidth || 3} />;
  }
  return <rect x={x} y={y} width={layer.width} height={layer.height} rx={layer.borderRadius || 0} ry={layer.borderRadius || 0} transform={transform} {...common} />;
}

function ImageLayer({ layer, field, values, idPrefix }: any) {
  const image = resolveLayerImage(layer, field, values);
  const frameX = layer.x - layer.width / 2;
  const frameY = layer.y - layer.height / 2;
  const clipId = `${idPrefix}-clip-${layer.id}`;

  const rx =
    layer.maskShape === "rounded"
      ? Math.min(layer.width, layer.height) * 0.08
      : layer.maskShape === "circle"
        ? Math.min(layer.width, layer.height) / 2
        : 0;

  if (!image?.url) {
    return (
      <g transform={layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined}>
        <rect
          x={frameX}
          y={frameY}
          width={layer.width}
          height={layer.height}
          rx={rx}
          ry={rx}
          fill="#F4ECEC"
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

  const zoom = Number(image.zoom) > 0 ? Number(image.zoom) : 1;
  const drawW = layer.width * zoom;
  const drawH = layer.height * zoom;
  const drawX = frameX - (drawW - layer.width) / 2 + (Number(image.offsetX) || 0);
  const drawY = frameY - (drawH - layer.height) / 2 + (Number(image.offsetY) || 0);

  const isCircle = layer.maskShape === "circle";

  return (
    <g transform={layer.rotation ? `rotate(${layer.rotation} ${layer.x} ${layer.y})` : undefined}>
      <defs>
        <clipPath id={clipId}>
          {isCircle ? (
            <circle cx={layer.x} cy={layer.y} r={Math.min(layer.width, layer.height) / 2} />
          ) : (
            <rect x={frameX} y={frameY} width={layer.width} height={layer.height} rx={rx} ry={rx} />
          )}
        </clipPath>
      </defs>
      <image
        href={image.url}
        x={drawX}
        y={drawY}
        width={drawW}
        height={drawH}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio={layer.fitMode === "contain" ? "xMidYMid meet" : "xMidYMid slice"}
        crossOrigin="anonymous"
      />
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
}: Props) {
  const width = template?.canvasWidthPx || 1500;
  const height = template?.canvasHeightPx || 2100;
  const activePage = useMemo(() => getPageById(template, page || template?.defaultPage), [template, page]);
  const layers = useMemo(
    () => getEffectiveLayersForPage(template, activePage?.id, editorState),
    [template, activePage, editorState],
  );

  const safe = template?.safeArea || {};
  const bleed = template?.bleed || {};
  const bg = background || activePage?.backgroundImage || "";
  const idPrefix = `cz-${activePage?.id || "page"}`;

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
        if (layer.hidden) return null;
        const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
        const content =
          layer.type === "image" ? (
            <ImageLayer layer={layer} field={field} values={values} idPrefix={idPrefix} />
          ) : layer.type === "shape" ? (
            <ShapeLayer layer={layer} />
          ) : (
            <TextLayer layer={layer} field={field} values={values} />
          );
        return (
          <g key={layer.id} opacity={layer.opacity === undefined ? 1 : layer.opacity}>
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
