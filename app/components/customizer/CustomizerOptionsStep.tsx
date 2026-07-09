"use client";

// Options step (Part 12). Reuses the product's existing option arrays so the
// selections and pricing stay consistent with the standard product page. Each
// selected value is stored as its label string, so the shared
// getOptionsSurcharge() parser reads any "+$x" the label carries.

export const CUSTOMIZER_FORMAT_OPTIONS = [
  "Printed Flat Card",
  "Prints + Instant Download",
  "Instant Download",
];

function OptionRow({ title, options, value, onChange }: { title: string; options: string[]; value: string; onChange: (v: string) => void }) {
  if (!options.length) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#303839]">{title}</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`border px-3 py-2.5 text-left text-sm transition ${
                active ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/12 bg-white text-[#303839] hover:bg-[#F4ECEC]"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toArray(value: any, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split("\n").map((v) => v.trim()).filter(Boolean);
  return fallback;
}

export default function CustomizerOptionsStep({ product, options, onOptionChange, quantity, onQuantityChange }: any) {
  const sizeOptions = toArray(product.sizeOptions);
  const envelopeOptions = toArray(product.envelopeOptions);
  const cornerOptions = toArray(product.cornerOptions);
  const paperOptions = toArray(product.paperOptions);
  const printingOptions = toArray(product.printingOptions);
  const quantityOptions = toArray(product.quantityOptions, ["1", "10", "20", "30", "40", "50"]);

  return (
    <div className="grid gap-6">
      <OptionRow title="Format" options={CUSTOMIZER_FORMAT_OPTIONS} value={options.format} onChange={(v) => onOptionChange("format", v)} />
      <OptionRow title="Size" options={sizeOptions} value={options.size} onChange={(v) => onOptionChange("size", v)} />

      <div>
        <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#303839]">Quantity</h4>
        <div className="flex flex-wrap gap-2">
          {quantityOptions.map((q: string) => {
            const active = String(quantity) === String(q);
            return (
              <button
                key={q}
                type="button"
                onClick={() => onQuantityChange(Number(q) || 1)}
                className={`min-w-[56px] border px-3 py-2 text-sm font-bold transition ${
                  active ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/12 bg-white text-[#303839] hover:bg-[#F4ECEC]"
                }`}
              >
                {q}
              </button>
            );
          })}
        </div>
      </div>

      <OptionRow title="Envelopes" options={envelopeOptions} value={options.envelope} onChange={(v) => onOptionChange("envelope", v)} />
      <OptionRow title="Corner style" options={cornerOptions} value={options.corner} onChange={(v) => onOptionChange("corner", v)} />
      <OptionRow title="Paper type" options={paperOptions} value={options.paper} onChange={(v) => onOptionChange("paper", v)} />
      <OptionRow title="Printing" options={printingOptions} value={options.printing} onChange={(v) => onOptionChange("printing", v)} />

      <div>
        <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#303839]">Husnalogy logo</h4>
        <button
          type="button"
          onClick={() => onOptionChange("logo", !options.logo)}
          className={`flex w-full items-center justify-between border px-3 py-3 text-sm transition ${
            options.logo ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/12 bg-white text-[#303839] hover:bg-[#F4ECEC]"
          }`}
        >
          <span className="font-bold">Add subtle logo to back of card</span>
          <span className={`relative h-6 w-11 rounded-full transition ${options.logo ? "bg-white" : "bg-[#303839]/25"}`}>
            <span className={`absolute top-1 h-4 w-4 rounded-full transition ${options.logo ? "left-6 bg-[#303839]" : "left-1 bg-white"}`} />
          </span>
        </button>
      </div>
    </div>
  );
}
