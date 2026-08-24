"use client";

// Admin "allowed customer fonts" picker (spec §11).
//
// Reuses the same searchable GoogleFontSelector rather than rendering
// thousands of checkboxes: admins add families one at a time and see the
// current selection as removable chips. An empty selection keeps the existing
// Husnalogy rule — every Google Font is allowed.

import GoogleFontSelector from "./GoogleFontSelector";

type Props = {
  value: string[];
  onChange: (families: string[]) => void;
};

export default function GoogleFontMultiSelect({ value, onChange }: Props) {
  const selected = Array.isArray(value) ? value.filter(Boolean) : [];
  const allGoogleFonts = selected.length === 0;

  const add = (family: string) => {
    if (!family || selected.some((item) => item.toLowerCase() === family.toLowerCase())) return;
    onChange([...selected, family]);
  };

  const remove = (family: string) => {
    onChange(selected.filter((item) => item !== family));
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <GoogleFontSelector
          label="Add an allowed font"
          value=""
          onChange={add}
          className="min-w-0 flex-1"
        />
        {!allGoogleFonts && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="shrink-0 rounded-lg border border-[#303839]/15 px-2.5 py-2 text-[11px] font-bold text-[#303839] transition-colors hover:bg-[#F4ECEC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
          >
            Allow all
          </button>
        )}
      </div>

      {allGoogleFonts ? (
        <p className="rounded-lg bg-[#F8F6F1] px-3 py-2 text-[11px] leading-4 text-[#303839]/60">
          <strong className="font-bold text-[#303839]">All Google Fonts</strong> — customers can search the
          complete catalog. Add families above to restrict the choice.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((family) => (
            <li key={family}>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#303839]/12 bg-white py-1 pl-2.5 pr-1 text-[11px] font-semibold text-[#303839]">
                <span style={{ fontFamily: `"${family}", sans-serif` }}>{family}</span>
                <button
                  type="button"
                  onClick={() => remove(family)}
                  aria-label={`Remove ${family}`}
                  className="grid h-5 w-5 place-items-center rounded-full text-[#303839]/50 transition-colors hover:bg-[#303839]/8 hover:text-[#303839] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
