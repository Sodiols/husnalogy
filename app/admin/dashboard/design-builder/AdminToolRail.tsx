"use client";

/**
 * The Design Studio's left sidebar: one compact, floating white capsule of
 * tools, each opening an EXISTING studio surface in the side panel beside it.
 *
 * Order (reference): Edit · Add Text · Uploads · Background · Elements ·
 * Icons · Options · Moment · Layers · Pages. "Templates" is deliberately
 * absent until Husnalogy has a real template library; Template Settings stay
 * in the Settings tab.
 */

/** "fonts" has no rail item: the toolbar's Font pill opens it. */
export type StudioSidePanel = "text" | "uploads" | "background" | "elements" | "icons" | "options" | "moment" | "layers" | "pages" | "fonts";

export type StudioRailItem = "edit" | StudioSidePanel;

type Props = {
  /** The side panel open now, or null (the Edit tool with no panel). */
  activePanel: StudioSidePanel | null;
  onSelect: (item: StudioRailItem) => void;
};

const icon = (paths: React.ReactNode) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {paths}
  </svg>
);

export const STUDIO_RAIL_ITEMS: ReadonlyArray<{ id: StudioRailItem; label: string; icon: React.ReactNode }> = [
  {
    id: "edit",
    label: "Edit",
    // A wand with sparkles: the resting select / edit tool.
    icon: icon(<><path d="m4 20 11-11" /><path d="m13 7 2-2 2 2-2 2" /><path d="M7 3v3M5.5 4.5h3M19 12v3M17.5 13.5h3M19.5 3.5l.01 0" /></>),
  },
  { id: "text", label: "Add Text", icon: icon(<><path d="M5 6V4h14v2" /><path d="M12 4v16" /><path d="M9 20h6" /></>) },
  {
    id: "uploads",
    label: "Uploads",
    icon: icon(<><path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18" /><path d="M12 12v8" /><path d="m9 15 3-3 3 3" /></>),
  },
  {
    id: "background",
    label: "Background",
    icon: icon(<><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="m4 15 11-11M4 20 20 4M9 20 20 9M14 20l6-6" /></>),
  },
  {
    id: "elements",
    label: "Elements",
    icon: icon(<><path d="M6.5 3 10 9H3Z" /><circle cx="17" cy="6.5" r="3.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><circle cx="17" cy="17" r="3.5" /></>),
  },
  { id: "icons", label: "Icons", icon: icon(<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" />) },
  {
    id: "options",
    label: "Options",
    // A garment-like product with a picture on it: what the customer configures.
    icon: icon(<><path d="M8 4 4 6.5l1.5 4L7 10v10h10V10l1.5.5 1.5-4L16 4c-.5 1.5-2 2.5-4 2.5S8.5 5.5 8 4Z" /><path d="m9.5 16 2-2.5 1.5 1.5 1-1 1 2" /></>),
  },
  {
    id: "moment",
    label: "Moment",
    // A calendar with a person: the event and its details.
    icon: icon(<><path d="M5 5h14v8.5" /><path d="M5 5v14h6" /><path d="M5 9h14M9 3v4M15 3v4" /><circle cx="16.5" cy="15.5" r="2" /><path d="M13 21a3.5 3.5 0 0 1 7 0" /></>),
  },
  { id: "layers", label: "Layers", icon: icon(<><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>) },
  // Two stacked page cards: the card's pages.
  { id: "pages", label: "Pages", icon: icon(<><rect x="8" y="3" width="11" height="15" rx="1.5" /><path d="M5.5 6.5v12A1.5 1.5 0 0 0 7 20h9" /></>) },
];

export default function AdminToolRail({ activePanel, onSelect }: Props) {
  return (
    <nav
      aria-label="Design tools"
      data-admin-tool-rail
      className="flex w-[80px] shrink-0 flex-col items-stretch gap-0.5 overflow-y-auto rounded-2xl bg-white px-1.5 py-3 shadow-[0_4px_20px_rgba(48,56,57,0.12)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {STUDIO_RAIL_ITEMS.map((item) => {
        const active = item.id === "edit" ? activePanel === null : activePanel === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            data-rail-item={item.id}
            onClick={() => onSelect(item.id)}
            className={`flex min-h-[58px] w-full flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[11px] font-medium leading-tight text-[#1f2425] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] ${
              active ? "bg-[#303839]/[0.07]" : "hover:bg-[#303839]/[0.04]"
            }`}
          >
            {item.icon}
            <span className="w-full truncate text-center">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
