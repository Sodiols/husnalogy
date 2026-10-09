"use client";

// Pages panel (Sections 27–28): one white card per page, stacked — a live
// thumbnail from the shared renderer above the page's name — with add /
// rename / duplicate / reorder / enable-disable / delete and per-page settings
// (label, background, customer text permission) in each card's menu.

import { memo, useRef, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import { useBackgroundUpload } from "./use-background-upload";
import BackgroundUploadStatus from "./BackgroundUploadStatus";
import { pageHasBackgroundImage } from "@/lib/customizer/v2/page-background";
import { pagePreviewUnchanged } from "@/lib/customizer/v2/page-preview-memo";

const NO_VALUES = {};

/**
 * One page card's live preview. Re-renders only when something that draws
 * THIS page changed (lib/customizer/v2/page-preview-memo): an edit on Front no
 * longer redraws every other page's thumbnail.
 */
const PageThumbnail = memo(
  function PageThumbnail({ template, pageId }: { template: any; pageId: string }) {
    return <CustomizerPreview template={template} values={NO_VALUES} page={pageId} showSafeArea={false} showBleed={false} />;
  },
  (previous, next) => previous.pageId === next.pageId && pagePreviewUnchanged(previous.template, next.template, next.pageId),
);

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
  onSetBackgroundImage,
  onRemoveBackgroundImage,
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

  // Applied only once the upload has succeeded; failures show on the card.
  const upload = useBackgroundUpload(onSetBackgroundImage);

  const menuItem =
    "rounded px-2 py-1.5 text-left text-xs font-bold hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

  return (
    <div className="grid gap-3 px-4 pb-4 pt-1">
      {pages.map((page: any, index: number) => {
        const active = page.id === activePage;
        const disabled = page.enabled === false;
        return (
          <div
            key={page.id}
            data-page-card={page.id}
            data-active={active || undefined}
            className={`group relative rounded-xl bg-white shadow-[0_1px_4px_rgba(31,36,37,0.14)] transition-shadow ${
              active ? "ring-[1.5px] ring-[#27307A]" : "ring-1 ring-[#303839]/[0.06] hover:shadow-[0_2px_8px_rgba(31,36,37,0.18)]"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectPage(page.id)}
              onDoubleClick={() => { setRenamingId(page.id); setRenameValue(page.label); }}
              aria-pressed={active}
              aria-label={`${page.label}${disabled ? " (off for customers)" : ""}`}
              className="block w-full rounded-xl p-1.5 pb-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              {/* The page itself, drawn by the shared renderer: what the canvas shows, small. */}
              <span className={`block overflow-hidden rounded-md border border-[#303839]/10 bg-white ${disabled ? "opacity-45" : ""}`}>
                <PageThumbnail template={template} pageId={page.id} />
              </span>
            </button>

            <div className="px-2 pb-2 pt-1.5 text-center">
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
                  className="w-full rounded-md border border-[#303839]/20 bg-white px-1.5 py-0.5 text-center text-sm text-[#1f2425] outline-none focus:border-[#303839]/60"
                  aria-label="Page name"
                />
              ) : (
                <span data-page-label className="block truncate text-[15px] text-[#1f2425]">
                  {page.label}
                  {disabled && <span className="text-[#303839]/45"> · off</span>}
                </span>
              )}
              {upload.state.status !== "idle" && upload.state.pageId === page.id && (
                <div className="mt-1.5 text-left">
                  <BackgroundUploadStatus state={upload.state} onRetry={upload.retry} onDismiss={upload.dismiss} />
                </div>
              )}
            </div>

            <button
              type="button"
              aria-label={`Page actions for ${page.label}`}
              aria-expanded={menuFor === page.id}
              onClick={() => setMenuFor(menuFor === page.id ? null : page.id)}
              className={`absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-white/95 text-[#303839] shadow-[0_1px_3px_rgba(31,36,37,0.25)] transition-opacity hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-1 focus-visible:ring-offset-white group-hover:opacity-100 focus-visible:opacity-100 ${
                menuFor === page.id ? "opacity-100" : "opacity-0"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>

            {menuFor === page.id && (
              <div className="absolute right-1 top-11 z-30 grid w-44 gap-0.5 rounded-lg border border-[#303839]/12 bg-white p-1 shadow-xl">
                <button type="button" className={menuItem} onClick={() => { setRenamingId(page.id); setRenameValue(page.label); setMenuFor(null); }}>
                  Rename
                </button>
                <button type="button" className={menuItem} onClick={() => { onDuplicatePage(page.id); setMenuFor(null); }}>
                  Duplicate
                </button>
                <button type="button" className={`${menuItem} disabled:opacity-40`} disabled={upload.busy} onClick={() => { bgTarget.current = page.id; bgInput.current?.click(); setMenuFor(null); }}>
                  {pageHasBackgroundImage(page) ? "Replace background image" : "Set background image"}
                </button>
                {pageHasBackgroundImage(page) && (
                  <button type="button" className={menuItem} onClick={() => { onRemoveBackgroundImage(page.id); setMenuFor(null); }}>
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
                  <button type="button" disabled={index === 0} className={`flex-1 ${menuItem} text-center disabled:opacity-30`} onClick={() => onMovePage(page.id, "up")}>
                    ↑ Move
                  </button>
                  <button type="button" disabled={index === pages.length - 1} className={`flex-1 ${menuItem} text-center disabled:opacity-30`} onClick={() => onMovePage(page.id, "down")}>
                    ↓ Move
                  </button>
                </div>
                <button
                  type="button"
                  disabled={pages.length <= 1}
                  className={`${menuItem} text-red-700 hover:bg-red-50 disabled:opacity-30`}
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
        className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#303839]/25 px-2 py-4 text-sm font-medium text-[#303839]/60 transition-colors hover:border-[#303839]/45 hover:bg-[#303839]/[0.03] hover:text-[#1f2425] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-1 focus-visible:ring-offset-white"
      >
        <span aria-hidden className="text-base leading-none">+</span> Add page
      </button>

      <datalist id="cz-page-label-presets">
        {PAGE_LABEL_PRESETS.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      <input
        ref={bgInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label="Page background image file"
        onChange={(e) => {
          if (bgTarget.current) void upload.start(e.target.files?.[0], bgTarget.current);
          e.target.value = "";
        }}
      />
    </div>
  );
}
