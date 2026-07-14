"use client";

// Review step (Section 14). Shows every enabled page with the customer's full
// edits (values, style overrides, added text), the entered details, the chosen
// options with a price breakdown, completion status, and the approval checkbox
// required before Add to Cart.

import CustomizerPreview from "./CustomizerPreview";
import { getEnabledPages, getImageUrl, isValueEmpty, type EditorState } from "./customizer-utils";
import { formatCurrency } from "@/lib/currency";

const APPROVAL_TEXT = "I have checked all names, dates, spelling, photos, and event details.";

const OPTION_LABELS: Record<string, string> = {
  format: "Format",
  size: "Size",
  envelope: "Envelopes",
  corner: "Corner style",
  paperStyle: "Paper style",
  paper: "Paper type",
  printing: "Printing process",
};

function DetailRow({ label, value }: any) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#303839]/8 py-1.5 text-sm">
      <span className="text-[#303839]/60">{label}</span>
      <span className="text-right font-semibold text-[#303839]">{value}</span>
    </div>
  );
}

type Props = {
  template: any;
  values: Record<string, any>;
  editorState?: EditorState;
  options: Record<string, any>;
  quantity: number;
  basePrice: number;
  optionsSurcharge: number;
  unitPrice: number;
  approved: boolean;
  onApprove: (approved: boolean) => void;
  requireApproval?: boolean;
  validationErrors?: Record<string, string>;
  uploading?: boolean;
  saveStatus?: string;
  currency?: string;
};

export default function CustomizerReviewStep({
  template,
  values,
  editorState,
  options,
  quantity,
  basePrice,
  optionsSurcharge,
  unitPrice,
  approved,
  onApprove,
  requireApproval = true,
  validationErrors = {},
  uploading = false,
  saveStatus = "",
  currency = "BDT",
}: Props) {
  const pages = getEnabledPages(template);
  const fields = template?.fields || [];
  const lineTotal = Number((unitPrice * quantity).toFixed(2));
  const issues = Object.values(validationErrors);

  const optionEntries = Object.entries(options || {}).filter(
    ([key, v]) => key !== "logo" && typeof v === "string" && v,
  );

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 p-4 sm:p-8 lg:grid-cols-2">
      {/* Left: all pages with the complete customer design */}
      <div className="grid content-start gap-5">
        {pages.map((page: any) => (
          <div key={page.id}>
            <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-[#303839]/60">{page.label}</p>
            <div className="rounded-lg border border-[#303839]/12 bg-white p-2 shadow-[0_6px_24px_rgba(48,56,57,0.06)]">
              <CustomizerPreview
                template={template}
                values={values}
                editorState={editorState}
                page={page.id}
                showSafeArea={false}
                showBleed={false}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Right: details, options, price, approval */}
      <div className="grid content-start gap-6">
        {issues.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-sm font-bold text-red-700">Please complete before adding to cart:</p>
            <ul className="mt-1.5 grid gap-0.5 text-sm text-red-700">
              {issues.map((issue) => (
                <li key={String(issue)}>• {String(issue)}</li>
              ))}
            </ul>
          </div>
        )}

        {uploading && (
          <p className="rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-4 py-3 text-sm font-bold text-[#8a701d]">
            A photo is still uploading — one moment…
          </p>
        )}

        <div>
          <h3 className="mb-2 font-display text-2xl text-[#303839]">Your details</h3>
          <div className="grid">
            {fields.map((field: any) => {
              const raw = values[field.id];
              if (isValueEmpty(raw)) return null;
              const display =
                field.type === "image" || field.type === "file"
                  ? getImageUrl(raw)
                    ? "Photo added"
                    : ""
                  : field.type === "checkbox"
                    ? raw
                      ? "Yes"
                      : ""
                    : String(raw);
              if (!display) return null;
              return <DetailRow key={field.id} label={field.label} value={display} />;
            })}
            {(editorState?.userLayers || []).length > 0 && (
              <DetailRow
                label="Your added text"
                value={`${editorState!.userLayers.length} text ${editorState!.userLayers.length === 1 ? "box" : "boxes"}`}
              />
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 font-display text-2xl text-[#303839]">Options</h3>
          <div className="grid">
            {optionEntries.map(([key, value]) => (
              <DetailRow key={key} label={OPTION_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1)} value={String(value)} />
            ))}
            <DetailRow label="Logo on back" value={options?.logo ? "Yes" : "No"} />
            <DetailRow label="Quantity" value={quantity} />
          </div>
        </div>

        <div className="rounded-lg bg-[#F8F6F1] p-4">
          <div className="grid gap-1 text-sm">
            <div className="flex justify-between text-[#303839]/70">
              <span>Base price</span>
              <span>{formatCurrency(basePrice, currency)}</span>
            </div>
            <div className="flex justify-between text-[#303839]/70">
              <span>Option upgrades</span>
              <span>{optionsSurcharge > 0 ? `+${formatCurrency(optionsSurcharge, currency)}` : formatCurrency(0, currency)}</span>
            </div>
            <div className="flex justify-between font-semibold text-[#303839]">
              <span>Unit price</span>
              <span>{formatCurrency(unitPrice, currency)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-[#303839]/12 pt-2 text-base font-extrabold text-[#303839]">
              <span>Total ({quantity})</span>
              <span>{formatCurrency(lineTotal, currency)}</span>
            </div>
          </div>
        </div>

        {requireApproval && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#303839]/15 bg-[#F4ECEC] p-4 text-sm">
            <input
              type="checkbox"
              checked={Boolean(approved)}
              onChange={(e) => onApprove(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#303839]"
            />
            <span className="font-semibold text-[#303839]">{APPROVAL_TEXT}</span>
          </label>
        )}

        {saveStatus === "error" && (
          <p className="text-sm font-bold text-red-700" role="alert">
            Your latest changes could not be saved. Please try again before adding to cart.
          </p>
        )}
      </div>
    </div>
  );
}
