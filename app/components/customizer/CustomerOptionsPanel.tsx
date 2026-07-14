"use client";

// Customer Options panel (Section 10). Renders the REAL product option
// configuration (strings or rich option objects) in the required group order.
// Selected values are stored as label strings carrying any "+$x" surcharge so
// the existing getOptionsSurcharge pricing keeps working end to end.

import { useMemo } from "react";
import {
  parseProductOptionList,
  type ParsedProductOption,
} from "@/lib/products/options";
import { formatCurrency, formatCurrencySurcharge, normalizeCurrency } from "@/lib/currency";

export const CUSTOMIZER_FORMAT_OPTIONS = [
  "Printed Flat Card",
  "Prints + Instant Download",
  "Instant Download",
];

function Badge({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span className="rounded-full bg-[#D4AF37]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#8a701d]">
      {text}
    </span>
  );
}

function localizedCartValue(option: ParsedProductOption, currency: string) {
  if (!option.surcharge) return option.displayLabel;
  return `${option.displayLabel} ${formatCurrencySurcharge(option.surcharge, currency)}`;
}

function CornerPreview({ option }: { option: ParsedProductOption }) {
  const name = option.displayLabel.toLowerCase();
  const radius = name.includes("round")
    ? "6px"
    : name.includes("arch")
      ? "12px 12px 0 0"
      : name.includes("scallop")
        ? "50% 0 50% 0"
        : name.includes("bracket")
          ? "10px 0 10px 0"
          : name.includes("ticket")
            ? "50%"
            : "0";
  return (
    <span
      aria-hidden
      className="block h-8 w-8 border-2 border-[#303839]/50 bg-white"
      style={{ borderRadius: radius }}
    />
  );
}

function OptionButton({ option, active, onClick, currency, showImage = false, compact = false }: {
  option: ParsedProductOption;
  active: boolean;
  onClick: () => void;
  currency: string;
  showImage?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 text-left transition ${compact ? "py-2" : "py-2.5"} ${
        active
          ? "border-[#303839] bg-[#303839] text-white"
          : "border-[#303839]/12 bg-white text-[#303839] hover:bg-[#F4ECEC]"
      }`}
    >
      {showImage && option.image && (
        <img src={option.image} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" draggable={false} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold">{option.displayLabel}</span>
          <Badge text={option.badge} />
        </span>
        {option.description && (
          <span className={`mt-0.5 block text-xs ${active ? "text-white/70" : "text-[#303839]/55"}`}>
            {option.description}
          </span>
        )}
      </span>
      {option.surcharge > 0 && (
        <span className={`shrink-0 text-xs font-bold ${active ? "text-white/85" : "text-[#303839]/60"}`}>
          {formatCurrencySurcharge(option.surcharge, currency)}
        </span>
      )}
    </button>
  );
}

function OptionGroup({ title, options, value, onChange, currency, showImage = false, corner = false }: {
  title: string;
  options: ParsedProductOption[];
  value: string;
  onChange: (cartValue: string) => void;
  currency: string;
  showImage?: boolean;
  corner?: boolean;
}) {
  if (!options.length) return null;
  const isActive = (option: ParsedProductOption) =>
    value === option.cartValue ||
    value === localizedCartValue(option, currency) ||
    value === option.displayLabel ||
    value === option.label;

  if (corner) {
    return (
      <div>
        <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#303839]">{title}</h4>
        <div className="grid grid-cols-3 gap-2">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(localizedCartValue(option, currency))}
              aria-pressed={isActive(option)}
              className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 transition ${
                isActive(option)
                  ? "border-[#303839] bg-[#303839] text-white"
                  : "border-[#303839]/12 bg-white text-[#303839] hover:bg-[#F4ECEC]"
              }`}
            >
              <CornerPreview option={option} />
              <span className="text-[11px] font-bold">{option.displayLabel}</span>
              {option.surcharge > 0 && <span className="text-[10px] opacity-70">{formatCurrencySurcharge(option.surcharge, currency)}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#303839]">{title}</h4>
      <div className="grid gap-2">
        {options.map((option) => (
          <OptionButton
            key={option.value}
            option={option}
            active={isActive(option)}
            onClick={() => onChange(localizedCartValue(option, currency))}
            currency={currency}
            showImage={showImage}
          />
        ))}
      </div>
    </div>
  );
}

type Props = {
  product: any;
  options: Record<string, any>;
  onOptionChange: (key: string, value: any) => void;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  unitPrice: number;
};

export default function CustomerOptionsPanel({
  product,
  options,
  onOptionChange,
  quantity,
  onQuantityChange,
  unitPrice,
}: Props) {
  const currency = normalizeCurrency(product.currency);
  const parse = (value: any, fallback: any[] = []) =>
    parseProductOptionList(value, { customerFacing: true, fallback });

  // formatOptions come from the product when configured; otherwise the
  // customizer's long-standing fallback list.
  const formatOptions = useMemo(
    () => parse(product.formatOptions, CUSTOMIZER_FORMAT_OPTIONS),
    [product.formatOptions],
  );
  const sizeOptions = useMemo(() => parse(product.sizeOptions), [product.sizeOptions]);
  const envelopeOptions = useMemo(() => parse(product.envelopeOptions), [product.envelopeOptions]);
  const cornerOptions = useMemo(() => parse(product.cornerOptions), [product.cornerOptions]);
  const paperStyleOptions = useMemo(() => parse(product.paperStyleOptions), [product.paperStyleOptions]);
  const paperOptions = useMemo(() => parse(product.paperOptions), [product.paperOptions]);
  const printingOptions = useMemo(() => parse(product.printingOptions), [product.printingOptions]);

  const quantityOptions = useMemo(() => {
    const list = Array.isArray(product.quantityOptions) && product.quantityOptions.length
      ? product.quantityOptions
      : ["1", "10", "20", "30", "40", "50"];
    return list.map((entry: any) => String(typeof entry === "object" ? entry?.label : entry)).filter(Boolean);
  }, [product.quantityOptions]);

  return (
    <div className="grid gap-6 p-4">
      <OptionGroup title="Choose Your Format" options={formatOptions} value={options.format} onChange={(v) => onOptionChange("format", v)} currency={currency} />
      <OptionGroup title="Size" options={sizeOptions} value={options.size} onChange={(v) => onOptionChange("size", v)} currency={currency} />
      <OptionGroup title="Envelopes" options={envelopeOptions} value={options.envelope} onChange={(v) => onOptionChange("envelope", v)} currency={currency} showImage />
      <OptionGroup title="Corner Style" options={cornerOptions} value={options.corner} onChange={(v) => onOptionChange("corner", v)} currency={currency} corner />
      <OptionGroup title="Paper Style" options={paperStyleOptions} value={options.paperStyle} onChange={(v) => onOptionChange("paperStyle", v)} currency={currency} />
      <OptionGroup title="Paper Type" options={paperOptions} value={options.paper} onChange={(v) => onOptionChange("paper", v)} currency={currency} />
      <OptionGroup title="Printing Process" options={printingOptions} value={options.printing} onChange={(v) => onOptionChange("printing", v)} currency={currency} />

      <div>
        <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#303839]">Quantity</h4>
        <div className="flex flex-wrap gap-2">
          {quantityOptions.map((q: string) => {
            const active = String(quantity) === String(q);
            return (
              <button
                key={q}
                type="button"
                aria-pressed={active}
                onClick={() => onQuantityChange(Number(q) || 1)}
                className={`min-w-[56px] rounded-lg border px-3 py-2 text-sm font-bold transition ${
                  active
                    ? "border-[#303839] bg-[#303839] text-white"
                    : "border-[#303839]/12 bg-white text-[#303839] hover:bg-[#F4ECEC]"
                }`}
              >
                {q}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#303839]">Husnalogy logo</h4>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(options.logo)}
          onClick={() => onOptionChange("logo", !options.logo)}
          className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-sm transition ${
            options.logo ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/12 bg-white text-[#303839] hover:bg-[#F4ECEC]"
          }`}
        >
          <span className="font-bold">Add subtle logo to back of card</span>
          <span className={`relative h-6 w-11 rounded-full transition ${options.logo ? "bg-white" : "bg-[#303839]/25"}`} aria-hidden>
            <span className={`absolute top-1 h-4 w-4 rounded-full transition ${options.logo ? "left-6 bg-[#303839]" : "left-1 bg-white"}`} />
          </span>
        </button>
      </div>

      <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-[#303839]/10 bg-white px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#303839]/60">
            {quantity} × {formatCurrency(unitPrice, currency)}
          </span>
          <span className="font-extrabold text-[#303839]">{formatCurrency(unitPrice * quantity, currency)}</span>
        </div>
      </div>
    </div>
  );
}
