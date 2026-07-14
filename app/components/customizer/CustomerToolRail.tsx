"use client";

// Narrow left tool rail of the customer customizer (Section 4). Customers get
// exactly four tools: Edit, Add Text, Uploads, Options. No Elements, Icons,
// Backgrounds, Layers, or Effects — those do not exist on the customer side.

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
};

export type CustomerTool = "edit" | "addText" | "uploads" | "options";

type ToolDef = { id: CustomerTool; label: string };

export function getCustomerTools({ allowAddText, hasUploads }: { allowAddText: boolean; hasUploads: boolean }): ToolDef[] {
  const tools: ToolDef[] = [{ id: "edit", label: "Edit" }];
  if (allowAddText) tools.push({ id: "addText", label: "Add Text" });
  if (hasUploads) tools.push({ id: "uploads", label: "Uploads" });
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
          : "flex w-full items-stretch justify-around gap-1 border-t border-[#303839]/10 bg-white px-1 py-1"
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
                ? "bg-[#F4ECEC] text-[#303839]"
                : "text-[#303839]/55 hover:bg-[#F8F6F1] hover:text-[#303839]"
            } ${vertical ? "mx-1.5" : "flex-1"}`}
          >
            <span className={active ? "text-[#303839]" : ""}>{RAIL_ICONS[tool.id]}</span>
            {tool.label}
          </button>
        );
      })}
    </div>
  );
}
