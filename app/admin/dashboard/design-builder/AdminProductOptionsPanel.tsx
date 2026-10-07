"use client";

// Product Options manager (Section 32) — the studio's "Options" side panel and
// the Product Options tab. Edits the product's REAL option arrays
// (formatOptions, sizeOptions, …, paperStyleOptions) through structured
// controls. Values are stored back into the same product JSONB fields the
// product page and customizer read, so a change here shows up everywhere.
//
// Styled as the other studio side panels: light-grey cards, dark text, navy
// outlined controls, bold small section headings.

import { useRef, useState, type ReactNode } from "react";
import {
  parseProductOption,
  type ProductOptionEntry,
  type RichProductOption,
} from "@/lib/products/options";
import { uploadBuilderImage } from "./builder-utils";
import { formatCurrencySurcharge } from "@/lib/currency";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import ToolbarPopover, { ToolbarMenuItem } from "./ToolbarPopover";

export const OPTION_GROUPS: Array<{ key: string; title: string; hint: string; supportsImage?: boolean }> = [
  { key: "formatOptions", title: "Choose Your Format", hint: "How the product is delivered (printed, download, both). Leave empty to use the built-in list." },
  { key: "sizeOptions", title: "Size", hint: "Available card / product sizes." },
  { key: "envelopeOptions", title: "Envelopes", hint: "Envelope choices, with optional image and surcharge.", supportsImage: true },
  { key: "cornerOptions", title: "Corner Style", hint: "Corner trim styles shown with a small visual preview." },
  { key: "paperStyleOptions", title: "Paper Style", hint: "Optional paper style group (e.g. Matte Finish, Silk Finish). Hidden from customers when empty." },
  { key: "paperOptions", title: "Paper Type", hint: "Paper stocks. Shown to customers as “Paper Type”." },
  { key: "printingOptions", title: "Printing Process", hint: "Printing upgrades. Shown to customers as “Printing Process”." },
];

const line = (children: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const ICONS = {
  up: line(<path d="m6 15 6-6 6 6" />),
  down: line(<path d="m6 9 6 6 6-6" />),
  edit: line(<><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>),
  more: line(<><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>),
  plus: line(<path d="M12 5v14M5 12h14" />, 14),
  chevron: line(<path d="m6 9 6 6 6-6" />, 14),
};

const INPUT =
  "h-10 w-full rounded-md border border-[#303839]/20 bg-white px-3 text-[14px] text-[#1f2425] outline-none transition-colors placeholder:text-[#303839]/40 focus:border-[#27307A] focus:ring-2 focus:ring-[#27307A]/15";
const LABEL = "mb-1 block text-[12.5px] font-semibold text-[#1f2425]";
const ICON_BUTTON =
  "grid h-8 w-8 cursor-pointer place-items-center rounded-full text-[#1f2425] transition-colors hover:bg-[#303839]/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";
const OUTLINE_PILL =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-[#27307A] bg-white px-3 text-[13px] font-semibold text-[#27307A] transition-colors hover:bg-[#27307A]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50";
const SOLID_PILL =
  "inline-flex h-8 cursor-pointer items-center rounded-full bg-[#27307A] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1f2766] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50";

// Convert any entry to a rich object for editing.
function toRich(entry: ProductOptionEntry): RichProductOption {
  const parsed = parseProductOption(entry);
  return {
    label: parsed?.displayLabel || "",
    value: parsed?.value || "",
    description: parsed?.description || "",
    image: parsed?.image || "",
    imageAssetId: parsed?.imageAssetId || "",
    imageBucket: parsed?.imageBucket || "",
    imagePath: parsed?.imagePath || "",
    imageEditorPath: parsed?.imageEditorPath || "",
    imageThumbnailPath: parsed?.imageThumbnailPath || "",
    surcharge: parsed?.surcharge || 0,
    badge: parsed?.badge || "",
    isDefault: parsed?.isDefault || false,
    active: parsed?.active !== false,
    customerVisible: parsed?.customerVisible !== false,
  };
}

function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "navy" | "gold" }) {
  const tones = { plain: "bg-white text-[#303839]/75", navy: "bg-[#27307A]/10 text-[#27307A]", gold: "bg-[#FFF6DD] text-[#6b5414]" };
  return <span className={`rounded-full px-1.5 py-px text-[11.5px] font-medium ${tones[tone]}`}>{children}</span>;
}

function OptionRow({ entry, index, count, onEdit, onMove, onDelete, onDuplicate, onSetDefault }: any) {
  const parsed = parseProductOption(entry);
  if (!parsed) return null;
  return (
    <div data-option-row className={`flex min-w-0 items-center gap-2.5 rounded-[10px] bg-[#F2F3F5] py-2 pl-3 pr-1.5 ${parsed.active ? "" : "opacity-60"}`}>
      {parsed.image && (
        // eslint-disable-next-line @next/next/no-img-element -- an option thumbnail from the asset API
        <img src={parsed.image} alt="" className="h-9 w-9 shrink-0 rounded-md bg-white object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-[#1f2425]">{parsed.displayLabel}</p>
        {(parsed.surcharge > 0 || parsed.isDefault || parsed.badge || !parsed.active || parsed.description) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-[#303839]/65">
            {parsed.surcharge > 0 && <span>{formatCurrencySurcharge(parsed.surcharge)}</span>}
            {parsed.isDefault && <Chip tone="navy">Default</Chip>}
            {parsed.badge && <Chip tone="gold">{parsed.badge}</Chip>}
            {!parsed.active && <Chip>Unavailable</Chip>}
            {parsed.description && <span className="w-full truncate">{parsed.description}</span>}
          </p>
        )}
      </div>
      <span className="flex shrink-0 items-center">
        <button type="button" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => onMove(index, -1)} data-shape="round" className={ICON_BUTTON}>
          {ICONS.up}
        </button>
        <button type="button" aria-label="Move down" title="Move down" disabled={index === count - 1} onClick={() => onMove(index, 1)} data-shape="round" className={ICON_BUTTON}>
          {ICONS.down}
        </button>
        <button type="button" aria-label={`Edit ${parsed.displayLabel}`} title="Edit" onClick={() => onEdit(index)} data-shape="round" className={ICON_BUTTON}>
          {ICONS.edit}
        </button>
        <ToolbarPopover label={`More actions for ${parsed.displayLabel}`} triggerTitle="More" menuWidth={190} align="end" triggerShape="round" triggerClassName={ICON_BUTTON} trigger={ICONS.more}>
          {(close) => (
            <>
              <ToolbarMenuItem label="Make default" disabled={parsed.isDefault} onSelect={() => { onSetDefault(index); close(); }} />
              <ToolbarMenuItem label="Duplicate" onSelect={() => { onDuplicate(index); close(); }} />
              <ToolbarMenuItem label="Delete" danger onSelect={() => { onDelete(index); close(); }} />
            </>
          )}
        </ToolbarPopover>
      </span>
    </div>
  );
}

function OptionEditor({ initial, supportsImage, wide, onSave, onCancel }: any) {
  const [draft, setDraft] = useState<RichProductOption>(initial);
  const [busy, setBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const patch = (updates: Partial<RichProductOption>) => setDraft((current) => ({ ...current, ...updates }));

  const uploadImage = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const asset = await uploadBuilderImage(file, "image", { customerAvailable: true });
      patch({
        image: `/api/customizer/assets/${asset.id}?variant=editor`,
        imageAssetId: asset.id,
        imageBucket: asset.bucket,
        imagePath: asset.originalPath,
        imageEditorPath: asset.editorPath,
        imageThumbnailPath: asset.thumbnailPath,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-option-editor className="grid min-w-0 gap-3 rounded-[10px] border-[1.5px] border-[#27307A]/30 bg-[#F2F3F5] p-3">
      <div className={`grid gap-2.5 ${wide ? "sm:grid-cols-2" : ""}`}>
        <label className="block">
          <span className={LABEL}>
            Customer label <span className="text-red-700" aria-hidden>*</span>
          </span>
          <input className={INPUT} value={draft.label} required onChange={(e) => patch({ label: e.target.value })} />
        </label>
        <label className="block">
          <span className={LABEL}>Price surcharge (৳)</span>
          <EditableNumericStepper
            label="Price surcharge"
            value={draft.surcharge || 0}
            minimum={0}
            step={0.01}
            largeStep={1}
            allowNegative={false}
            allowDecimal
            showStepButtons={false}
            onCommit={(surcharge) => patch({ surcharge })}
            className="h-10 w-full"
            inputClassName={INPUT}
          />
        </label>
        <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
          <span className={LABEL}>Short description</span>
          <input className={INPUT} value={draft.description || ""} onChange={(e) => patch({ description: e.target.value })} />
        </label>
        <label className="block">
          <span className={LABEL}>Badge</span>
          <span className="relative block min-w-0">
            <select className={`${INPUT} cursor-pointer appearance-none pr-10`} value={draft.badge || ""} onChange={(e) => patch({ badge: e.target.value })}>
              <option value="">None</option>
              <option value="Best Seller">Best Seller</option>
              <option value="Recommended">Recommended</option>
              <option value="New">New</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#303839]/55">{ICONS.chevron}</span>
          </span>
        </label>
        <label className="block">
          <span className={LABEL}>Internal value</span>
          <input className={INPUT} value={draft.value || ""} placeholder="Made from the label" onChange={(e) => patch({ value: e.target.value })} />
        </label>
      </div>

      {supportsImage && (
        <div className="flex items-center gap-2.5">
          {draft.image && (
            // eslint-disable-next-line @next/next/no-img-element -- an option thumbnail from the asset API
            <img src={draft.image} alt="" className="h-10 w-10 rounded-md bg-white object-cover" />
          )}
          <button type="button" data-shape="round" onClick={() => imageInput.current?.click()} disabled={busy} className={OUTLINE_PILL}>
            {busy ? "Uploading…" : draft.image ? "Replace image" : "Add image"}
          </button>
          {draft.image && (
            <button
              type="button"
              onClick={() => patch({ image: "", imageAssetId: "", imageBucket: "", imagePath: "", imageEditorPath: "", imageThumbnailPath: "" })}
              className="cursor-pointer text-[13px] font-semibold text-red-700 underline-offset-2 hover:underline"
            >
              Remove
            </button>
          )}
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Option image"
            onChange={(e) => {
              uploadImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#303839]/10 pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#1f2425]">
          <input type="checkbox" checked={draft.active !== false} onChange={(e) => patch({ active: e.target.checked })} className="h-4 w-4 cursor-pointer accent-[#27307A]" />
          Available
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#1f2425]">
          <input type="checkbox" checked={draft.customerVisible !== false} onChange={(e) => patch({ customerVisible: e.target.checked })} className="h-4 w-4 cursor-pointer accent-[#27307A]" />
          Visible to customers
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#1f2425]">
          <input type="checkbox" checked={draft.isDefault === true} onChange={(e) => patch({ isDefault: e.target.checked })} className="h-4 w-4 cursor-pointer accent-[#27307A]" />
          Default selection
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" data-shape="round" onClick={onCancel} className={OUTLINE_PILL}>
          Cancel
        </button>
        <button type="button" data-shape="round" disabled={!draft.label.trim()} onClick={() => onSave(draft)} className={SOLID_PILL}>
          Save option
        </button>
      </div>
    </div>
  );
}

function OptionGroupEditor({ group, entries, onChange, wide }: any) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const list: ProductOptionEntry[] = Array.isArray(entries) ? entries : [];

  const commit = (next: ProductOptionEntry[]) => onChange(group.key, next);

  const move = (index: number, delta: number) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  const setDefault = (index: number) => {
    commit(list.map((entry, i) => ({ ...toRich(entry), isDefault: i === index })));
  };

  const saveEdited = (index: number, draft: RichProductOption) => {
    const next = list.map((entry, i) => (i === index ? { ...draft } : draft.isDefault ? { ...toRich(entry), isDefault: false } : entry));
    commit(next);
    setEditingIndex(null);
  };

  const saveNew = (draft: RichProductOption) => {
    const cleared = draft.isDefault ? list.map((entry) => ({ ...toRich(entry), isDefault: false })) : list;
    commit([...cleared, draft]);
    setAddingNew(false);
  };

  return (
    <section className={wide ? "grid min-w-0 content-start gap-2.5 rounded-[12px] border border-[#303839]/10 bg-white p-4" : "grid min-w-0 gap-2.5"} data-option-group={group.key}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold text-[#1f2425]">{group.title}</h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[#303839]/65">{group.hint}</p>
        </div>
        <button
          type="button"
          data-shape="round"
          aria-label={`Add option to ${group.title}`}
          onClick={() => {
            setAddingNew(true);
            setEditingIndex(null);
          }}
          className={`${OUTLINE_PILL} shrink-0`}
        >
          {ICONS.plus} Add
        </button>
      </div>

      <div className="grid min-w-0 gap-1.5">
        {list.map((entry, index) =>
          editingIndex === index ? (
            <OptionEditor
              key={index}
              initial={toRich(entry)}
              supportsImage={group.supportsImage}
              wide={wide}
              onSave={(draft: RichProductOption) => saveEdited(index, draft)}
              onCancel={() => setEditingIndex(null)}
            />
          ) : (
            <OptionRow
              key={index}
              entry={entry}
              index={index}
              count={list.length}
              onEdit={(i: number) => {
                setEditingIndex(i);
                setAddingNew(false);
              }}
              onMove={move}
              onDelete={(i: number) => commit(list.filter((_, j) => j !== i))}
              onDuplicate={(i: number) => {
                const copy = { ...toRich(list[i]), isDefault: false };
                copy.label = `${copy.label} copy`;
                copy.value = "";
                commit([...list.slice(0, i + 1), copy, ...list.slice(i + 1)]);
              }}
              onSetDefault={setDefault}
            />
          ),
        )}
        {!list.length && !addingNew && <p className="rounded-[10px] bg-[#F2F3F5] px-3 py-3 text-[13px] text-[#303839]/65">No options yet.</p>}
        {addingNew && (
          <OptionEditor
            initial={{ label: "", surcharge: 0, active: true, customerVisible: true, isDefault: false }}
            supportsImage={group.supportsImage}
            wide={wide}
            onSave={saveNew}
            onCancel={() => setAddingNew(false)}
          />
        )}
      </div>
    </section>
  );
}

type Props = {
  /** "panel": the studio's narrow Options side panel; "page": the wide Product Options tab. */
  layout?: "panel" | "page";
  productOptions: Record<string, ProductOptionEntry[]>;
  quantityOptions: any[];
  onOptionsChange: (key: string, entries: ProductOptionEntry[]) => void;
  onQuantityOptionsChange: (values: string[]) => void;
};

export default function AdminProductOptionsPanel({
  layout = "page",
  productOptions,
  quantityOptions,
  onOptionsChange,
  onQuantityOptionsChange,
}: Props) {
  const wide = layout === "page";
  return (
    <div className={wide ? "mx-auto grid w-full max-w-7xl gap-5 p-4 md:p-6 xl:grid-cols-2 2xl:p-8" : "grid gap-5 px-4 pb-6 pt-1"} data-admin-options-panel={layout}>
      <p className={`text-[14px] leading-relaxed text-[#303839]/75 ${wide ? "xl:col-span-2" : ""}`}>
        The choices customers make on the product page and in the Options step — format, size, envelopes, paper and printing.
        Surcharges are added to the unit price automatically.
      </p>

      {OPTION_GROUPS.map((group, index) => (
        <div key={group.key} className={`min-w-0 ${!wide && index > 0 ? "border-t border-[#303839]/10 pt-5" : ""}`}>
          <OptionGroupEditor group={group} entries={productOptions[group.key] || []} onChange={onOptionsChange} wide={wide} />
        </div>
      ))}

      <section className={wide ? "grid gap-2.5 rounded-[12px] border border-[#303839]/10 bg-white p-4 xl:col-span-2" : "grid gap-2.5 border-t border-[#303839]/10 pt-5"}>
        <div>
          <h3 className="text-[14px] font-bold text-[#1f2425]">Quantity</h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[#303839]/65">Quantities customers can order, separated by commas (e.g. 1, 10, 20, 50, 100).</p>
        </div>
        <input
          className={INPUT}
          value={(quantityOptions || []).map((entry: any) => (typeof entry === "object" ? entry?.label : entry)).join(", ")}
          onChange={(e) =>
            onQuantityOptionsChange(
              e.target.value
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value && Number(value) > 0),
            )
          }
          aria-label="Quantity options"
        />
      </section>
    </div>
  );
}
