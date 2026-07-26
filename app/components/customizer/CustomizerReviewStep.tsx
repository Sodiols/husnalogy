"use client";

// Review step (Section 14). Shows every enabled page with the customer's full
// edits (values, style overrides, added text), the entered details, the chosen
// options with a price breakdown, completion status, and the approval checkbox
// required before Add to Cart.

import CustomizerPreview from "./CustomizerPreview";
import { getEnabledPages, getImageUrl, isValueEmpty, type EditorState } from "./customizer-utils";
import { formatCurrency } from "@/lib/currency";
import CustomerMockupPreview from "./CustomerMockupPreview";

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
    <div className="flex justify-between gap-4 border-b border-[#303839]/6 py-2 text-sm last:border-b-0">
      <span className="text-[#303839]/50">{label}</span>
      <span className="text-right font-semibold text-[#303839]">{value}</span>
    </div>
  );
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#303839]/8 bg-white p-5">
      <h3 className="mb-1 font-display text-[22px] leading-tight text-[#303839]">{title}</h3>
      {children}
    </section>
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
  customizationId?: string;
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
  customizationId = "",
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
        <CustomerMockupPreview template={template} values={values} editorState={editorState} customizationId={customizationId} saveStatus={saveStatus} />
        {pages.map((page: any) => (
          <div key={page.id}>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.11em] text-[#303839]/45">{page.label}</p>
            <div className="overflow-hidden rounded-xl border border-[#303839]/8 bg-white p-2 shadow-[0_4px_20px_rgba(48,56,57,0.05)]">
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
      <div className="grid content-start gap-4">
        {issues.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
            <p className="flex items-center gap-2 text-sm font-bold text-red-700">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" />
              </svg>
              Please complete before adding to cart
            </p>
            <ul className="mt-2 grid gap-1 text-sm text-red-700">
              {issues.map((issue) => (
                <li key={String(issue)} className="flex gap-2">
                  <span aria-hidden>•</span>
                  <span>{String(issue)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {uploading && (
          <p className="rounded-xl border border-[#D4AF37]/35 bg-[#D4AF37]/10 px-4 py-3 text-sm font-semibold text-[#8a701d]">
            A photo is still uploading — one moment…
          </p>
        )}

        <ReviewCard title="Your details">
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
        </ReviewCard>

        <ReviewCard title="Options">
          <div className="grid">
            {optionEntries.map(([key, value]) => (
              <DetailRow key={key} label={OPTION_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1)} value={String(value)} />
            ))}
            <DetailRow label="Logo on back" value={options?.logo ? "Yes" : "No"} />
            <DetailRow label="Quantity" value={quantity} />
          </div>
        </ReviewCard>

        <div className="rounded-xl border border-[#303839]/8 bg-[#F0EDED] p-5">
          <div className="grid gap-1.5 text-sm tabular-nums">
            <div className="flex justify-between text-[#303839]/60">
              <span>Base price</span>
              <span>{formatCurrency(basePrice, currency)}</span>
            </div>
            <div className="flex justify-between text-[#303839]/60">
              <span>Option upgrades</span>
              <span>{optionsSurcharge > 0 ? `+${formatCurrency(optionsSurcharge, currency)}` : formatCurrency(0, currency)}</span>
            </div>
            <div className="flex justify-between font-semibold text-[#303839]">
              <span>Unit price</span>
              <span>{formatCurrency(unitPrice, currency)}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-[#303839]/10 pt-3">
              <span className="text-sm font-semibold text-[#303839]">Total ({quantity})</span>
              <span className="font-display text-[26px] leading-none text-[#303839]">{formatCurrency(lineTotal, currency)}</span>
            </div>
          </div>
        </div>

        {requireApproval && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#303839]/10 bg-white p-4 text-sm transition-colors hover:border-[#303839]/25 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#D4AF37]">
            <input
              type="checkbox"
              checked={Boolean(approved)}
              onChange={(e) => onApprove(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#303839]"
            />
            <span className="font-medium leading-snug text-[#303839]">{APPROVAL_TEXT}</span>
          </label>
        )}

        {saveStatus === "error" && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
            Your latest changes could not be saved. Please try again before adding to cart.
          </p>
        )}
      </div>
    </div>
  );
}
