"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AdminDesignBuilder from "./design-builder/AdminDesignBuilder";
import {
  createDefaultCustomizerTemplate,
  normalizeCustomizerTemplate,
  prepareCustomizerTemplateForSave,
  validateCustomizerTemplate,
} from "@/lib/customizer";
import { formatCurrency, PRIMARY_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/currency";
import type { ProductSaveResult } from "@/lib/customizer/studio-save";

/* ------------------------------------------------------------------ */
/* Static option data                                                   */
/* ------------------------------------------------------------------ */

type DepartmentNode = { name: string; children?: DepartmentNode[] };

const DEPARTMENTS: DepartmentNode[] = [
  {
    name: "Invitations & Stationery",
    children: [
      {
        name: "Wedding Invitations",
        children: [
          { name: "Wedding Invitation Suites" },
          { name: "Save the Dates" },
          { name: "Nikah Invitations" },
          { name: "RSVP Cards" },
          { name: "Wedding Thank You Cards" },
          { name: "Wedding Programs" },
        ],
      },
      {
        name: "Party Invitations",
        children: [
          { name: "Birthday Invitations" },
          { name: "Baby Shower Invitations" },
          { name: "Bridal Shower Invitations" },
          { name: "Engagement Invitations" },
          { name: "Graduation Invitations" },
          { name: "Eid & Ramadan Invitations" },
        ],
      },
      {
        name: "Greeting Cards",
        children: [
          { name: "Anniversary Cards" },
          { name: "Birthday Cards" },
          { name: "Congratulations Cards" },
          { name: "Eid Cards" },
          { name: "Thank You Cards" },
          { name: "Holiday Cards" },
        ],
      },
      {
        name: "Announcements",
        children: [
          { name: "Baby Announcements" },
          { name: "Graduation Announcements" },
          { name: "Moving Announcements" },
        ],
      },
    ],
  },
  {
    name: "Gifts",
    children: [
      {
        name: "Personalized Gifts",
        children: [{ name: "Photo Gifts" }, { name: "Monogram Gifts" }, { name: "Keepsakes" }],
      },
      { name: "Wedding Gifts" },
      { name: "Anniversary Gifts" },
      { name: "Birthday Gifts" },
    ],
  },
  {
    name: "Home & Living",
    children: [
      {
        name: "Wall Art",
        children: [{ name: "Art Prints" }, { name: "Framed Art" }, { name: "Canvas Prints" }],
      },
      { name: "Home Decor" },
    ],
  },
  {
    name: "Office & School",
    children: [{ name: "Notebooks" }, { name: "Planners" }, { name: "Stickers & Labels" }],
  },
];

const SUGGESTED_DEPARTMENTS = [
  ["Invitations & Stationery", "Wedding Invitations", "Wedding Invitation Suites"],
  ["Invitations & Stationery", "Wedding Invitations", "Save the Dates"],
  ["Invitations & Stationery", "Greeting Cards", "Anniversary Cards"],
  ["Invitations & Stationery", "Party Invitations", "Birthday Invitations"],
  ["Gifts", "Personalized Gifts"],
];

const EVENT_OPTIONS = ["Expressions", "Holidays", "Occasions", "Other"];

const RECIPIENT_OPTIONS = ["For Anyone", "For Her", "For Him", "For Kids", "For Pets", "For Them"];

const AUDIENCE_OPTIONS = [
  { value: "G", label: "G", helper: "Suitable for all audiences" },
  { value: "PG-13", label: "PG 13", helper: "May not suit young children" },
  { value: "R", label: "R", helper: "Mature audiences only" },
];

const VISIBILITY_OPTIONS = [
  { value: "public", label: "Public", helper: "Everyone can see it" },
  { value: "hidden", label: "Hidden", helper: "Only admin can see it" },
  { value: "direct", label: "Direct only", helper: "Reachable only through its direct link" },
];

// "Hidden" was removed as a selectable status: Draft already means "saved in
// admin, not on the website", and Product Visibility covers admin-only access.
// Existing products stored as hidden keep that status until it is changed.
const STATUS_OPTIONS = [
  { value: "draft", label: "Draft", helper: "Saved in admin, not visible on the website" },
  { value: "active", label: "Active", helper: "Published and visible on the website" },
];

const CURRENCY_OPTIONS = [...SUPPORTED_CURRENCIES];

const COLLECTION_SECTION_OPTIONS = [
  {
    value: "otherStyles",
    label: "Other styles for this product",
    helper: "Show other products from this collection in the other styles carousel.",
  },
  {
    value: "suite",
    label: "Suite",
    helper: "Show other products from this collection in the suite section.",
  },
];

const DEFAULT_COLLECTION_SECTION = "otherStyles";

const MAX_TAGS = 10;
const MAX_TAG_CHARS = 500;
const MAX_MOCKUPS = 20;
const PERSONALIZATION_FIELD_TYPES = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "email", label: "Email" },
  { value: "tel", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "image", label: "Image upload" },
  { value: "file", label: "File upload" },
];
/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fieldNameFromLabel(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function optionsToText(value) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value || "");
}

function parseOptionsText(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createPersonalizationField(field: any = {}, index = 0) {
  const label = field.label || field.name || "";
  const name = field.name || fieldNameFromLabel(label);
  const type = PERSONALIZATION_FIELD_TYPES.some((option) => option.value === field.type) ? field.type : "text";

  return {
    id: field.id || `personalization-${index}-${name || "field"}`,
    name,
    label,
    type,
    required: Boolean(field.required),
    placeholder: field.placeholder || "",
    helper: field.helper || field.help || field.hint || field.description || "",
    options: optionsToText(field.options),
  };
}

function normalizeFormPersonalizationFields(value) {
  const source = Array.isArray(value) ? value : [];
  return source.map((field, index) => createPersonalizationField(field, index));
}

function buildPersonalizationPayload(fields = []) {
  return fields
    .map((field) => {
      const label = String(field.label || "").trim();
      const name = fieldNameFromLabel(field.name || label);
      if (!label || !name) return null;

      return {
        name,
        label,
        type: field.type,
        required: Boolean(field.required),
        placeholder: String(field.placeholder || "").trim(),
        helper: String(field.helper || "").trim(),
        options: field.type === "select" ? parseOptionsText(field.options) : [],
      };
    })
    .filter(Boolean);
}

function normalizeCollectionSection(value) {
  return COLLECTION_SECTION_OPTIONS.some((option) => option.value === value) ? value : DEFAULT_COLLECTION_SECTION;
}

function normalizeFormCollectionSections(value, collectionIds = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return collectionIds.reduce((sections, id) => {
    sections[id] = normalizeCollectionSection(source[id]);
    return sections;
  }, {});
}

function buildCollectionSectionsPayload(value, collectionIds = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return collectionIds.reduce((sections, id) => {
    sections[id] = normalizeCollectionSection(source[id]);
    return sections;
  }, {});
}

function formatMoney(value, currency = PRIMARY_CURRENCY) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return formatCurrency(amount, currency);
}

function tagCharacterCount(tags) {
  return tags.join(", ").length;
}

// Uses XMLHttpRequest instead of fetch so real upload progress can be shown.
function uploadImages(files, folder, onProgress): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("folder", folder);
    files.forEach((file) => formData.append("files", file));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/uploads");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) {
          resolve(Array.isArray(data.urls) ? data.urls : []);
        } else {
          reject(new Error(data?.error || "Upload failed. Please try again."));
        }
      } catch {
        reject(new Error("Upload failed. Please try again."));
      }
    };

    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(formData);
  });
}

// Starting option lists for brand-new products — mirrors the server defaults
// in lib/products so a new product behaves exactly like before until the admin
// edits its options in the Design Studio.
const DEFAULT_FORM_OPTION_LISTS = {
  formatOptions: [],
  sizeOptions: ['5" x 7"', '4.25" x 5.5"', '6" x 8"'],
  envelopeOptions: ["No Envelopes", "Blank White Envelopes", "Addressed Envelopes"],
  cornerOptions: ["Squared", "Rounded", "Arch", "Scallop", "Bracket", "Ticket"],
  paperStyleOptions: [],
  paperOptions: ["Signature Matte", "Premium Linen", "Pearl Shimmer", "Soft Touch"],
  printingOptions: ["Standard", "High Definition +$0.40"],
  quantityOptions: ["1", "10", "20", "30", "40", "50", "75", "100"],
};

function initialOptionList(product, key) {
  return Array.isArray(product?.[key]) ? product[key] : DEFAULT_FORM_OPTION_LISTS[key];
}

function buildInitialForm(product) {
  const mockups = Array.isArray(product?.mockups) ? product.mockups.filter(Boolean) : [];
  const images = Array.isArray(product?.images) ? product.images.filter(Boolean) : [];
  const mainImage = mockups[0] || product?.thumbnail || images[0] || "";
  const otherMockups = mockups[0] === mainImage ? mockups.slice(1) : mockups;
  const regularPrice = product?.price ?? "";
  const salePrice =
    product?.salePrice != null && Number(product.salePrice) !== Number(product.price) ? product.salePrice : "";
  const collectionIds = Array.isArray(product?.collectionIds) ? product.collectionIds : [];

  return {
    title: product?.title || "",
    departmentPath: Array.isArray(product?.departmentPath) && product.departmentPath.length
      ? product.departmentPath
      : product?.category
        ? [product.category, product.subcategory].filter(Boolean)
        : [],
    description: product?.aboutDesign || product?.description || "",
    mainImage,
    mockups: otherMockups,
    eventCategory: product?.eventCategory || "",
    recipientCategory: product?.recipientCategory || "",
    collectionIds,
    collectionSections: normalizeFormCollectionSections(product?.collectionSections || product?.collectionPlacements, collectionIds),
    tags: Array.isArray(product?.tags) ? product.tags : [],
    suitableAudience: product?.suitableAudience || "G",
    visibility: product?.visibility || "public",
    customizeEnabled: product?.customizeEnabled !== false,
    status: product?.status && product.status !== "deleted" ? product.status : "draft",
    featured: Boolean(product?.featured || product?.isFeatured),
    isNewArrival: Boolean(product?.isNew || product?.isNewArrival),
    isBestSeller: Boolean(product?.isBestSeller),
    isStockOut: Boolean(product?.isStockOut),
    comingInDays: product?.comingInDays ?? "",
    regularPrice: regularPrice === null ? "" : regularPrice,
    salePrice: salePrice === null ? "" : salePrice,
    currency: product?.currency === "USD" ? "USD" : PRIMARY_CURRENCY,
    customizationFields: normalizeFormPersonalizationFields(product?.customizationFields),
    customizerTemplate: product?.customizerTemplate
      ? normalizeCustomizerTemplate(product.customizerTemplate)
      : normalizeCustomizerTemplate({ ...createDefaultCustomizerTemplate(), enabled: false }),
    // Product option lists managed inside the Design Studio (Section 32).
    formatOptions: initialOptionList(product, "formatOptions"),
    sizeOptions: initialOptionList(product, "sizeOptions"),
    envelopeOptions: initialOptionList(product, "envelopeOptions"),
    cornerOptions: initialOptionList(product, "cornerOptions"),
    paperStyleOptions: initialOptionList(product, "paperStyleOptions"),
    paperOptions: initialOptionList(product, "paperOptions"),
    printingOptions: initialOptionList(product, "printingOptions"),
    quantityOptions: initialOptionList(product, "quantityOptions"),
    agreementAccepted: Boolean(product?.id),
  };
}

/* ------------------------------------------------------------------ */
/* Shared primitives                                                    */
/* ------------------------------------------------------------------ */

function FieldLabel({ label, required = false, hint = "" }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-sm font-semibold text-[#303839]">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-red-700">*</span>}
      </span>
      {hint && <span className="text-xs font-medium text-[#303839]/70">{hint}</span>}
    </div>
  );
}

function FieldError({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-red-700">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-px shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>
      {message}
    </p>
  );
}

function FormSection({ id = undefined, step = undefined, complete = false, title, description = "", children }: any) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="min-w-0 scroll-mt-24 rounded-[12px] border border-[#303839]/10 bg-white p-4 sm:p-6">
      <div className="flex items-start gap-3">
        {step !== undefined && (
          <span
            aria-hidden="true"
            className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
              complete ? "bg-[#303839] text-white" : "border border-[#303839]/25 text-[#303839]"
            }`}
          >
            {complete ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4 10-10" /></svg>
            ) : (
              step
            )}
          </span>
        )}
        <div className="min-w-0">
          <h3 id={id ? `${id}-title` : undefined} className="font-body text-lg font-semibold leading-tight text-[#303839] sm:text-xl">
            {title}
            {complete && <span className="sr-only"> (complete)</span>}
          </h3>
          {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-[#303839]/75">{description}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** What still blocks publishing, mirroring validate("active"). */
function PublishChecklist({ items, onJump }: { items: { key: string; label: string; done: boolean; target: string; optional?: boolean }[]; onJump: (target: string) => void }) {
  const required = items.filter((item) => !item.optional);
  const doneCount = required.filter((item) => item.done).length;
  return (
    <div className="rounded-[12px] border border-[#303839]/10 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-[#303839]">Ready to publish</p>
        <p className="text-xs font-semibold tabular-nums text-[#303839]/70">
          {doneCount} of {required.length}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F3F1EC]" role="progressbar" aria-label="Publishing checklist" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={doneCount}>
        <div className="h-full rounded-full bg-[#303839] transition-all" style={{ width: `${(doneCount / Math.max(1, required.length)) * 100}%` }} />
      </div>
      <ul className="mt-3 space-y-0.5">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onJump(item.target)}
              className="flex min-h-9 w-full items-center gap-2.5 px-1 text-left text-sm text-[#303839] transition-colors hover:bg-[#F8F6F1]"
            >
              <span
                aria-hidden="true"
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${item.done ? "bg-[#303839] text-white" : "border border-[#303839]/30"}`}
              >
                {item.done && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4 10-10" /></svg>
                )}
              </span>
              <span className={item.done ? "text-[#303839]/70" : "font-medium"}>{item.label}</span>
              {item.optional && <span className="ml-auto text-xs text-[#303839]/60">Recommended</span>}
              <span className="sr-only">{item.done ? "done" : "to do"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModalShell({ title, onClose, children, footer = null }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#303839]/45 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[16px] bg-white pb-[env(safe-area-inset-bottom)] font-body shadow-premium sm:rounded-[14px] sm:pb-0"
      >
        <div className="flex items-center justify-between border-b border-[#303839]/10 px-5 py-4">
          <h4 className="font-body text-lg font-semibold text-[#303839]">{title}</h4>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 grid h-10 w-10 place-items-center text-[#303839]/75 transition hover:bg-[#F8F6F1] hover:text-[#303839]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-[#303839]/10 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

function PillGroup({ value, onChange, options }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const optionValue = typeof option === "string" ? option : option.value;
        const optionLabel = typeof option === "string" ? option : option.label;
        const selected = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            aria-pressed={selected}
            className={`min-h-10 border px-4 py-2 text-sm font-semibold transition-colors ${
              selected
                ? "border-[#303839] bg-[#303839] text-white"
                : "border-[#303839]/15 bg-white text-[#303839] hover:border-[#303839]/40"
            }`}
          >
            {optionLabel}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({ label, helper = "", checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-14 w-full items-center justify-between gap-4 border border-[#303839]/12 bg-white px-4 py-3 text-left transition-colors hover:border-[#303839]/30"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[#303839]">{label}</span>
        {helper && <span className="mt-0.5 block text-xs font-medium text-[#303839]/70">{helper}</span>}
      </span>
      <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-[#303839]" : "bg-[#303839]/20"}`}>
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(48,56,57,0.3)] transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

function PickerButton({ value, placeholder, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex min-h-11 w-full items-center justify-between gap-2 border border-[#303839]/15 bg-white px-3.5 py-2 text-left text-sm transition hover:border-[#303839]/40"
    >
      <span className={`min-w-0 truncate ${value ? "font-semibold text-[#303839]" : "text-[#303839]/60"}`}>{value || placeholder}</span>
      <span className="shrink-0 text-xs font-semibold text-[#303839] underline underline-offset-4">{value ? "Change" : "Choose"}</span>
    </button>
  );
}

/** Explains what the customer will actually pay, using the same rule as buildPayload. */
function PriceSummary({ regularPrice, salePrice, currency }) {
  const regular = regularPrice === "" ? null : Number(regularPrice);
  const sale = salePrice === "" ? null : Number(salePrice);
  let tone = "neutral";
  let text = "No price yet. Customers will see the product without a price.";
  if (regular !== null && sale !== null && sale < regular) {
    const percent = regular > 0 ? Math.round(((regular - sale) / regular) * 100) : 0;
    text = `Customers pay ${formatMoney(sale, currency)} instead of ${formatMoney(regular, currency)} (save ${percent}%).`;
  } else if (regular !== null && sale !== null && sale >= regular) {
    tone = "warn";
    text = `The sale price is not lower than the regular price, so no discount is shown. Customers pay ${formatMoney(regular, currency)}.`;
  } else if (regular !== null) {
    text = `Customers pay ${formatMoney(regular, currency)}.`;
  } else if (sale !== null) {
    tone = "warn";
    text = "Add a regular price as well. A sale price on its own is not used.";
  }
  return (
    <p
      aria-live="polite"
      className={`mt-4 rounded-[10px] border px-4 py-3 text-sm ${
        tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-[#303839]/10 bg-[#F8F6F1] text-[#303839]"
      }`}
    >
      {text}
    </p>
  );
}

const INPUT_CLASS =
  "h-11 w-full border border-[#303839]/15 bg-white px-3.5 text-base font-medium text-[#303839] outline-none transition-colors placeholder:text-[#303839]/50 hover:border-[#303839]/25 focus:border-[#303839]/50 focus:ring-2 focus:ring-[#303839]/10 sm:text-sm";

/* ------------------------------------------------------------------ */
/* Department selection                                                 */
/* ------------------------------------------------------------------ */

function findNodes(path) {
  let level: DepartmentNode[] = DEPARTMENTS;
  const nodes: DepartmentNode[] = [];
  for (const segment of path) {
    const node = (level || []).find((item) => item.name === segment);
    if (!node) break;
    nodes.push(node);
    level = node.children || [];
  }
  return nodes;
}

function DepartmentModal({ initialPath, onSelect, onClose }) {
  const [path, setPath] = useState(() => {
    const nodes = findNodes(initialPath || []);
    return nodes.map((node) => node.name);
  });

  const nodes = findNodes(path);
  const currentLevel = nodes.length ? nodes[nodes.length - 1].children || [] : DEPARTMENTS;

  const openNode = (node) => {
    const nextPath = [...path, node.name];
    if (node.children?.length) {
      setPath(nextPath);
    } else {
      onSelect(nextPath);
    }
  };

  return (
    <ModalShell
      title="Select a Department"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs font-semibold text-[#303839]/75">
            {path.length ? path.join(" > ") : "Choose a department below"}
          </p>
          <button
            type="button"
            disabled={!path.length}
            onClick={() => onSelect(path)}
            className="shrink-0 bg-[#303839] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#434C4D] disabled:opacity-40"
          >
            Use this department
          </button>
        </div>
      }
    >
      {path.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[#303839]/70">
          <button type="button" onClick={() => setPath([])} className="px-2 py-1 transition hover:bg-[#F8F6F1]">
            All Departments
          </button>
          {path.map((segment, index) => (
            <span key={segment} className="flex items-center gap-1.5">
              <span className="text-[#303839]/70">&gt;</span>
              <button
                type="button"
                onClick={() => setPath(path.slice(0, index + 1))}
                className={`px-2 py-1 transition hover:bg-[#F8F6F1] ${index === path.length - 1 ? "text-[#303839]" : ""}`}
              >
                {segment}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-1.5">
        {currentLevel.map((node) => (
          <button
            key={node.name}
            type="button"
            onClick={() => openNode(node)}
            className="flex items-center justify-between gap-3 border border-[#303839]/10 bg-white px-4 py-3 text-left text-sm font-semibold text-[#303839] transition hover:border-[#303839]/35 hover:bg-[#F8F6F1]"
          >
            <span>{node.name}</span>
            {node.children?.length ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#303839]/70"><path d="m9 18 6-6-6-6" /></svg>
            ) : (
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#BDBDBD]">Select</span>
            )}
          </button>
        ))}
        {!currentLevel.length && (
          <p className="px-1 py-4 text-sm text-[#303839]/75">This department has no further options. Use the button below to select it.</p>
        )}
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* Category + collection modals                                         */
/* ------------------------------------------------------------------ */

function CategoryModal({ title, options, value, onSelect, onClose }) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="grid gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className={`flex items-center justify-between gap-3 border px-4 py-3 text-left text-sm font-semibold transition ${
              value === option
                ? "border-[#303839] bg-[#303839] text-white"
                : "border-[#303839]/10 bg-white text-[#303839] hover:border-[#303839]/35 hover:bg-[#F8F6F1]"
            }`}
          >
            <span>{option}</span>
            {value === option && (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
            )}
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

function CollectionsModal({ collections, selectedIds, onToggle, onTrendingChange, onSuiteChange, onCreate, onClose }) {
  const selectedChild = collections.find((collection) => selectedIds.includes(collection.id) && collection.parentCollectionId);
  const firstParent = collections.find((collection) => !collection.parentCollectionId);
  const [activeParentId, setActiveParentId] = useState(selectedChild?.parentCollectionId || firstParent?.id || "");
  const [parentName, setParentName] = useState("");
  const [childName, setChildName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const collectionById = new Map<any, any>(collections.map((collection) => [collection.id, collection]));
  const parentCollections = collections
    .filter((collection) => !collection.parentCollectionId)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const childCollections = collections
    .filter((collection) => collection.parentCollectionId === activeParentId)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const activeParent = collectionById.get(activeParentId);

  const createCollection = async (parentId = "") => {
    const trimmed = (parentId ? childName : parentName).trim();
    if (!trimmed) return;

    setCreating(true);
    setError("");

    try {
      const response = await fetch("/api/admin/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, parentCollectionId: parentId }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(String(data?.errors ? Object.values(data.errors)[0] : "Collection could not be created."));
      }

      onCreate(data.collection, Boolean(parentId));
      if (parentId) {
        setChildName("");
      } else {
        setParentName("");
        setActiveParentId(data.collection.id);
      }
    } catch (createError) {
      setError(createError.message || "Collection could not be created.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <ModalShell
      title="Add to Collection"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="w-full bg-[#303839] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#434C4D]">
          Done
        </button>
      }
    >
      <div className="grid gap-5">
        <section>
          <FieldLabel label="Parent collection" required />
          <div className="mt-2 grid gap-2">
            {parentCollections.map((collection) => {
              const active = activeParentId === collection.id;

              return (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => setActiveParentId(collection.id)}
                  className={`flex items-center justify-between border px-4 py-3 text-left text-sm font-semibold transition ${
                    active ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/10 bg-white text-[#303839] hover:border-[#303839]/35"
                  }`}
                >
                  <span>{collection.name}</span>
                  {collection.isTrendingWedding && <span className={`text-[10px] uppercase tracking-[0.08em] ${active ? "text-white/70" : "text-[#303839]/70"}`}>Wedding</span>}
                </button>
              );
            })}
            {!parentCollections.length && (
              <p className="border border-dashed border-[#303839]/20 bg-white px-4 py-4 text-sm font-semibold text-[#303839]/75">
                Create a parent collection first.
              </p>
            )}
          </div>

          <div className="mt-3 border border-[#303839]/10 bg-[#F8F6F1] p-4">
            <FieldLabel label="New parent collection" />
            <div className="mt-2 flex gap-2">
              <input
                value={parentName}
                onChange={(event) => setParentName(event.target.value)}
                placeholder="Wedding suite"
                className={INPUT_CLASS}
              />
              <button
                type="button"
                onClick={() => createCollection("")}
                disabled={creating || !parentName.trim()}
                className="shrink-0 bg-[#303839] px-4 text-xs font-semibold text-white transition hover:bg-[#434C4D] disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </section>

        {activeParent && (
          <section>
            <FieldLabel label={`Child collections inside ${activeParent.name}`} required />
            <div className="mt-2 grid gap-1.5">
              {childCollections.map((collection) => {
                const selected = selectedIds.includes(collection.id);

                return (
                  <div
                    key={collection.id}
                    className={`border transition ${
                      selected
                        ? "border-[#303839] bg-[#303839] text-white"
                        : "border-[#303839]/10 bg-white text-[#303839] hover:border-[#303839]/35 hover:bg-[#F8F6F1]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggle(collection.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold"
                    >
                      <span className="min-w-0 truncate">{collection.name}</span>
                      <span className={`grid h-5 w-5 shrink-0 place-items-center border ${selected ? "border-white bg-white text-[#303839]" : "border-[#303839]/30"}`}>
                        {selected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
              {!childCollections.length && (
                <p className="border border-dashed border-[#303839]/20 bg-white px-4 py-4 text-sm font-semibold text-[#303839]/75">
                  No child collections yet. Create one for RSVP cards, thank you cards, or another suite piece.
                </p>
              )}
            </div>

            <div className="mt-3 border border-[#303839]/10 bg-[#F8F6F1] p-4">
              <FieldLabel label="New child collection" />
              <div className="mt-2 flex gap-2">
                <input
                  value={childName}
                  onChange={(event) => setChildName(event.target.value)}
                  placeholder="RSVP cards"
                  className={INPUT_CLASS}
                />
                <button
                  type="button"
                  onClick={() => createCollection(activeParent.id)}
                  disabled={creating || !childName.trim()}
                  className="shrink-0 bg-[#303839] px-4 text-xs font-semibold text-white transition hover:bg-[#434C4D] disabled:opacity-40"
                >
                  Create
                </button>
              </div>
            </div>
          </section>
        )}

        {activeParent && (
          <section>
            <FieldLabel label={`${activeParent.name} settings`} />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start justify-between gap-3 border border-[#303839]/10 bg-white px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[#303839]">Suite</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[#303839]/70">Product pages will say &ldquo;Shop the {activeParent.name} suite&rdquo;.</span>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(activeParent?.isSuite)}
                  onChange={(event) => onSuiteChange(activeParent.id, event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#303839]"
                />
              </label>
              <label className="flex cursor-pointer items-start justify-between gap-3 border border-[#303839]/10 bg-white px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[#303839]">Wedding page</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[#303839]/70">Show this parent collection in the Wedding page trending row.</span>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(activeParent?.isTrendingWedding)}
                  onChange={(event) => onTrendingChange(activeParent.id, event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#303839]"
                />
              </label>
            </div>
          </section>
        )}

        <FieldError message={error} />
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* Image uploaders                                                      */
/* ------------------------------------------------------------------ */

function UploadDropzone({ id, multiple = false, onFiles, uploading, progress, children }) {
  const [dragActive, setDragActive] = useState(false);

  return (
    <label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        onFiles(Array.from(event.dataTransfer.files || []));
      }}
      className={`flex min-h-[130px] cursor-pointer flex-col items-center justify-center border border-dashed px-4 py-6 text-center transition ${
        dragActive ? "border-[#303839] bg-[#F8F6F1]" : "border-[#303839]/20 bg-[#F8F6F1]/60 hover:border-[#303839]/45 hover:bg-[#F8F6F1]"
      } ${uploading ? "pointer-events-none opacity-70" : ""}`}
    >
      <input
        id={id}
        type="file"
        accept="image/*"
        multiple={multiple}
        disabled={uploading}
        onChange={(event) => {
          onFiles(Array.from(event.target.files || []));
          event.target.value = "";
        }}
        className="sr-only"
      />
      {uploading ? (
        <div className="w-full max-w-xs">
          <p className="text-sm font-semibold text-[#303839]">Uploading... {progress}%</p>
          <div className="mt-2 h-1.5 w-full bg-[#303839]/10">
            <div className="h-full bg-[#BDBDBD] transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        children
      )}
    </label>
  );
}

function MainImageUploader({ value, onChange, error }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");

  const handleFiles = async (files) => {
    const file = files.find((item) => item.type.startsWith("image/")) || files[0];
    if (!file) return;

    setUploading(true);
    setProgress(0);
    setUploadError("");

    try {
      const urls = await uploadImages([file], "product-images", setProgress);
      if (urls[0]) onChange(urls[0]);
    } catch (err) {
      setUploadError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <FieldLabel label="Main product image" required hint="Used as the primary image on the website" />
      <div className="mt-2">
        {value ? (
          <div className="flex flex-wrap items-start gap-4">
            <div className="relative h-40 w-40 shrink-0 overflow-hidden border border-[#303839]/10 bg-[#F8F6F1]">
              <img src={value} alt="Main product" className="h-full w-full object-cover" />
              <span className="absolute left-2 top-2 bg-[#303839] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#BDBDBD]">Main</span>
            </div>
            <div className="grid gap-2">
              <label className="cursor-pointer border border-[#303839]/15 bg-white px-4 py-2 text-center text-xs font-semibold text-[#303839] transition hover:bg-[#F8F6F1]">
                Replace image
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    handleFiles(Array.from(event.target.files || []));
                    event.target.value = "";
                  }}
                />
              </label>
              <button type="button" onClick={() => onChange("")} className="border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50">
                Remove
              </button>
              {uploading && <p className="text-xs font-semibold text-[#303839]/75">Uploading... {progress}%</p>}
            </div>
          </div>
        ) : (
          <UploadDropzone id="main-image-upload" onFiles={handleFiles} uploading={uploading} progress={progress}>
            <span className="grid h-11 w-11 place-items-center bg-white text-[#303839]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L6 23" /></svg>
            </span>
            <span className="mt-3 text-sm font-semibold text-[#303839]">Upload the main product image</span>
            <span className="mt-1 text-xs font-medium text-[#303839]/70">Drag and drop or click to browse. Up to 15MB.</span>
          </UploadDropzone>
        )}
      </div>
      <FieldError message={uploadError || error} />
    </div>
  );
}

function MockupUploader({ mockups, onChange, onPromoteToMain }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const dragIndexRef = useRef(null);

  const handleFiles = async (files) => {
    const imageFiles = files.filter((item) => item.type.startsWith("image/"));
    if (!imageFiles.length) return;

    const remaining = Math.max(MAX_MOCKUPS - mockups.length, 0);
    if (!remaining) {
      setUploadError(`Maximum ${MAX_MOCKUPS} mockups allowed.`);
      return;
    }

    setUploading(true);
    setProgress(0);
    setUploadError("");

    try {
      const urls = await uploadImages(imageFiles.slice(0, remaining), "product-mockups", setProgress);
      onChange([...mockups, ...urls]);
    } catch (err) {
      setUploadError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const removeMockup = (index) => onChange(mockups.filter((_, i) => i !== index));

  const reorder = (from, to) => {
    if (from === null || from === to || from === undefined) return;
    const next = [...mockups];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div>
      <FieldLabel label="Product mockups" hint={`${mockups.length}/${MAX_MOCKUPS} uploaded`} />
      <p className="mt-1 text-xs font-medium text-[#303839]/70">
        Upload several mockup views. Drag to reorder, or make one the main product image.
      </p>

      <div className="mt-2">
        <UploadDropzone id="mockup-upload" multiple onFiles={handleFiles} uploading={uploading} progress={progress}>
          <span className="grid h-11 w-11 place-items-center bg-white text-[#303839]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <span className="mt-3 text-sm font-semibold text-[#303839]">Add mockup images</span>
          <span className="mt-1 text-xs font-medium text-[#303839]/70">Drag and drop multiple files or click to browse.</span>
        </UploadDropzone>
      </div>
      <FieldError message={uploadError} />

      {!!mockups.length && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {mockups.map((mockup, index) => (
            <div
              key={`${mockup}-${index}`}
              draggable
              onDragStart={() => {
                dragIndexRef.current = index;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                reorder(dragIndexRef.current, index);
                dragIndexRef.current = null;
              }}
              className="group/mockup cursor-grab border border-[#303839]/10 bg-white active:cursor-grabbing"
            >
              <div className="relative aspect-square overflow-hidden bg-[#F8F6F1]">
                <img src={mockup} alt={`Mockup ${index + 1}`} className="h-full w-full object-cover" />
              </div>
              <div className="grid gap-1 p-2">
                <button
                  type="button"
                  onClick={() => onPromoteToMain(index)}
                  className="border border-[#303839]/15 px-2 py-1 text-[11px] font-semibold text-[#303839] transition hover:border-[#BDBDBD] hover:text-[#BDBDBD]"
                >
                  Make main image
                </button>
                <button type="button" onClick={() => removeMockup(index)} className="border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-50">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live preview                                                         */
/* ------------------------------------------------------------------ */

function PreviewBadge({ children, tone = "dark" }) {
  const tones = {
    dark: "bg-[#303839] text-white",
    soft: "bg-[#F8F6F1] text-[#303839]",
    accent: "border border-[#BDBDBD] bg-white text-[#8a6d1a]",
    danger: "bg-[#303839]/85 text-white",
  };
  return <span className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${tones[tone]}`}>{children}</span>;
}

function LivePreview({ form, collections }) {
  const previewImage = form.mainImage || form.mockups[0] || "";
  const regular = Number(form.regularPrice);
  const sale = Number(form.salePrice);
  const hasSale = Number.isFinite(sale) && sale > 0 && Number.isFinite(regular) && sale < regular;
  const priceLabel = formatMoney(hasSale ? sale : form.regularPrice, form.currency);
  const compareLabel = hasSale ? formatMoney(regular, form.currency) : "";
  const departmentLabel = form.departmentPath.length ? form.departmentPath[form.departmentPath.length - 1] : "";
  const collectionNames = collections.filter((item) => form.collectionIds.includes(item.id)).map((item) => item.name);
  const comingDays = Number(form.comingInDays);
  const stockLabel = form.isStockOut
    ? Number.isFinite(comingDays) && comingDays > 0
      ? `Coming in ${comingDays} day${comingDays === 1 ? "" : "s"}`
      : "Stock Out"
    : "";

  // "Hidden" is no longer selectable, but products saved that way before must
  // still report their real status rather than falling back to "Draft".
  const statusLabel = STATUS_OPTIONS.find((option) => option.value === form.status)?.label
    || (form.status === "hidden" ? "Hidden" : "Draft");
  const visibilityLabel = VISIBILITY_OPTIONS.find((option) => option.value === form.visibility)?.label || "Public";

  return (
    <div className="border border-[#303839]/10 bg-white">
      <div className="border-b border-[#303839]/10 bg-[#F8F6F1] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#303839]/70">Live preview</p>
        <p className="mt-0.5 text-xs font-medium text-[#303839]/75">How this product will look to customers</p>
      </div>

      <div className="p-4">
        <div className="relative aspect-square overflow-hidden bg-[#F8F6F1]">
          {previewImage ? (
            <img
              src={previewImage}
              alt="Product preview"
              className={`h-full w-full object-cover transition ${form.isStockOut ? "opacity-55" : ""}`}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[#303839]/70">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L6 23" /></svg>
              <span className="text-xs font-semibold">Main image preview</span>
            </div>
          )}

          <div className="absolute left-2 top-2 flex flex-col items-start gap-1.5">
            {form.isStockOut && <PreviewBadge tone="danger">{stockLabel}</PreviewBadge>}
            {form.isNewArrival && <PreviewBadge tone="soft">New Arrival</PreviewBadge>}
            {form.isBestSeller && <PreviewBadge tone="dark">Best Seller</PreviewBadge>}
            {form.featured && <PreviewBadge tone="accent">Featured</PreviewBadge>}
          </div>
        </div>

        <h4 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-5 text-[#303839]">
          {form.title || "Product title appears here"}
        </h4>

        {priceLabel && (
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-[#303839]">{priceLabel}</span>
            {compareLabel && <span className="text-[#303839]/70 line-through">{compareLabel}</span>}
          </p>
        )}

        {departmentLabel && (
          <p className="mt-2 text-xs font-semibold text-[#303839]/70">{form.departmentPath.join(" > ")}</p>
        )}

        {(form.eventCategory || form.recipientCategory || collectionNames.length > 0) && (
          <p className="mt-1 text-xs font-medium text-[#303839]/75">
            {[form.eventCategory, form.recipientCategory, ...collectionNames].filter(Boolean).join(" · ")}
          </p>
        )}

        {!!form.tags.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {form.tags.slice(0, 6).map((tag) => (
              <span key={tag} className="bg-[#F8F6F1] px-2 py-0.5 text-[11px] font-semibold text-[#303839]/75">
                {tag}
              </span>
            ))}
            {form.tags.length > 6 && (
              <span className="px-1 py-0.5 text-[11px] font-semibold text-[#303839]/70">+{form.tags.length - 6} more</span>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-[#303839]/10 pt-3">
          <PreviewBadge tone="soft">{statusLabel}</PreviewBadge>
          <PreviewBadge tone="soft">{visibilityLabel}</PreviewBadge>
          {form.customizeEnabled && <PreviewBadge tone="soft">Customizable</PreviewBadge>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main form                                                            */
/* ------------------------------------------------------------------ */

/**
 * Shared by the admin dashboard and the designer workspace.
 *
 * `mode` changes only which ACTIONS the footer offers — the fields, the media
 * uploads and the embedded Design Builder are identical, so there is one
 * product editor rather than two that drift. The server enforces the same
 * boundary independently: a designer's payload is stripped of status,
 * publication and workflow fields whatever this component renders.
 */
export default function ProductUploadForm({
  product = null,
  onSaved,
  onClose,
  mode = "admin",
  onSubmitForReview,
}: any) {
  const isDesigner = mode === "designer";
  const [form, setForm] = useState(() => buildInitialForm(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [collections, setCollections] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [activeModal, setActiveModal] = useState("");
  const [saving, setSaving] = useState("");
  const [saveError, setSaveError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const formRef = useRef(null);
  // The product as the server last confirmed it. A brand-new product has no id
  // until its first save; every later save (and template publication) must use
  // the id the creation returned, not the null it was opened with.
  const [persistedProduct, setPersistedProduct] = useState(product);
  // Synchronous guard: two clicks in the same frame must not both POST.
  const saveInFlightRef = useRef(false);

  const editingId = persistedProduct?.id || null;

  // The form opens above the product list; bring it into view so the admin
  // sees it immediately, especially on phones where it starts off-screen.
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    formRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, []);

  useEffect(() => {
    setForm(buildInitialForm(product));
    setPersistedProduct(product);
    setErrors({});
    setSaveError("");
    setSuccessMessage("");
  }, [product]);

  useEffect(() => {
    fetch("/api/admin/collections", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { collections: [] }))
      .then((data) => setCollections(data.collections || []))
      .catch(() => setCollections([]));
  }, []);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const toggleCollection = (id) => {
    setForm((current) => {
      const selected = current.collectionIds.includes(id);
      const collectionIds = selected
        ? current.collectionIds.filter((item) => item !== id)
        : [...current.collectionIds, id];
      const collectionSections = { ...(current.collectionSections || {}) };

      if (selected) {
        delete collectionSections[id];
      } else {
        collectionSections[id] = normalizeCollectionSection(collectionSections[id]);
      }

      return { ...current, collectionIds, collectionSections };
    });
  };

  const updateCollectionTrending = async (id, isTrendingWedding) => {
    const previousCollections = collections;
    setCollections((current) =>
      current.map((collection) =>
        collection.id === id ? { ...collection, isTrendingWedding } : collection
      )
    );

    try {
      const response = await fetch("/api/admin/collections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isTrendingWedding }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(String(firstError || "Collection could not be updated."));
      }

      if (data.collection) {
        setCollections((current) =>
          current
            .map((collection) => (collection.id === id ? data.collection : collection))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      }
    } catch (error) {
      setCollections(previousCollections);
      setSaveError(error.message || "Collection could not be updated.");
    }
  };

  const updateCollectionSuite = async (id, isSuite) => {
    const previousCollections = collections;
    setCollections((current) =>
      current.map((collection) =>
        collection.id === id ? { ...collection, isSuite } : collection
      )
    );

    try {
      const response = await fetch("/api/admin/collections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isSuite }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(String(firstError || "Collection could not be updated."));
      }

      if (data.collection) {
        setCollections((current) =>
          current
            .map((collection) => (collection.id === id ? data.collection : collection))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      }
    } catch (error) {
      setCollections(previousCollections);
      setSaveError(error.message || "Collection could not be updated.");
    }
  };

  const tagChars = tagCharacterCount(form.tags);

  const addTag = () => {
    const candidates = tagInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!candidates.length) return;

    let nextTags = [...form.tags];
    for (const candidate of candidates) {
      if (nextTags.length >= MAX_TAGS) break;
      if (nextTags.some((tag) => tag.toLowerCase() === candidate.toLowerCase())) continue;
      if (tagCharacterCount([...nextTags, candidate]) > MAX_TAG_CHARS) break;
      nextTags.push(candidate);
    }

    update("tags", nextTags);
    setTagInput("");
  };

  const removeTag = (tagToRemove) => update("tags", form.tags.filter((tag) => tag !== tagToRemove));

  // The old per-field personalization editor was removed — the Design Builder is
  // now the single source of truth for customer-editable fields. product.customizationFields
  // is still loaded/saved untouched for backward compatibility only.

  const promoteMockupToMain = (index) => {
    const promoted = form.mockups[index];
    if (!promoted) return;

    setForm((current) => {
      const remaining = current.mockups.filter((_, i) => i !== index);
      return {
        ...current,
        mainImage: promoted,
        mockups: current.mainImage ? [current.mainImage, ...remaining] : remaining,
      };
    });
    setErrors((current) => {
      const next = { ...current };
      delete next.mainImage;
      return next;
    });
  };

  const validate = (statusToSave, source = form) => {
    const form = source;
    const nextErrors: any = {};
    const preparedCustomizerTemplate = form.customizerTemplate
      ? normalizeCustomizerTemplate(prepareCustomizerTemplateForSave(form.customizerTemplate))
      : null;

    if (!form.title.trim()) nextErrors.title = "Enter a product name.";

    if (statusToSave !== "draft") {
      if (!form.departmentPath.length) nextErrors.departmentPath = "Choose a department.";
      if (!form.description.trim()) nextErrors.description = "Add a description.";
      if (!form.mainImage && !form.mockups.length) nextErrors.mainImage = "Add a main photo.";
      if (!form.tags.length) nextErrors.tags = "Add at least one tag.";
      if (!form.suitableAudience) nextErrors.suitableAudience = "Choose an audience.";
      if (!form.visibility) nextErrors.visibility = "Choose who can find this product.";
      if (!form.agreementAccepted) nextErrors.agreement = "Please confirm you have the right to publish this product.";

      // Customizer products must have a valid, complete design template.
      if (form.customizeEnabled && form.customizerTemplate?.enabled) {
        const templateErrors = validateCustomizerTemplate(preparedCustomizerTemplate);
        const firstTemplateError = Object.values(templateErrors)[0];
        if (firstTemplateError) nextErrors.customizerTemplate = String(firstTemplateError);
      }
    }

    if (form.isStockOut && form.comingInDays !== "" && !(Number.isInteger(Number(form.comingInDays)) && Number(form.comingInDays) > 0)) {
      nextErrors.comingInDays = "Enter a whole number of days.";
    }

    setErrors(nextErrors);
    return nextErrors;
  };

  const buildPayload = (statusToSave, source = form) => {
    const form = source;
    const preparedCustomizerTemplate = form.customizerTemplate
      ? normalizeCustomizerTemplate(prepareCustomizerTemplateForSave(form.customizerTemplate))
      : null;
    const mainImage = form.mainImage || form.mockups[0] || "";
    const otherMockups = form.mainImage ? form.mockups : form.mockups.slice(1);
    const collectionNames = collections
      .filter((item) => form.collectionIds.includes(item.id))
      .map((item) => item.name);
    const collectionSections = buildCollectionSectionsPayload(form.collectionSections, form.collectionIds);
    const regularPrice = form.regularPrice === "" ? null : Number(form.regularPrice);
    const salePrice = form.salePrice === "" ? null : Number(form.salePrice);
    const hasSale = salePrice !== null && regularPrice !== null && salePrice < regularPrice;

    return {
      title: form.title.trim(),
      slug: editingId ? persistedProduct?.slug || slugify(form.title) : slugify(form.title),
      status: statusToSave,
      visibility: form.visibility,
      departmentPath: form.departmentPath,
      category: form.departmentPath[0] || "",
      subcategory: form.departmentPath[1] || "",
      description: form.description.trim(),
      aboutDesign: form.description.trim(),
      aboutInvitation: form.description.trim(),
      eventCategory: form.eventCategory,
      occasion: form.eventCategory,
      recipientCategory: form.recipientCategory,
      collectionIds: form.collectionIds,
      collectionSections,
      collection: collectionNames[0] || "",
      tags: form.tags,
      thumbnail: mainImage,
      mockups: [mainImage, ...otherMockups].filter(Boolean),
      suitableAudience: form.suitableAudience,
      customizeEnabled: form.customizeEnabled,
      featured: form.featured,
      isFeatured: form.featured,
      isNew: form.isNewArrival,
      isNewArrival: form.isNewArrival,
      isBestSeller: form.isBestSeller,
      isStockOut: form.isStockOut,
      comingInDays: form.isStockOut && form.comingInDays !== "" ? Number(form.comingInDays) : null,
      price: hasSale ? salePrice : regularPrice,
      salePrice: hasSale ? salePrice : regularPrice,
      oldPrice: hasSale ? regularPrice : null,
      currency: form.currency,
      customizationFields: buildPersonalizationPayload(form.customizationFields),
      // Product option lists edited in the Design Studio's Options tab.
      formatOptions: form.formatOptions,
      sizeOptions: form.sizeOptions,
      envelopeOptions: form.envelopeOptions,
      cornerOptions: form.cornerOptions,
      paperStyleOptions: form.paperStyleOptions,
      paperOptions: form.paperOptions,
      printingOptions: form.printingOptions,
      quantityOptions: form.quantityOptions,
      // Only persist the customizer template when it is enabled or the product
      // already had one — keeps template rows off products that never use it.
      ...(preparedCustomizerTemplate?.enabled || persistedProduct?.customizerTemplate
        ? { customizerTemplate: preparedCustomizerTemplate }
        : {}),
    };
  };

  /**
   * Save the product (and its customizer draft).
   *
   * Always resolves to an explicit ProductSaveResult — never throws, never
   * returns undefined — so a caller such as the Design Studio can tell a saved
   * draft from a validation or request failure and must not publish after a
   * failure.
   *
   * requestedAction:
   *   "draft"    — save as draft (product footer)
   *   "publish"  — save as active, or hidden when that is the chosen status
   *   "template" — Design Studio draft save. The product's PERSISTED status is
   *                kept exactly (active stays active, hidden stays hidden, a
   *                new product is created as draft): the status is not sent at
   *                all, so the server keeps what it has.
   *
   * `options.template` is the exact template revision to persist; the studio
   * passes its own synchronous copy so a save can never send a stale render.
   */
  const save = async (requestedAction, options: { template?: any } = {}): Promise<ProductSaveResult> => {
    if (saveInFlightRef.current) {
      return { ok: false, reason: "busy", error: "A save is already in progress." };
    }
    const templateOnly = requestedAction === "template";
    const persistedStatus = persistedProduct?.status && persistedProduct.status !== "deleted" ? persistedProduct.status : "draft";
    // "publish" keeps the admin's chosen status unless it is still draft.
    const statusToSave = templateOnly
      ? persistedStatus
      : requestedAction === "draft" ? "draft" : form.status === "hidden" ? "hidden" : "active";
    const source = options.template !== undefined ? { ...form, customizerTemplate: options.template } : form;

    // A template-only save neither publishes the product nor changes its
    // status, so it needs only what a draft needs to persist. The template's
    // own publish checks run server-side when a version is published.
    const validationErrors = validate(templateOnly ? "draft" : statusToSave, source);
    const errorMessages = Object.values(validationErrors).map(String);
    if (errorMessages.length) {
      const message = templateOnly
        ? `Not saved — ${errorMessages[0]}${errorMessages.length > 1 ? ` (+${errorMessages.length - 1} more)` : ""}`
        : "Some required details are missing. They are marked below and in the checklist.";
      setSaveError(message);
      if (!templateOnly) {
        const firstField = formRef.current?.querySelector("[data-field-error]");
        firstField?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return { ok: false, reason: "validation", error: errorMessages[0] };
    }

    saveInFlightRef.current = true;
    setSaving(requestedAction);
    setSaveError("");
    setSuccessMessage("");

    try {
      const endpoint = editingId ? `/api/admin/products/${editingId}` : "/api/admin/products";
      const payload: any = buildPayload(statusToSave, source);
      if (templateOnly) delete payload.status;
      const response = await fetch(endpoint, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(String(firstError || "Product could not be saved."));
      }
      const saved = data?.product;
      if (!saved?.id) throw new Error("The server did not confirm the saved product.");

      const message = templateOnly
        ? "Design draft saved."
        : requestedAction === "draft"
          ? "Draft saved."
          : statusToSave === "hidden"
            ? "Product saved as hidden."
            : "Product published. It is now live on the website.";
      setPersistedProduct(saved);
      setSuccessMessage(message);
      onSaved?.(saved, message, { source: templateOnly ? "studio" : "form" });
      return { ok: true, productId: String(saved.id), product: saved, template: saved.customizerTemplate ?? null };
    } catch (error) {
      const message = error?.message || "Product could not be saved.";
      setSaveError(message);
      return { ok: false, reason: "request", error: message };
    } finally {
      saveInFlightRef.current = false;
      setSaving("");
    }
  };

  const previewPanel = <LivePreview form={form} collections={collections} />;

  // Mirrors the publish rules in validate(); only what blocks publishing is
  // required, price is recommended.
  const hasImage = Boolean(form.mainImage || form.mockups.length);
  const checklist = [
    { key: "title", label: "Product name", done: Boolean(form.title.trim()), target: "pf-basics" },
    { key: "description", label: "Description", done: Boolean(form.description.trim()), target: "pf-basics" },
    { key: "image", label: "Main photo", done: hasImage, target: "pf-media" },
    { key: "price", label: "Price", done: form.regularPrice !== "", target: "pf-price", optional: true },
    { key: "department", label: "Department", done: form.departmentPath.length > 0, target: "pf-organize" },
    { key: "tags", label: "At least one tag", done: form.tags.length > 0, target: "pf-organize" },
    { key: "audience", label: "Audience", done: Boolean(form.suitableAudience), target: "pf-organize" },
    { key: "visibility", label: "Who can find it", done: Boolean(form.visibility), target: "pf-visibility" },
    { key: "agreement", label: "Publishing confirmation", done: Boolean(form.agreementAccepted), target: "pf-publish" },
  ];
  const missingCount = checklist.filter((item) => !item.optional && !item.done).length;
  const readyToPublish = missingCount === 0;
  const steps = {
    basics: Boolean(form.title.trim() && form.description.trim()),
    media: hasImage,
    price: form.regularPrice !== "",
    organize: Boolean(form.departmentPath.length && form.tags.length && form.suitableAudience),
    visibility: Boolean(form.visibility),
    publish: Boolean(form.agreementAccepted),
  };
  const jumpTo = (target) => {
    const node = document.getElementById(target);
    if (!node) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    node.querySelector<HTMLElement>("input, textarea, button")?.focus({ preventScroll: true });
  };
  const checklistPanel = <PublishChecklist items={checklist} onJump={jumpTo} />;

  return (
    <div ref={formRef} className="scroll-mt-20 rounded-[14px] border border-[#303839]/10 bg-[#F8F6F1]/60 p-3 sm:p-6">
      <div className="flex items-start justify-between gap-3 px-1 pt-1 sm:p-0">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#303839]/70">{editingId ? "Edit product" : "New product"}</p>
          <h2 className="mt-1 truncate font-body text-[1.375rem] font-semibold leading-tight text-[#303839] sm:text-[1.625rem]">
            {editingId ? product?.title || "Edit product" : "Add a new product"}
          </h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close product form" className="inline-flex h-10 shrink-0 items-center gap-1.5 border border-[#303839]/15 bg-white px-3.5 text-xs font-semibold text-[#303839] transition-colors hover:bg-[#F3F1EC]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          Close
        </button>
      </div>

      {successMessage && (
        <p role="status" className="mt-4 rounded-[10px] border border-[#1B5E20]/15 bg-[#E6F4EA] px-4 py-3 text-sm font-medium text-[#1B5E20]">{successMessage}</p>
      )}
      {saveError && (
        <p role="alert" className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{saveError}</p>
      )}

      <div className="mt-4 grid items-start gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* -------------------------------- Left: form ------------------ */}
        <div className="min-w-0 space-y-5">
          <FormSection id="pf-basics" step={1} complete={steps.basics} title="Basics" description="The name and description customers read first.">
            <div className="grid gap-5">
              <div data-field-error={errors.title ? "" : undefined}>
                <FieldLabel label="Product name" required />
                <input
                  value={form.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="Describe the product the way a customer would search for it"
                  className={`mt-2 ${INPUT_CLASS} ${errors.title ? "border-red-400" : ""}`}
                />
                <FieldError message={errors.title} />
              </div>

              <div data-field-error={errors.description ? "" : undefined}>
                <FieldLabel label="Description" required hint="What it is, what is included and how it can be personalized" />
                <textarea
                  value={form.description}
                  onChange={(event) => update("description", event.target.value)}
                  rows={7}
                  placeholder="Materials, personalization, finish, what is included, and why customers will love it..."
                  className={`mt-2 w-full border border-[#303839]/15 bg-white px-4 py-3 text-sm font-medium leading-6 text-[#303839] outline-none transition placeholder:text-[#303839]/50 focus:border-[#303839]/50 focus:ring-2 focus:ring-[#303839]/10 ${errors.description ? "border-red-400" : ""}`}
                />
                <FieldError message={errors.description} />
              </div>
            </div>
          </FormSection>

          <FormSection id="pf-media" step={2} complete={steps.media} title="Photos and personalization" description="The first photo is the main image on the shop. Add mockups to show the product in use.">
            <div className="mb-6">
              <ToggleRow
                label="Customers can personalize this product"
                helper="Shows the Personalize button on the product page and opens the Design Studio below"
                checked={form.customizeEnabled}
                onChange={(value) => update("customizeEnabled", value)}
              />
            </div>
            <div className="grid gap-6">
              <div data-field-error={errors.mainImage ? "" : undefined}>
                <MainImageUploader value={form.mainImage} onChange={(value) => update("mainImage", value)} error={errors.mainImage} />
              </div>
              <MockupUploader
                mockups={form.mockups}
                onChange={(value) => update("mockups", value)}
                onPromoteToMain={promoteMockupToMain}
              />

              {form.customizeEnabled && (
                <div className="border-t border-[#303839]/10 pt-6" data-field-error={errors.customizerTemplate ? "" : undefined}>
                  <div className="mb-4 max-w-3xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#D4AF37]">Personalization workspace</p>
                    <h3 className="mt-1 font-display text-2xl text-[#303839]">Design Studio</h3>
                    <p className="mt-1 text-sm leading-6 text-[#303839]/75">
                      Build the editable product after preparing its customer-facing images and mockups. Configure pages,
                      artwork, customer-editable content, and product options in one workspace.
                    </p>
                  </div>
                  <AdminDesignBuilder
                    template={form.customizerTemplate}
                    onChange={(next) => update("customizerTemplate", next)}
                    productName={form.title || "Product"}
                    product={{
                      id: editingId,
                      title: form.title || "Product",
                      thumbnail: form.mainImage || form.mockups[0] || "",
                      mockups: form.mockups,
                      productType: form.departmentPath?.join("/") || form.eventCategory || "flat-card",
                      price: form.regularPrice === "" ? 0 : Number(form.regularPrice),
                      salePrice: form.salePrice === "" ? null : Number(form.salePrice),
                      currency: form.currency,
                      formatOptions: form.formatOptions,
                      sizeOptions: form.sizeOptions,
                      envelopeOptions: form.envelopeOptions,
                      cornerOptions: form.cornerOptions,
                      paperStyleOptions: form.paperStyleOptions,
                      paperOptions: form.paperOptions,
                      printingOptions: form.printingOptions,
                      quantityOptions: form.quantityOptions,
                    }}
                    productOptions={{
                      formatOptions: form.formatOptions,
                      sizeOptions: form.sizeOptions,
                      envelopeOptions: form.envelopeOptions,
                      cornerOptions: form.cornerOptions,
                      paperStyleOptions: form.paperStyleOptions,
                      paperOptions: form.paperOptions,
                      printingOptions: form.printingOptions,
                    }}
                    quantityOptions={form.quantityOptions}
                    onProductOptionsChange={(key, entries) => update(key, entries)}
                    onQuantityOptionsChange={(values) => update("quantityOptions", values)}
                    onSave={save}
                    productStatus={persistedProduct?.status || "draft"}
                    saving={Boolean(saving)}
                    errorMessage={saveError}
                  />
                  <FieldError message={errors.customizerTemplate} />
                </div>
              )}
            </div>
          </FormSection>

          <FormSection id="pf-price" step={3} complete={steps.price} title="Price" description="Add a sale price only when you want to show a discount.">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <FieldLabel label="Regular price" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.regularPrice}
                  onChange={(event) => update("regularPrice", event.target.value)}
                  placeholder="45.00"
                  className={`mt-2 ${INPUT_CLASS}`}
                />
              </div>
              <div>
                <FieldLabel label="Sale price" hint="Optional" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.salePrice}
                  onChange={(event) => update("salePrice", event.target.value)}
                  placeholder="36.00"
                  className={`mt-2 ${INPUT_CLASS}`}
                />
              </div>
              <div>
                <FieldLabel label="Currency" />
                <select
                  value={form.currency}
                  onChange={(event) => update("currency", event.target.value)}
                  className={`mt-2 ${INPUT_CLASS}`}
                >
                  {CURRENCY_OPTIONS.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </div>
            </div>
            <PriceSummary regularPrice={form.regularPrice} salePrice={form.salePrice} currency={form.currency} />
          </FormSection>

          <FormSection id="pf-organize" step={4} complete={steps.organize} title="Organize" description="Help customers find this product in the shop and in search.">
            <div className="grid gap-6">
              <div data-field-error={errors.departmentPath ? "" : undefined}>
                <FieldLabel label="Department" required hint="Where the product sits in the shop" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {SUGGESTED_DEPARTMENTS.map((path) => {
                    const selected = form.departmentPath.join(">") === path.join(">");
                    return (
                      <button
                        key={path.join(">")}
                        type="button"
                        onClick={() => update("departmentPath", path)}
                        className={`border px-3 py-2 text-xs font-semibold transition ${
                          selected
                            ? "border-[#303839] bg-[#303839] text-white"
                            : "border-[#303839]/15 bg-white text-[#303839] hover:border-[#303839]/40"
                        }`}
                      >
                        {path[path.length - 1]}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModal("department")}
                  className="mt-2.5 text-sm font-semibold text-[#303839] underline underline-offset-4 transition hover:text-[#303839]/70"
                >
                  Browse all departments
                </button>
                {!!form.departmentPath.length && (
                  <p className="mt-2.5 border border-[#303839]/10 bg-white px-3 py-2 text-xs font-semibold text-[#303839]/75">
                    {form.departmentPath.join(" > ")}
                  </p>
                )}
                <FieldError message={errors.departmentPath} />
              </div>

              <div className="border-t border-[#303839]/8 pt-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <FieldLabel label="Occasion" hint="Optional" />
                <PickerButton value={form.eventCategory} placeholder="Choose an occasion" onClick={() => setActiveModal("event")} />
              </div>
              <div>
                <FieldLabel label="Recipient" hint="Optional" />
                <PickerButton value={form.recipientCategory} placeholder="Choose a recipient" onClick={() => setActiveModal("recipient")} />
              </div>
              <div>
                <FieldLabel label="Collections" hint="Optional" />
                <PickerButton
                  value={
                    form.collectionIds.length
                      ? collections
                          .filter((item) => form.collectionIds.includes(item.id))
                          .map((item) => item.name)
                          .join(", ") || `${form.collectionIds.length} selected`
                      : ""
                  }
                  placeholder="Add to collections"
                  onClick={() => setActiveModal("collections")}
                />
              </div>
            </div>
              </div>

              <div className="border-t border-[#303839]/8 pt-6">
                <FieldLabel label="Tags" required hint="5 to 10 words about subject, theme, colour and style" />
                <div className="mt-2">
            <div data-field-error={errors.tags ? "" : undefined}>
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="minimal, wedding, sage green..."
                  disabled={form.tags.length >= MAX_TAGS}
                  className={`${INPUT_CLASS} ${errors.tags ? "border-red-400" : ""}`}
                />
                <button
                  type="button"
                  onClick={addTag}
                  disabled={!tagInput.trim() || form.tags.length >= MAX_TAGS}
                  className="shrink-0 bg-[#303839] px-5 text-sm font-semibold text-white transition hover:bg-[#434C4D] disabled:opacity-40"
                >
                  Add tag
                </button>
              </div>

              {!!form.tags.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {form.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-2 bg-[#F8F6F1] px-3 py-1.5 text-xs font-semibold text-[#303839]">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`} className="text-[#303839]/70 transition hover:text-[#303839]">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs font-semibold text-[#303839]/70">
                <span>{form.tags.length} of {MAX_TAGS} tags</span>
                <span>{tagChars} of {MAX_TAG_CHARS} characters</span>
              </div>
              <FieldError message={errors.tags} />
            </div>
                </div>
              </div>

              <div className="border-t border-[#303839]/8 pt-6">
              <div data-field-error={errors.suitableAudience ? "" : undefined}>
                <FieldLabel label="Audience" required />
                <div className="mt-2">
                  <PillGroup
                    value={form.suitableAudience}
                    onChange={(value) => update("suitableAudience", value)}
                    options={AUDIENCE_OPTIONS}
                  />
                </div>
                <FieldError message={errors.suitableAudience} />
              </div>

              </div>
            </div>
          </FormSection>

          <FormSection id="pf-visibility" step={5} complete={steps.visibility} title="Visibility" description="Choose who can find the product and where it is highlighted.">
            <div className="grid gap-6">
              <div data-field-error={errors.visibility ? "" : undefined}>
                <FieldLabel label="Who can find it" required />
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {VISIBILITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => update("visibility", option.value)}
                      className={`border px-4 py-3 text-left transition ${
                        form.visibility === option.value
                          ? "border-[#303839] bg-[#303839] text-white"
                          : "border-[#303839]/15 bg-white text-[#303839] hover:border-[#303839]/40"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className={`mt-0.5 block text-xs font-medium ${form.visibility === option.value ? "text-white/70" : "text-[#303839]/70"}`}>
                        {option.helper}
                      </span>
                    </button>
                  ))}
                </div>
                <FieldError message={errors.visibility} />
              </div>

            <div className="grid gap-6">
              <div>
                <FieldLabel label="Status when published" required />
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => update("status", option.value)}
                      className={`border px-4 py-3 text-left transition ${
                        form.status === option.value
                          ? "border-[#303839] bg-[#303839] text-white"
                          : "border-[#303839]/15 bg-white text-[#303839] hover:border-[#303839]/40"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className={`mt-0.5 block text-xs font-medium ${form.status === option.value ? "text-white/70" : "text-[#303839]/70"}`}>
                        {option.helper}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <ToggleRow label="Featured" helper="Homepage featured sections" checked={form.featured} onChange={(value) => update("featured", value)} />
                <ToggleRow label="New arrival" helper="New arrival sections" checked={form.isNewArrival} onChange={(value) => update("isNewArrival", value)} />
                <ToggleRow label="Best seller" helper="Best seller sections" checked={form.isBestSeller} onChange={(value) => update("isBestSeller", value)} />
              </div>

              <div className="border border-[#303839]/10 bg-white p-4">
                <ToggleRow
                  label="Out of stock"
                  helper="Fades the product and shows an out-of-stock label on the website"
                  checked={form.isStockOut}
                  onChange={(value) => update("isStockOut", value)}
                />
                {form.isStockOut && (
                  <div className="mt-3" data-field-error={errors.comingInDays ? "" : undefined}>
                    <FieldLabel label="Back in stock in (days)" hint="Optional" />
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={form.comingInDays}
                      onChange={(event) => update("comingInDays", event.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="7"
                      className={`mt-2 max-w-[180px] ${INPUT_CLASS} ${errors.comingInDays ? "border-red-400" : ""}`}
                    />
                    <FieldError message={errors.comingInDays} />
                  </div>
                )}
              </div>
            </div>
            </div>
          </FormSection>

          <FormSection id="pf-publish" step={6} complete={steps.publish} title="Confirm and publish">
            <div data-field-error={errors.agreement ? "" : undefined}>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.agreementAccepted}
                  onChange={(event) => update("agreementAccepted", event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#303839]"
                />
                <span className="text-sm font-medium leading-6 text-[#303839]">
                  I confirm that I have the right to publish and sell this product on Husnalogy.
                  <span aria-hidden="true" className="ml-0.5 text-red-700">*</span>
                </span>
              </label>
              <FieldError message={errors.agreement} />
            </div>

          </FormSection>

          {/* Sticky actions: always reachable, whatever step you are on. */}
          <div className="sticky bottom-0 z-20 -mx-3 border-t border-[#303839]/10 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[#303839]/75">
                {readyToPublish ? (
                  <span className="font-semibold text-[#303839]">Everything needed to publish is filled in.</span>
                ) : (
                  <>
                    <span className="font-semibold text-[#303839]">{missingCount} {missingCount === 1 ? "item" : "items"}</span> left before you can publish. Drafts can be saved any time.
                  </>
                )}
              </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => save("draft")}
                disabled={Boolean(saving)}
                className="min-h-11 border border-[#303839]/20 bg-white px-6 py-3 text-sm font-semibold text-[#303839] transition hover:bg-[#F8F6F1] disabled:opacity-50"
              >
                {saving === "draft" ? "Saving…" : "Save draft"}
              </button>
              {/* Publishing is an administrator's decision. A designer hands the
                  work over for review instead; the server refuses the publish
                  transition for them regardless of what is rendered here. */}
              {isDesigner ? (
                <button
                  type="button"
                  onClick={async () => {
                    // Submit only a draft the server confirmed, by the id it
                    // returned (a new product has no id until this save).
                    const result = await save("draft");
                    if (result.ok) onSubmitForReview?.(result.productId);
                  }}
                  disabled={Boolean(saving)}
                  className="bg-[#303839] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#434C4D] disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save and submit for review"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => save("publish")}
                  disabled={Boolean(saving)}
                  className="min-h-11 bg-[#303839] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#434C4D] disabled:opacity-50"
                >
                  {saving === "publish" ? "Publishing…" : form.status === "hidden" ? "Save as hidden" : editingId && persistedProduct?.status === "active" ? "Update product" : "Publish product"}
                </button>
              )}
            </div>
            </div>
          </div>

          {/* Mobile: checklist and preview, collapsible, below the form */}
          <div className="space-y-2 lg:hidden">
            {checklistPanel}
            <button
              type="button"
              onClick={() => setMobilePreviewOpen((open) => !open)}
              aria-expanded={mobilePreviewOpen}
              className="flex min-h-12 w-full items-center justify-between rounded-[12px] border border-[#303839]/10 bg-white px-4 py-3 text-sm font-semibold text-[#303839]"
            >
              Product preview
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`transition ${mobilePreviewOpen ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {mobilePreviewOpen && <div className="mt-2">{previewPanel}</div>}
          </div>
        </div>

        {/* -------------------------------- Right: checklist + preview ---- */}
        <aside className="sticky top-20 hidden min-w-0 space-y-4 self-start lg:block">
          {checklistPanel}
          {previewPanel}
        </aside>
      </div>

      {/* -------------------------------- Modals ------------------------ */}
      {activeModal === "department" && (
        <DepartmentModal
          initialPath={form.departmentPath}
          onSelect={(path) => {
            update("departmentPath", path);
            setActiveModal("");
          }}
          onClose={() => setActiveModal("")}
        />
      )}

      {activeModal === "event" && (
        <CategoryModal
          title="Select a Category"
          options={EVENT_OPTIONS}
          value={form.eventCategory}
          onSelect={(value) => {
            update("eventCategory", value);
            setActiveModal("");
          }}
          onClose={() => setActiveModal("")}
        />
      )}

      {activeModal === "recipient" && (
        <CategoryModal
          title="Select a Category"
          options={RECIPIENT_OPTIONS}
          value={form.recipientCategory}
          onSelect={(value) => {
            update("recipientCategory", value);
            setActiveModal("");
          }}
          onClose={() => setActiveModal("")}
        />
      )}

      {activeModal === "collections" && (
        <CollectionsModal
          collections={collections}
          selectedIds={form.collectionIds}
          onToggle={toggleCollection}
          onTrendingChange={updateCollectionTrending}
          onSuiteChange={updateCollectionSuite}
          onCreate={(collection, selectForProduct = true) => {
            setCollections((current) => [...current, collection].sort((a, b) => a.name.localeCompare(b.name)));
            if (!selectForProduct) return;
            setForm((current) => ({
              ...current,
              collectionIds: [...current.collectionIds, collection.id],
              collectionSections: {
                ...(current.collectionSections || {}),
                [collection.id]: DEFAULT_COLLECTION_SECTION,
              },
            }));
          }}
          onClose={() => setActiveModal("")}
        />
      )}
    </div>
  );
}
