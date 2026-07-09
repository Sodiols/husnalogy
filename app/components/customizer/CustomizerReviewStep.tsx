"use client";

// Review step (Part 9). Shows front/back previews, the entered details, chosen
// options and price, and requires an approval checkbox before add-to-cart.

import CustomizerPreview from "./CustomizerPreview";
import { getEnabledPages, getImageUrl, isValueEmpty } from "./customizer-utils";

const APPROVAL_TEXT = "I have checked all names, dates, spelling, photos, and event details.";

function DetailRow({ label, value }: any) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#303839]/8 py-1.5 text-sm">
      <span className="text-[#303839]/60">{label}</span>
      <span className="text-right font-semibold text-[#303839]">{value}</span>
    </div>
  );
}

export default function CustomizerReviewStep({
  template,
  values,
  options,
  quantity,
  unitPrice,
  approved,
  onApprove,
  requireApproval = true,
}: any) {
  const pages = getEnabledPages(template);
  const fields = template?.fields || [];
  const lineTotal = Number((unitPrice * quantity).toFixed(2));

  const optionEntries = Object.entries(options || {}).filter(([key, v]) => key !== "logo" && v);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-4">
        {pages.map((page: any) => (
          <div key={page.id}>
            <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-[#303839]/60">{page.label}</p>
            <div className="border border-[#303839]/12 bg-white p-2">
              <CustomizerPreview template={template} values={values} page={page.id} showSafeArea={false} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid content-start gap-5">
        <div>
          <h3 className="mb-2 font-display text-xl text-[#303839]">Your details</h3>
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
          </div>
        </div>

        <div>
          <h3 className="mb-2 font-display text-xl text-[#303839]">Options</h3>
          <div className="grid">
            {optionEntries.map(([key, value]) => (
              <DetailRow key={key} label={key.charAt(0).toUpperCase() + key.slice(1)} value={String(value)} />
            ))}
            <DetailRow label="Logo on back" value={options?.logo ? "Yes" : "No"} />
            <DetailRow label="Quantity" value={quantity} />
            <DetailRow label="Unit price" value={`$${unitPrice.toFixed(2)}`} />
            <div className="flex justify-between gap-4 py-2 text-sm font-extrabold text-[#303839]">
              <span>Total</span>
              <span>${lineTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {requireApproval && (
          <label className="flex cursor-pointer items-start gap-3 border border-[#303839]/15 bg-[#F4ECEC] p-4 text-sm">
            <input type="checkbox" checked={Boolean(approved)} onChange={(e) => onApprove(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#303839]" />
            <span className="font-semibold text-[#303839]">{APPROVAL_TEXT}</span>
          </label>
        )}
      </div>
    </div>
  );
}
