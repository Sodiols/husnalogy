"use client";

// Product Options manager tab (Section 32). Edits the product's REAL option
// arrays (formatOptions, sizeOptions, …, paperStyleOptions) through structured
// controls. Values are stored back into the same product JSONB fields the
// product page and customizer read, so a change here shows up everywhere.

import { useRef, useState } from "react";
import {
  parseProductOption,
  type ProductOptionEntry,
  type RichProductOption,
} from "@/lib/products/options";
import { uploadBuilderImage } from "./builder-utils";
import { formatCurrencySurcharge } from "@/lib/currency";

export const OPTION_GROUPS: Array<{ key: string; title: string; hint: string; supportsImage?: boolean }> = [
  { key: "formatOptions", title: "Choose Your Format", hint: "How the product is delivered (printed, download, both). Leave empty to use the built-in list." },
  { key: "sizeOptions", title: "Size", hint: "Available card / product sizes." },
  { key: "envelopeOptions", title: "Envelopes", hint: "Envelope choices, with optional image and surcharge.", supportsImage: true },
  { key: "cornerOptions", title: "Corner Style", hint: "Corner trim styles shown with a small visual preview." },
  { key: "paperStyleOptions", title: "Paper Style", hint: "Optional paper style group (e.g. Matte Finish, Silk Finish). Hidden from customers when empty." },
  { key: "paperOptions", title: "Paper Type", hint: "Paper stocks. Shown to customers as “Paper Type”." },
  { key: "printingOptions", title: "Printing Process", hint: "Printing upgrades. Shown to customers as “Printing Process”." },
];

// Convert any entry to a rich object for editing.
function toRich(entry: ProductOptionEntry): RichProductOption {
  const parsed = parseProductOption(entry);
  return {
    label: parsed?.displayLabel || "",
    value: parsed?.value || "",
    description: parsed?.description || "",
    image: parsed?.image || "",
    surcharge: parsed?.surcharge || 0,
    badge: parsed?.badge || "",
    isDefault: parsed?.isDefault || false,
    active: parsed?.active !== false,
    customerVisible: parsed?.customerVisible !== false,
  };
}

function OptionRow({ entry, index, count, onEdit, onMove, onDelete, onDuplicate, onSetDefault }: any) {
  const parsed = parseProductOption(entry);
  if (!parsed) return null;
  return (
    <div className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${parsed.active ? "border-[#303839]/12 bg-white" : "border-[#303839]/10 bg-[#F8F6F1] opacity-60"}`}>
      {parsed.image && <img src={parsed.image} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[#303839]">
          {parsed.displayLabel}
          {parsed.surcharge > 0 && <span className="text-xs font-bold text-[#303839]/50">{formatCurrencySurcharge(parsed.surcharge)}</span>}
          {parsed.badge && (
            <span className="rounded-full bg-[#D4AF37]/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-[#8a701d]">{parsed.badge}</span>
          )}
          {parsed.isDefault && <span className="rounded-full bg-[#303839]/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-[#303839]/60">Default</span>}
          {!parsed.active && <span className="text-[10px] font-bold text-[#303839]/50">(disabled)</span>}
        </p>
        {parsed.description && <p className="truncate text-xs text-[#303839]/50">{parsed.description}</p>}
      </div>
      <span className="flex shrink-0 items-center gap-0.5">
        <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(index, -1)} className="grid h-6 w-5 place-items-center text-[10px] text-[#303839]/50 hover:text-[#303839] disabled:opacity-25">▲</button>
        <button type="button" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(index, 1)} className="grid h-6 w-5 place-items-center text-[10px] text-[#303839]/50 hover:text-[#303839] disabled:opacity-25">▼</button>
        <button type="button" onClick={() => onSetDefault(index)} className="rounded px-1.5 py-1 text-[10px] font-bold text-[#303839]/50 hover:bg-[#F8F6F1] hover:text-[#303839]" title="Make default">
          Default
        </button>
        <button type="button" onClick={() => onDuplicate(index)} className="grid h-6 w-6 place-items-center text-[11px] text-[#303839]/50 hover:text-[#303839]" aria-label="Duplicate option">⧉</button>
        <button type="button" onClick={() => onEdit(index)} className="rounded px-1.5 py-1 text-[10px] font-bold text-[#303839] hover:bg-[#F8F6F1]">
          Edit
        </button>
        <button type="button" onClick={() => onDelete(index)} className="grid h-6 w-6 place-items-center text-[11px] text-red-600 hover:text-red-700" aria-label="Delete option">✕</button>
      </span>
    </div>
  );
}

function OptionEditor({ initial, supportsImage, onSave, onCancel }: any) {
  const [draft, setDraft] = useState<RichProductOption>(initial);
  const [busy, setBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const input = "h-10 w-full rounded-lg border border-[#303839]/15 bg-white px-3 text-sm text-[#303839] shadow-sm outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20";
  const patch = (updates: Partial<RichProductOption>) => setDraft((current) => ({ ...current, ...updates }));

  const uploadImage = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadBuilderImage(file);
      if (url) patch({ image: url });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2.5 rounded-lg border border-[#303839]/20 bg-[#F8F6F1] p-3">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Customer label *</span>
          <input className={input} value={draft.label} onChange={(e) => patch({ label: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Price surcharge (৳)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            className={input}
            value={draft.surcharge || 0}
            onChange={(e) => patch({ surcharge: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Short description</span>
          <input className={input} value={draft.description || ""} onChange={(e) => patch({ description: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Badge</span>
          <span className="relative block min-w-0">
            <select className={`${input} appearance-none pr-10`} value={draft.badge || ""} onChange={(e) => patch({ badge: e.target.value })}>
              <option value="">None</option>
              <option value="Best Seller">Best Seller</option>
              <option value="Recommended">Recommended</option>
              <option value="New">New</option>
            </select>
            <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#303839]/50" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Internal value</span>
          <input className={input} value={draft.value || ""} placeholder="auto from label" onChange={(e) => patch({ value: e.target.value })} />
        </label>
      </div>

      {supportsImage && (
        <div className="flex items-center gap-2">
          {draft.image && <img src={draft.image} alt="" className="h-10 w-10 rounded object-cover" />}
          <button type="button" onClick={() => imageInput.current?.click()} className="rounded-full border border-[#303839]/15 bg-white px-3 py-1.5 text-xs font-bold hover:bg-white/60">
            {busy ? "Uploading…" : draft.image ? "Replace image" : "Add image"}
          </button>
          {draft.image && (
            <button type="button" onClick={() => patch({ image: "" })} className="text-xs font-bold text-red-700 underline-offset-2 hover:underline">
              Remove
            </button>
          )}
          <input ref={imageInput} type="file" accept="image/*" className="sr-only" onChange={(e) => { uploadImage(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs font-bold text-[#303839]/75">
          <input type="checkbox" checked={draft.active !== false} onChange={(e) => patch({ active: e.target.checked })} className="h-4 w-4 accent-[#303839]" />
          Available
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-[#303839]/75">
          <input type="checkbox" checked={draft.customerVisible !== false} onChange={(e) => patch({ customerVisible: e.target.checked })} className="h-4 w-4 accent-[#303839]" />
          Visible to customers
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-[#303839]/75">
          <input type="checkbox" checked={draft.isDefault === true} onChange={(e) => patch({ isDefault: e.target.checked })} className="h-4 w-4 accent-[#303839]" />
          Default selection
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full border border-[#303839]/15 px-4 py-1.5 text-xs font-bold text-[#303839] hover:bg-white">
          Cancel
        </button>
        <button
          type="button"
          disabled={!draft.label.trim()}
          onClick={() => onSave(draft)}
          className="rounded-full bg-[#303839] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#434c4d] disabled:opacity-50"
        >
          Save option
        </button>
      </div>
    </div>
  );
}

function OptionGroupEditor({ group, entries, onChange }: any) {
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
    <section className="rounded-lg border border-[#303839]/12 bg-white p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="font-display text-xl text-[#303839]">{group.title}</h4>
        <button
          type="button"
          onClick={() => {
            setAddingNew(true);
            setEditingIndex(null);
          }}
          className="rounded-full border border-[#303839]/15 px-3 py-1 text-xs font-bold text-[#303839] hover:bg-[#F8F6F1]"
        >
          + Add option
        </button>
      </div>
      <p className="mb-3 text-xs text-[#303839]/50">{group.hint}</p>

      <div className="grid gap-1.5">
        {list.map((entry, index) =>
          editingIndex === index ? (
            <OptionEditor
              key={index}
              initial={toRich(entry)}
              supportsImage={group.supportsImage}
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
        {!list.length && <p className="rounded-md border border-dashed border-[#303839]/20 px-3 py-4 text-center text-xs text-[#303839]/45">No options configured.</p>}
        {addingNew && (
          <OptionEditor
            initial={{ label: "", surcharge: 0, active: true, customerVisible: true, isDefault: false }}
            supportsImage={group.supportsImage}
            onSave={saveNew}
            onCancel={() => setAddingNew(false)}
          />
        )}
      </div>
    </section>
  );
}

type Props = {
  productOptions: Record<string, ProductOptionEntry[]>;
  quantityOptions: any[];
  onOptionsChange: (key: string, entries: ProductOptionEntry[]) => void;
  onQuantityOptionsChange: (values: string[]) => void;
};

export default function AdminProductOptionsPanel({
  productOptions,
  quantityOptions,
  onOptionsChange,
  onQuantityOptionsChange,
}: Props) {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 p-4 md:p-6 xl:grid-cols-2 2xl:p-8">
      <div className="xl:col-span-2">
        <h3 className="font-display text-2xl text-[#303839]">Product options</h3>
        <p className="mt-1 text-sm text-[#303839]/55">
          These options power the product page, the customizer Options step, pricing, the cart, and
          orders. Surcharges are added to the unit price automatically.
        </p>
      </div>

      {OPTION_GROUPS.map((group) => (
        <OptionGroupEditor
          key={group.key}
          group={group}
          entries={productOptions[group.key] || []}
          onChange={onOptionsChange}
        />
      ))}

      <section className="rounded-lg border border-[#303839]/12 bg-white p-4 xl:col-span-2">
        <h4 className="font-display text-xl text-[#303839]">Quantity</h4>
        <p className="mb-2 text-xs text-[#303839]/50">Quantities customers can order, comma separated (e.g. 1, 10, 20, 50, 100).</p>
        <input
          className="h-10 w-full rounded-lg border border-[#303839]/15 bg-white px-3 text-sm text-[#303839] shadow-sm outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
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
