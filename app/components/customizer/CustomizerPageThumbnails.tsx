"use client";

// Page switcher thumbnails: a live mini render per enabled page, produced by
// the same shared renderer (so customer values, uploads, style overrides, and
// added text always appear). Vertical on desktop, horizontal on mobile.

import CustomizerPreview from "./CustomizerPreview";
import { getEnabledPages, type EditorState } from "./customizer-utils";

type Props = {
  template: any;
  values: Record<string, any>;
  editorState?: EditorState;
  activePage: string;
  onSelect: (pageId: string) => void;
  orientation?: "vertical" | "horizontal";
  showSinglePage?: boolean;
};

export default function CustomizerPageThumbnails({
  template,
  values,
  editorState,
  activePage,
  onSelect,
  orientation = "vertical",
  showSinglePage = false,
}: Props) {
  const pages = getEnabledPages(template);
  if (pages.length <= 1 && !showSinglePage) return null;

  return (
    <div className={orientation === "horizontal" ? "flex gap-3" : "grid gap-3"}>
      {pages.map((page: any) => {
        const active = page.id === activePage;
        return (
          <button
            key={page.id}
            type="button"
            onClick={() => onSelect(page.id)}
            aria-pressed={active}
            aria-label={`Edit ${page.label}`}
            // Width follows the ORIENTATION. The vertical sidebar fills its
            // column; the horizontal strip must stay a small thumbnail at every
            // width — `sm:w-full` used to apply to both, so on a 768px tablet
            // each "thumbnail" grew to ~744px wide and ~1040px tall, collapsing
            // the canvas to a 64px sliver.
            className={`group shrink-0 cursor-pointer rounded-xl bg-white p-1.5 pb-0 text-left shadow-[0_1px_4px_rgba(31,36,37,0.14)] transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
              orientation === "horizontal" ? "w-24 sm:w-28" : "w-24 sm:w-full"
            } ${active ? "ring-[1.5px] ring-[#303839]" : "ring-1 ring-[#303839]/[0.06] hover:shadow-[0_2px_8px_rgba(31,36,37,0.18)]"}`}
          >
            <div className="overflow-hidden rounded-md border border-[#303839]/10 bg-white">
              <CustomizerPreview
                template={template}
                values={values}
                editorState={editorState}
                page={page.id}
                showSafeArea={false}
                showBleed={false}
              />
            </div>
            <span
              className={`block truncate px-1 py-1.5 text-center text-[13px] ${active ? "font-semibold text-[#1f2425]" : "text-[#303839]/75"}`}
            >
              {page.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
