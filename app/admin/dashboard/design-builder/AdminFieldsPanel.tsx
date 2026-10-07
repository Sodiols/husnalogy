"use client";

import type { ReactNode } from "react";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import { layerDisplayName } from "@/lib/customizer/v2/layer-label";

// Fields manager (Section 30) — the studio's "Moment" side panel and the
// Fields tab. In this system a customer field always belongs to a
// customer-editable layer (that connection is the single source of truth,
// reconciled on save). It shows every field with its connection, lets the
// admin edit all field properties in one place, and surfaces warnings for
// anything that will not survive a save.
//
// Styled as the other studio side panels: light-grey cards, dark text,
// navy outlined controls, bold small section headings.

type Layout = "panel" | "page";

const line = (children: ReactNode, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const ICONS = {
  text: line(<path d="M5 5h14v4h-1.5L16.5 7H13.5v11l2 .5V20h-7v-1.5l2-.5V7H7.5L6.5 9H5Z" />, 20),
  image: line(<><rect x="4" y="4" width="16" height="16" rx="1.5" /><circle cx="9" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 2.5-2.5L20 18" /></>, 20),
  up: line(<path d="m6 15 6-6 6 6" />),
  down: line(<path d="m6 9 6 6 6-6" />),
  open: line(<><path d="M14 5h5v5" /><path d="M19 5 11 13" /><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" /></>, 16),
  fields: line(<><rect x="4" y="5" width="16" height="5" rx="1.2" /><rect x="4" y="14" width="16" height="5" rx="1.2" /><path d="M7 7.5h5M7 16.5h7" /></>, 28),
};

const INPUT =
  "h-10 w-full rounded-md border border-[#303839]/20 bg-white px-3 text-[14px] text-[#1f2425] outline-none transition-colors placeholder:text-[#303839]/40 focus:border-[#27307A] focus:ring-2 focus:ring-[#27307A]/15";
const LABEL = "mb-1 block text-[12.5px] font-semibold text-[#1f2425]";
const ICON_BUTTON =
  "grid h-8 w-8 cursor-pointer place-items-center rounded-full text-[#1f2425] transition-colors hover:bg-[#303839]/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

function pageLabel(template: any, pageId: string) {
  return (template?.pages || []).find((page: any) => page.id === pageId)?.label || pageId;
}

export default function AdminFieldsPanel({
  template,
  onFieldPatch,
  onFieldReorder,
  onSelectLayer,
  onToggleRequired,
  layout = "page",
}: any & { layout?: Layout }) {
  const panel = layout === "panel";
  const layers = template?.layers || [];
  const fields = template?.fields || [];

  // A linked field is ONE definition shared by several layers (e.g. the
  // couple's names on Front and Back); it is listed once, with every page it
  // appears on. Order here is the customer's display order (template.fields).
  const connected = fields.map((field: any) => {
    const bound = layers.filter((l: any) => l.fieldId === field.id && l.customerEditable);
    return { field, layer: bound[0], bound };
  });
  const visible = connected.filter((entry: any) => entry.layer);
  const orphanFields = connected.filter((entry: any) => !entry.layer);
  const editableWithoutField = layers.filter(
    (layer: any) => layer.customerEditable && (!layer.fieldId || !fields.some((f: any) => f.id === layer.fieldId)),
  );

  return (
    <div className={panel ? "grid gap-5 px-4 pb-6 pt-1" : "mx-auto grid w-full max-w-7xl gap-5 p-4 md:p-6 2xl:p-8"} data-admin-fields-panel={layout}>
      <p className="text-[14px] leading-relaxed text-[#303839]/75">
        The event details a customer fills in — names, date, time, venue, RSVP. A field appears when a
        layer is marked <span className="font-semibold text-[#1f2425]">customer editable</span>; everything else stays locked.
      </p>

      {editableWithoutField.length > 0 && (
        <div className="rounded-[10px] bg-red-50 p-3 text-[13px] leading-snug text-red-800" role="alert">
          <p className="font-semibold">These editable layers have no field yet — fixed automatically on save:</p>
          <ul className="mt-1.5 grid gap-1">
            {editableWithoutField.map((layer: any) => (
              <li key={layer.id}>
                <button
                  type="button"
                  onClick={() => onSelectLayer(layer.id)}
                  className="cursor-pointer underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
                >
                  {layerDisplayName(layer)} · {pageLabel(template, layer.page)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {orphanFields.length > 0 && (
        <div className="rounded-[10px] bg-[#FFF6DD] p-3 text-[13px] leading-snug text-[#6b5414]">
          <p className="font-semibold">Not connected to any editable layer — removed on save:</p>
          <p className="mt-0.5">{orphanFields.map((entry: any) => entry.field.label || "Untitled field").join(", ")}</p>
        </div>
      )}

      <section className="grid gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-bold text-[#1f2425]">Customer fields</h3>
          {visible.length > 0 && <span className="text-[12.5px] text-[#303839]/60">{visible.length} in display order</span>}
        </div>

        {visible.length ? (
          <div className={panel ? "grid gap-2.5" : "grid gap-3 xl:grid-cols-2"}>
            {visible.map(({ field, layer, bound }: any, index: number) => {
              const isImage = field.type === "image" || field.type === "file";
              const pages = [...new Set(bound.map((entry: any) => pageLabel(template, entry.page)))] as string[];
              const hidden = field.customerVisible === false;
              return (
                <article key={field.id} data-field-card={field.id} className="rounded-[10px] bg-[#F2F3F5] p-3">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white text-[#1f2425]">{isImage ? ICONS.image : ICONS.text}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[15px] font-semibold ${hidden ? "text-[#303839]/50" : "text-[#1f2425]"}`}>{field.label || layerDisplayName(layer)}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-[#303839]/65">
                        <span className="capitalize">{isImage ? "Photo" : field.type || "Text"}</span>
                        {pages.map((label) => (
                          <span key={label} className="rounded-full bg-white px-1.5 py-px text-[11.5px] text-[#303839]/80">{label}</span>
                        ))}
                        {bound.length > 1 && (
                          <span title="One field, shown on each of these pages" className="rounded-full bg-[#27307A]/10 px-1.5 py-px text-[11.5px] text-[#27307A]">Linked</span>
                        )}
                      </p>
                    </div>
                    {/* Display order in Easy Personalize (spec §5) — independent
                        of layer z-order, only reorders template.fields. */}
                    <div className="flex shrink-0 items-center">
                      <button type="button" aria-label="Move field up in Easy Personalize" title="Move up" disabled={index === 0} onClick={() => onFieldReorder(layer.id, "up")} data-shape="round" className={ICON_BUTTON}>
                        {ICONS.up}
                      </button>
                      <button type="button" aria-label="Move field down in Easy Personalize" title="Move down" disabled={index === visible.length - 1} onClick={() => onFieldReorder(layer.id, "down")} data-shape="round" className={ICON_BUTTON}>
                        {ICONS.down}
                      </button>
                    </div>
                  </div>

                  <div className={`mt-3 grid gap-2.5 ${panel ? "" : "sm:grid-cols-2"}`}>
                    <label className="block">
                      <span className={LABEL}>Customer label</span>
                      <input className={INPUT} value={field.label || ""} onChange={(e) => onFieldPatch(layer.id, { label: e.target.value })} />
                    </label>
                    <label className="block">
                      <span className={LABEL}>Placeholder</span>
                      <input className={INPUT} value={field.placeholder || ""} onChange={(e) => onFieldPatch(layer.id, { placeholder: e.target.value })} />
                    </label>
                    <label className="block">
                      <span className={LABEL}>Helper text</span>
                      <input className={INPUT} value={field.helpText || ""} onChange={(e) => onFieldPatch(layer.id, { helpText: e.target.value })} />
                    </label>
                    {!isImage && (
                      <label className="block">
                        <span className={LABEL}>Maximum length <span className="font-normal text-[#303839]/60">(0 = no limit)</span></span>
                        <EditableNumericStepper
                          label="Maximum field length"
                          value={field.maxLength || 0}
                          minimum={0}
                          maximum={100000}
                          onCommit={(maxLength) => onFieldPatch(layer.id, { maxLength })}
                          showStepButtons={false}
                          className="h-10 w-full"
                          inputClassName={INPUT}
                        />
                      </label>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[#303839]/10 pt-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {/* Hidden fields are never required (isCustomerFieldRequired):
                          customers cannot fill what they cannot see. */}
                      <label className={`flex cursor-pointer items-center gap-2 text-[13px] text-[#1f2425] ${hidden ? "cursor-not-allowed opacity-55" : ""}`}>
                        <input
                          type="checkbox"
                          checked={Boolean(field.required) && !hidden}
                          disabled={hidden}
                          onChange={(e) => onToggleRequired(layer.id, e.target.checked)}
                          className="h-4 w-4 cursor-pointer accent-[#27307A]"
                        />
                        {hidden ? "Optional while hidden" : "Required"}
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#1f2425]">
                        <input
                          type="checkbox"
                          checked={!hidden}
                          onChange={(e) => onFieldPatch(layer.id, { customerVisible: e.target.checked })}
                          className="h-4 w-4 cursor-pointer accent-[#27307A]"
                        />
                        Visible to customers
                      </label>
                    </div>
                    <button
                      type="button"
                      data-shape="round"
                      onClick={() => onSelectLayer(layer.id)}
                      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-[#27307A] bg-white px-3 text-[13px] font-semibold text-[#27307A] transition-colors hover:bg-[#27307A]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F2F3F5]"
                    >
                      Open layer {ICONS.open}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid justify-items-center gap-2 rounded-[10px] bg-[#F2F3F5] px-5 py-8 text-center">
            <span className="text-[#303839]/45">{ICONS.fields}</span>
            <p className="text-[14px] font-semibold text-[#1f2425]">No customer fields yet</p>
            <p className="text-[13px] leading-relaxed text-[#303839]/70">
              Select a text or photo on the card and turn on “customer editable” to let customers fill it in.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
