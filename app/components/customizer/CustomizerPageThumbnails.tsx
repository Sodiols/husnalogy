"use client";

// Right-column page switcher: a small live thumbnail per enabled page.
import CustomizerPreview from "./CustomizerPreview";
import { getEnabledPages } from "./customizer-utils";

export default function CustomizerPageThumbnails({ template, values, activePage, onSelect, orientation = "vertical" }: any) {
  const pages = getEnabledPages(template);
  if (pages.length <= 1) return null;

  return (
    <div className={orientation === "horizontal" ? "flex gap-3" : "grid gap-3"}>
      {pages.map((page: any) => {
        const active = page.id === activePage;
        return (
          <button
            key={page.id}
            type="button"
            onClick={() => onSelect(page.id)}
            className={`group text-left transition ${active ? "" : "opacity-80 hover:opacity-100"}`}
          >
            <div className={`overflow-hidden border bg-white ${active ? "border-[#303839]" : "border-[#303839]/15"}`}>
              <CustomizerPreview template={template} values={values} page={page.id} showSafeArea={false} showBleed={false} />
            </div>
            <span className={`mt-1 block text-center text-xs font-bold ${active ? "text-[#303839]" : "text-[#303839]/55"}`}>{page.label}</span>
          </button>
        );
      })}
    </div>
  );
}
