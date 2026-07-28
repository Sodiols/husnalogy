"use client";

import { useState } from "react";

type Props = {
  activeTool: string;
  onSelectTool: (tool: string) => void;
  onAddText: () => void;
  onAddPhotoArea: () => void;
  onAddShape: (shape: string) => void;
  onAddLine: () => void;
  onAddQRCode: () => void;
  onOpenElements: () => void;
  onAddBackground: () => void;
  onAddGuide: (axis: "horizontal" | "vertical") => void;
  onPan: () => void;
  onOpenPanel: (panel: "pages") => void;
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
  shape: icon(<><rect x="3" y="4" width="9" height="9" rx="2" /><circle cx="17" cy="17" r="4" /></>),
  line: icon(<path d="M4 18 20 6" />),
  qr: icon(<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM19 14h2v7h-7v-2" /></>),
  elements: icon(<path d="m12 3 2.2 4.5L19 8.2l-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8L5 8.2l4.8-.7Z" />),
  background: icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m3 16 5-5 4 4 3-3 6 6" /></>),
  guide: icon(<><path d="M4 5h16M7 3v4m5-4v4m5-4v4" /><path d="M12 9v12" /></>),
  pan: icon(<path d="M8 11V6a2 2 0 0 1 4 0v4-6a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7c0 4-3 7-7 7h-1c-3 0-5-2-7-5l-2-3a2 2 0 0 1 3-2l2 2" />),
  pages: icon(<><rect x="7" y="3" width="14" height="18" rx="2" /><path d="M3 7v12a2 2 0 0 0 2 2h10" /></>),
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
      className={`mx-1.5 flex min-h-[52px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[9.5px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
        active ? "bg-[#D4AF37] text-[#303839]" : "text-white/60 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
      }`}
    >
      {ICONS[id]}
      <span>{label}</span>
    </button>
  );
}

export default function AdminToolRail(props: Props) {
  const [menu, setMenu] = useState<"shape" | "guide" | null>(null);
  const closeAnd = (action: () => void) => {
    action();
    setMenu(null);
  };

  return (
    <div className="relative flex w-[72px] shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-visible border-r border-white/10 bg-[#303839] py-2 2xl:w-24 2xl:py-3">
      <RailButton id="select" label="Select" active={props.activeTool === "select"} onClick={() => props.onSelectTool("select")} />
      <RailButton id="text" label="Text" active={props.activeTool === "text"} onClick={props.onAddText} />
      <RailButton id="image" label="Uploads" active={props.activeTool === "uploads"} onClick={() => props.onSelectTool("uploads")} />
      <RailButton id="photo" label="Frame" onClick={props.onAddPhotoArea} />
      <RailButton id="shape" label="Shape" active={menu === "shape"} onClick={() => setMenu((value) => value === "shape" ? null : "shape")} />
      <RailButton id="line" label="Line" onClick={props.onAddLine} />
      <RailButton id="qr" label="QR Code" onClick={props.onAddQRCode} />
      <RailButton id="elements" label="Elements" onClick={props.onOpenElements} />
      <RailButton id="background" label="Background" onClick={props.onAddBackground} />
      <RailButton id="guide" label="Guide" active={menu === "guide"} onClick={() => setMenu((value) => value === "guide" ? null : "guide")} />
      <RailButton id="pan" label="Pan" active={props.activeTool === "pan"} onClick={props.onPan} />
      <span className="mx-3 my-1 h-px bg-white/10" aria-hidden />
      <RailButton id="pages" label="Pages" onClick={() => props.onOpenPanel("pages")} />

      {menu && (
        <div className="fixed left-[76px] top-24 z-[180] w-64 rounded-xl border border-[#303839]/12 bg-white p-2 text-[#303839] shadow-[0_18px_55px_rgba(48,56,57,0.22)] 2xl:left-[100px]" role="menu">
          <p className="px-2 pb-2 pt-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/45">
            {menu === "shape" ? "Shape" : "Canvas guide"}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
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

    </div>
  );
}
