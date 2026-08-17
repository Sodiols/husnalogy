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
            className={`group shrink-0 rounded-md text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
              orientation === "horizontal" ? "w-24 sm:w-28" : "w-24 sm:w-full"
            } ${active ? "" : "opacity-75 hover:opacity-100"}`}
          >
            <div
              className={`overflow-hidden rounded-md border-2 bg-white transition ${
                active ? "border-[#303839]" : "border-[#303839]/12 group-hover:border-[#303839]/35"
              }`}
            >
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
              className={`mt-1 block text-center text-[11px] font-bold ${active ? "text-[#303839]" : "text-[#303839]/55"}`}
            >
              {page.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
