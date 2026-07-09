"use client";

// Front / Back page switch for the builder top bar.
export default function AdminPageSwitcher({ template, activePage, onSelect, onToggleBack }: any) {
  const pages = template?.pages || [];
  const back = pages.find((p: any) => p.id === "back");

  return (
    <div className="flex items-center gap-1">
      {pages
        .filter((p: any) => p.id === "front" || p.enabled !== false)
        .map((page: any) => (
          <button
            key={page.id}
            type="button"
            onClick={() => onSelect(page.id)}
            className={`px-3 py-1.5 text-xs font-bold transition ${activePage === page.id ? "bg-[#111111] text-white" : "bg-[#F8F8F8] text-[#111111] hover:bg-[#E6E6E6]"}`}
          >
            {page.label}
          </button>
        ))}
      <label className="ml-2 flex items-center gap-1.5 text-[11px] font-bold text-[#111111]/70">
        <input type="checkbox" checked={back?.enabled !== false && Boolean(back)} onChange={(e) => onToggleBack(e.target.checked)} className="h-3.5 w-3.5 accent-[#111111]" />
        Back side
      </label>
    </div>
  );
}
