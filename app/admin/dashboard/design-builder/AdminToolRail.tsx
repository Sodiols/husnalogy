"use client";

// Left tool rail of the admin studio (Section 20). Creation tools plus panel
// shortcuts. No Effects, no stock element marketplace.

import { useRef, useState } from "react";

type Props = {
  activeTool: string;
  onSelectTool: (tool: string) => void;
  onAddText: () => void;
  onUploadImage: (file: File) => void;
  onAddPhotoArea: () => void;
  onAddShape: (kind: string) => void;
  onOpenPanel: (panel: "pages" | "layers") => void;
  onGoTab: (tab: string) => void;
  uploading?: boolean;
};

const icon = (paths: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {paths}
  </svg>
);

const ICONS: Record<string, React.ReactNode> = {
  select: icon(<path d="M4 3l7 17 2.5-6.5L20 11z" />),
  text: icon(<><path d="M4 7V5h16v2" /><path d="M12 5v14" /><path d="M9 19h6" /></>),
  image: icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L6 21" /></>),
  photo: icon(<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3.5" /><path d="M3 5l2-2h3" /></>),
  shape: icon(<><rect x="3" y="10" width="10" height="10" rx="1" /><circle cx="16.5" cy="7.5" r="4.5" /></>),
  pages: icon(<><rect x="7" y="3" width="14" height="18" rx="2" /><path d="M3 7v12a2 2 0 0 0 2 2h10" /></>),
  fields: icon(<><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="19" cy="16" r="3" /></>),
  options: icon(<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>),
  layers: icon(<><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>),
  settings: icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>),
};

function RailButton({ id, label, active, onClick }: any) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`mx-1.5 flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[9.5px] font-bold transition ${
        active ? "bg-[#F4ECEC] text-[#303839]" : "text-[#303839]/55 hover:bg-[#F8F6F1] hover:text-[#303839]"
      }`}
    >
      {ICONS[id]}
      {label}
    </button>
  );
}

export default function AdminToolRail({
  activeTool,
  onSelectTool,
  onAddText,
  onUploadImage,
  onAddPhotoArea,
  onAddShape,
  onOpenPanel,
  onGoTab,
  uploading,
}: Props) {
  const imageInput = useRef<HTMLInputElement>(null);
  const [shapeOpen, setShapeOpen] = useState(false);

  return (
    <div className="relative flex w-[72px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[#303839]/10 bg-white py-2">
      <RailButton id="select" label="Select" active={activeTool === "select"} onClick={() => onSelectTool("select")} />
      <RailButton id="text" label="Text" onClick={onAddText} />
      <RailButton id="image" label="Image" onClick={() => imageInput.current?.click()} />
      <RailButton id="photo" label="Photo Area" onClick={onAddPhotoArea} />
      <div className="relative">
        <RailButton id="shape" label="Shape" active={shapeOpen} onClick={() => setShapeOpen((v) => !v)} />
        {shapeOpen && (
          <div className="absolute left-full top-0 z-20 ml-1 grid w-36 gap-0.5 rounded-lg border border-[#303839]/12 bg-white p-1 shadow-lg">
            {["rectangle", "rounded", "ellipse", "line"].map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onAddShape(kind === "rounded" ? "rectangle-rounded" : kind);
                  setShapeOpen(false);
                }}
                className="rounded px-2 py-1.5 text-left text-xs font-bold capitalize text-[#303839] hover:bg-[#F8F6F1]"
              >
                {kind === "rounded" ? "Rounded rectangle" : kind}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="mx-3 my-1 h-px bg-[#303839]/10" aria-hidden />

      <RailButton id="pages" label="Pages" onClick={() => onOpenPanel("pages")} />
      <RailButton id="layers" label="Layers" onClick={() => onOpenPanel("layers")} />
      <RailButton id="fields" label="Fields" onClick={() => onGoTab("fields")} />
      <RailButton id="options" label="Options" onClick={() => onGoTab("options")} />
      <RailButton id="settings" label="Settings" onClick={() => onGoTab("settings")} />

      {uploading && <p className="mt-1 text-center text-[9px] font-bold text-[#303839]/50">Uploading…</p>}

      <input
        ref={imageInput}
        type="file"
        accept="image/svg+xml,image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUploadImage(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
