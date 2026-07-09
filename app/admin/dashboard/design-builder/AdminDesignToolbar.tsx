"use client";

// Left toolbar of the Design Builder. Admin-only creation tools. These do NOT
// appear on the customer side.

import { useRef, useState } from "react";

function ToolButton({ label, icon, onClick }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col items-center gap-1 border border-transparent px-2 py-2.5 text-[10px] font-bold text-[#111111]/75 transition hover:border-[#111111]/12 hover:bg-[#F8F8F8]"
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
    </button>
  );
}

export default function AdminDesignToolbar({ onAddText, onUploadImage, onAddPhotoPlaceholder, onAddShape, onSetBackground, onOpenSettings, onOpenFields }: any) {
  const imageInput = useRef<HTMLInputElement>(null);
  const bgInput = useRef<HTMLInputElement>(null);
  const [shapeOpen, setShapeOpen] = useState(false);

  return (
    <div className="relative flex w-20 shrink-0 flex-col gap-1 border-r border-[#111111]/10 bg-white p-1.5">
      <ToolButton label="Add Text" icon="T" onClick={onAddText} />
      <ToolButton label="Upload Image" icon="🖼" onClick={() => imageInput.current?.click()} />
      <ToolButton label="Photo Field" icon="▣" onClick={onAddPhotoPlaceholder} />
      <ToolButton label="Background" icon="◱" onClick={() => bgInput.current?.click()} />
      <div className="relative">
        <ToolButton label="Shapes" icon="◆" onClick={() => setShapeOpen((v) => !v)} />
        {shapeOpen && (
          <div className="absolute left-full top-0 z-10 ml-1 grid w-28 gap-1 border border-[#111111]/15 bg-white p-1 shadow">
            {["rectangle", "ellipse", "line"].map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => { onAddShape(kind); setShapeOpen(false); }}
                className="px-2 py-1.5 text-left text-xs font-bold capitalize hover:bg-[#F8F8F8]"
              >
                {kind}
              </button>
            ))}
          </div>
        )}
      </div>
      <ToolButton label="Fields" icon="≣" onClick={onOpenFields} />
      <ToolButton label="Settings" icon="⚙" onClick={onOpenSettings} />

      <input ref={imageInput} type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadImage(f); e.target.value = ""; }} />
      <input ref={bgInput} type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onSetBackground(f); e.target.value = ""; }} />
    </div>
  );
}
