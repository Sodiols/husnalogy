"use client";

import { useRef, useState } from "react";

type Props = {
  activeTool: string;
  onSelectTool: (tool: string) => void;
  onAddText: () => void;
  onUploadImage: (file: File) => void;
  onAddPhotoArea: () => void;
  onAddGrid: (columns: number, rows: number) => void;
  onAddShape: (shape: string) => void;
  onAddLine: () => void;
  onOpenElements: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  canGroup?: boolean;
  canUngroup?: boolean;
  gridsEnabled?: boolean;
  groupsEnabled?: boolean;
  onAddBackground: () => void;
  onAddGuide: (axis: "horizontal" | "vertical") => void;
  onPan: () => void;
  onPreview: () => void;
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
  grid: icon(<><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /></>),
  shape: icon(<><rect x="3" y="4" width="9" height="9" rx="2" /><circle cx="17" cy="17" r="4" /></>),
  line: icon(<path d="M4 18 20 6" />),
  elements: icon(<path d="m12 3 2.2 4.5L19 8.2l-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8L5 8.2l4.8-.7Z" />),
  group: icon(<><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /><path d="M8 13v3h3M13 8h3v3" /></>),
  ungroup: icon(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M10 14 14 10" /></>),
  background: icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m3 16 5-5 4 4 3-3 6 6" /></>),
  guide: icon(<><path d="M4 5h16M7 3v4m5-4v4m5-4v4" /><path d="M12 9v12" /></>),
  pan: icon(<path d="M8 11V6a2 2 0 0 1 4 0v4-6a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7c0 4-3 7-7 7h-1c-3 0-5-2-7-5l-2-3a2 2 0 0 1 3-2l2 2" />),
  preview: icon(<><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>),
  pages: icon(<><rect x="7" y="3" width="14" height="18" rx="2" /><path d="M3 7v12a2 2 0 0 0 2 2h10" /></>),
  fields: icon(<><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="19" cy="16" r="3" /></>),
  options: icon(<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>),
  layers: icon(<><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>),
  settings: icon(<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></>),
};

function RailButton({ id, label, active = false, onClick, disabled = false, disabledHint = "" }: any) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      title={disabled && disabledHint ? disabledHint : label}
      className={`mx-1.5 flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[9.5px] font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
        active ? "bg-[#F8F6F1] text-[#303839] shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
      }`}
    >
      {ICONS[id]}
      <span>{label}</span>
    </button>
  );
}

export default function AdminToolRail(props: Props) {
  const imageInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<"grid" | "shape" | "guide" | null>(null);
  const closeAnd = (action: () => void) => {
    action();
    setMenu(null);
  };

  return (
    <div className="relative flex w-[72px] shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-visible border-r border-white/10 bg-[#303839] py-2 2xl:w-24 2xl:py-3">
      <RailButton id="select" label="Select" active={props.activeTool === "select"} onClick={() => props.onSelectTool("select")} />
      <RailButton id="text" label="Text" onClick={props.onAddText} />
      <RailButton id="image" label="Upload" onClick={() => imageInput.current?.click()} />
      <RailButton id="photo" label="Frame" onClick={props.onAddPhotoArea} />
      <RailButton id="grid" label="Grid" active={menu === "grid"} onClick={() => setMenu((value) => value === "grid" ? null : "grid")} disabled={!props.gridsEnabled} disabledHint="Enable Photo grids in Settings for this product." />
      <RailButton id="shape" label="Shape" active={menu === "shape"} onClick={() => setMenu((value) => value === "shape" ? null : "shape")} />
      <RailButton id="line" label="Line" onClick={props.onAddLine} />
      <RailButton id="elements" label="Elements" onClick={props.onOpenElements} />
      <RailButton id="group" label="Group" onClick={props.onGroup} disabled={!props.groupsEnabled || !props.canGroup} disabledHint={!props.groupsEnabled ? "Enable Persistent groups in Settings for this product." : "Select at least two layers."} />
      <RailButton id="ungroup" label="Ungroup" onClick={props.onUngroup} disabled={!props.groupsEnabled || !props.canUngroup} disabledHint={!props.groupsEnabled ? "Enable Persistent groups in Settings for this product." : "Select a group layer."} />
      <RailButton id="background" label="Background" onClick={props.onAddBackground} />
      <RailButton id="guide" label="Guide" active={menu === "guide"} onClick={() => setMenu((value) => value === "guide" ? null : "guide")} />
      <RailButton id="pan" label="Pan" active={props.activeTool === "pan"} onClick={props.onPan} />
      <RailButton id="preview" label="Preview" onClick={props.onPreview} />
      <span className="mx-3 my-1 h-px bg-white/10" aria-hidden />
      <RailButton id="pages" label="Pages" onClick={() => props.onOpenPanel("pages")} />
      <RailButton id="layers" label="Layers" onClick={() => props.onOpenPanel("layers")} />
      <RailButton id="fields" label="Fields" onClick={() => props.onGoTab("fields")} />
      <RailButton id="options" label="Options" onClick={() => props.onGoTab("options")} />
      <RailButton id="settings" label="Settings" onClick={() => props.onGoTab("settings")} />

      {props.uploading && <p className="mt-1 text-center text-[9px] font-bold text-white/60">Uploading…</p>}

      {menu && (
        <div className="fixed left-[76px] top-24 z-[180] w-64 rounded-xl border border-[#303839]/12 bg-white p-2 text-[#303839] shadow-[0_18px_55px_rgba(48,56,57,0.22)] 2xl:left-[100px]" role="menu">
          <p className="px-2 pb-2 pt-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/45">
            {menu === "grid" ? "Photo grid layout" : menu === "shape" ? "Shape" : "Canvas guide"}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {menu === "grid" && props.gridsEnabled && [[2, 1], [3, 1], [2, 2], [5, 1], [3, 2], [4, 2], [3, 3]].map(([columns, rows]) => (
              <button key={`${columns}x${rows}`} type="button" onClick={() => closeAnd(() => props.onAddGrid(columns, rows))} className="min-h-11 cursor-pointer rounded-lg border border-[#303839]/10 bg-[#F8F6F1] px-2 text-xs font-bold transition-colors hover:border-[#D4AF37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">
                {columns * rows} photos
              </button>
            ))}
            {menu === "shape" && ["rectangle", "rounded-rectangle", "circle", "oval", "triangle", "polygon", "arch"].map((shape) => (
              <button key={shape} type="button" onClick={() => closeAnd(() => props.onAddShape(shape))} className="min-h-11 cursor-pointer rounded-lg border border-[#303839]/10 px-2 text-xs font-bold capitalize transition-colors hover:border-[#D4AF37] hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">
                {shape.replace("-", " ")}
              </button>
            ))}
            {menu === "guide" && (["horizontal", "vertical"] as const).map((axis) => (
              <button key={axis} type="button" onClick={() => closeAnd(() => props.onAddGuide(axis))} className="min-h-11 cursor-pointer rounded-lg border border-[#303839]/10 px-2 text-xs font-bold capitalize transition-colors hover:border-[#D4AF37] hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">
                {axis}
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        ref={imageInput}
        type="file"
        accept="image/svg+xml,image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) props.onUploadImage(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
