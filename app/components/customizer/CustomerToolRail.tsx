"use client";

// Narrow left tool rail of the customer customizer. Tools appear only when
// the template enables them: Edit, Add Text, Uploads, Elements, Options.

const RAIL_ICONS: Record<string, React.ReactNode> = {
  edit: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  addText: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7V5h16v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </svg>
  ),
  uploads: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-4.5-4.5L6 21" />
    </svg>
  ),
  options: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </svg>
  ),
  elements: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8Z" />
    </svg>
  ),
  shapes: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="4" width="9" height="9" rx="2"/><circle cx="17" cy="17" r="4"/></svg>,
  lines: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 18 20 6"/></svg>,
  frames: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/></svg>,
  grids: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></svg>,
  qr: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM19 14h2v7h-7v-2"/></svg>,
  background: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/></svg>,
  layers: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5M3 18l9 4 9-4"/></svg>,
};

export type CustomerTool = "edit" | "addText" | "uploads" | "elements" | "shapes" | "lines" | "frames" | "grids" | "qr" | "background" | "layers" | "options";

type ToolDef = { id: CustomerTool; label: string };

export function getCustomerTools({
  allowAddText,
  hasUploads,
  allowElements = false,
  allowShapes = false,
  allowLines = false,
  allowFrames = false,
  allowGrids = false,
  allowQRCode = false,
  allowBackground = false,
  showLayers = false,
}: {
  allowAddText: boolean;
  hasUploads: boolean;
  allowElements?: boolean;
  allowShapes?: boolean;
  allowLines?: boolean;
  allowFrames?: boolean;
  allowGrids?: boolean;
  allowQRCode?: boolean;
  allowBackground?: boolean;
  showLayers?: boolean;
}): ToolDef[] {
  const tools: ToolDef[] = [{ id: "edit", label: "Edit" }];
  if (allowAddText) tools.push({ id: "addText", label: "Text" });
  if (hasUploads) tools.push({ id: "uploads", label: "Photos" });
  if (allowElements) tools.push({ id: "elements", label: "Elements" });
  if (allowShapes) tools.push({ id: "shapes", label: "Shapes" });
  if (allowLines) tools.push({ id: "lines", label: "Lines" });
  if (allowFrames) tools.push({ id: "frames", label: "Frames" });
  if (allowGrids) tools.push({ id: "grids", label: "Grids" });
  if (allowQRCode) tools.push({ id: "qr", label: "QR Code" });
  if (allowBackground) tools.push({ id: "background", label: "Background" });
  if (showLayers) tools.push({ id: "layers", label: "Layers" });
  tools.push({ id: "options", label: "Options" });
  return tools;
}

type Props = {
  tools: ToolDef[];
  activeTool: CustomerTool | null;
  onSelect: (tool: CustomerTool) => void;
  orientation?: "vertical" | "horizontal";
};

export default function CustomerToolRail({ tools, activeTool, onSelect, orientation = "vertical" }: Props) {
  const vertical = orientation === "vertical";
  return (
    <div
      role="toolbar"
      aria-label="Customizer tools"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={
        vertical
          ? "flex w-[68px] shrink-0 flex-col items-stretch gap-1 border-r border-[#303839]/10 bg-white py-2"
          : "flex w-full items-stretch gap-1 overflow-x-auto border-t border-[#303839]/10 bg-white px-1 py-1 [scrollbar-width:none]"
      }
    >
      {tools.map((tool) => {
        const active = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            aria-label={tool.label}
            aria-pressed={active}
            onClick={() => onSelect(tool.id)}
            className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[10px] font-bold transition ${
              active
                ? "bg-[#F8F6F1] text-[#303839]"
                : "text-[#303839]/55 hover:bg-[#F8F6F1] hover:text-[#303839]"
            } ${vertical ? "mx-1.5" : "min-w-[68px] flex-1"}`}
          >
            <span className={active ? "text-[#303839]" : ""}>{RAIL_ICONS[tool.id]}</span>
            {tool.label}
          </button>
        );
      })}
    </div>
  );
}
