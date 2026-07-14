"use client";

// Pages panel (Sections 27–28): live thumbnails via the shared renderer with
// add / rename / duplicate / reorder / enable-disable / delete and per-page
// settings (label, background, customer text permission).

import { useRef, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import { uploadBuilderImage } from "./builder-utils";

const PAGE_LABEL_PRESETS = ["Front", "Back", "Inside Left", "Inside Right", "Top", "Bottom"];

export default function AdminPagesPanel({
  template,
  activePage,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onRenamePage,
  onMovePage,
  onDeletePage,
  onPatchPage,
}: any) {
  const pages = template?.pages || [];
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const bgInput = useRef<HTMLInputElement>(null);
  const bgTarget = useRef<string | null>(null);

  const commitRename = (pageId: string) => {
    if (renameValue.trim()) onRenamePage(pageId, renameValue.trim());
    setRenamingId(null);
  };

  const uploadBackground = async (file?: File) => {
    const pageId = bgTarget.current;
    if (!file || !pageId) return;
    const url = await uploadBuilderImage(file);
    if (url) onPatchPage(pageId, { backgroundImage: url });
  };

  return (
    <div className="grid gap-3 p-3">
      {pages.map((page: any, index: number) => {
        const active = page.id === activePage;
        const disabled = page.enabled === false;
        return (
          <div key={page.id} className="relative">
            <button
              type="button"
              onClick={() => onSelectPage(page.id)}
              aria-pressed={active}
              className={`block w-full text-left transition ${disabled ? "opacity-45" : ""}`}
            >
              <div className={`overflow-hidden rounded-md border-2 bg-white ${active ? "border-[#303839]" : "border-[#303839]/12 hover:border-[#303839]/35"}`}>
                <CustomizerPreview template={template} values={{}} page={page.id} showSafeArea={false} showBleed={false} />
              </div>
            </button>

            <div className="mt-1 flex items-center justify-between gap-1">
              {renamingId === page.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(page.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(page.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  list="cz-page-label-presets"
                  className="w-full rounded border border-[#303839]/20 bg-white px-1 py-0.5 text-xs text-[#303839] outline-none"
                  aria-label="Page name"
                />
              ) : (
                <span className={`truncate text-[11px] font-bold ${active ? "text-[#303839]" : "text-[#303839]/55"}`}>
                  {page.label}
                  {disabled ? " · off" : ""}
                </span>
              )}
              <button
                type="button"
                aria-label={`Page actions for ${page.label}`}
                onClick={() => setMenuFor(menuFor === page.id ? null : page.id)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-[#303839]/50 hover:bg-[#F8F6F1] hover:text-[#303839]"
              >
                ⋯
              </button>
            </div>

            {menuFor === page.id && (
              <div className="absolute right-0 top-full z-30 mt-1 grid w-44 gap-0.5 rounded-lg border border-[#303839]/12 bg-white p-1 shadow-xl">
                <button type="button" className="rounded px-2 py-1.5 text-left text-xs font-bold hover:bg-[#F8F6F1]" onClick={() => { setRenamingId(page.id); setRenameValue(page.label); setMenuFor(null); }}>
                  Rename
                </button>
                <button type="button" className="rounded px-2 py-1.5 text-left text-xs font-bold hover:bg-[#F8F6F1]" onClick={() => { onDuplicatePage(page.id); setMenuFor(null); }}>
                  Duplicate
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1.5 text-left text-xs font-bold hover:bg-[#F8F6F1]"
                  onClick={() => { bgTarget.current = page.id; bgInput.current?.click(); setMenuFor(null); }}
                >
                  Set background image
                </button>
                {page.backgroundImage && (
                  <button type="button" className="rounded px-2 py-1.5 text-left text-xs font-bold hover:bg-[#F8F6F1]" onClick={() => { onPatchPage(page.id, { backgroundImage: "" }); setMenuFor(null); }}>
                    Remove background image
                  </button>
                )}
                <label className="flex items-center justify-between rounded px-2 py-1.5 text-xs font-bold hover:bg-[#F8F6F1]">
                  Background colour
                  <input
                    type="color"
                    value={page.backgroundColor || "#ffffff"}
                    onChange={(e) => onPatchPage(page.id, { backgroundColor: e.target.value })}
                    className="h-5 w-8 cursor-pointer border border-[#303839]/15"
                    aria-label={`Background colour for ${page.label}`}
                  />
                </label>
                <label className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-bold hover:bg-[#F8F6F1]">
                  <input
                    type="checkbox"
                    checked={page.enabled !== false}
                    onChange={(e) => { onPatchPage(page.id, { enabled: e.target.checked }); }}
                    className="h-3.5 w-3.5 accent-[#303839]"
                  />
                  Enabled for customers
                </label>
                <label className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-bold hover:bg-[#F8F6F1]">
                  <input
                    type="checkbox"
                    checked={page.allowCustomerText === true || (page.allowCustomerText === undefined && Boolean(template?.settings?.allowCustomerText))}
                    onChange={(e) => onPatchPage(page.id, { allowCustomerText: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[#303839]"
                  />
                  Allow customer text
                </label>
                <div className="flex gap-0.5 border-t border-[#303839]/8 pt-0.5">
                  <button type="button" disabled={index === 0} className="flex-1 rounded px-2 py-1.5 text-xs font-bold hover:bg-[#F8F6F1] disabled:opacity-30" onClick={() => onMovePage(page.id, "up")}>
                    ↑ Move
                  </button>
                  <button type="button" disabled={index === pages.length - 1} className="flex-1 rounded px-2 py-1.5 text-xs font-bold hover:bg-[#F8F6F1] disabled:opacity-30" onClick={() => onMovePage(page.id, "down")}>
                    ↓ Move
                  </button>
                </div>
                <button
                  type="button"
                  disabled={pages.length <= 1}
                  className="rounded px-2 py-1.5 text-left text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-30"
                  onClick={() => {
                    setMenuFor(null);
                    onDeletePage(page.id);
                  }}
                >
                  Delete page…
                </button>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAddPage}
        className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-[#303839]/25 px-2 py-3 text-xs font-bold text-[#303839]/60 transition hover:bg-[#F8F6F1] hover:text-[#303839]"
      >
        + Add page
      </button>

      <datalist id="cz-page-label-presets">
        {PAGE_LABEL_PRESETS.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      <input
        ref={bgInput}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          uploadBackground(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
