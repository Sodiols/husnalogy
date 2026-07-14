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

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft", helper: "Saved in admin, not visible on the website" },
  { value: "active", label: "Active", helper: "Published and visible on the website" },
  { value: "hidden", label: "Hidden", helper: "Stored in admin, hidden from the website" },
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
      <span className="text-sm font-bold text-[#111111]">
        {label}
        {required && <span className="ml-1 text-[#BDBDBD]">*</span>}
      </span>
      {hint && <span className="text-xs font-medium text-[#111111]/50">{hint}</span>}
    </div>
  );
}

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1.5 text-xs font-bold text-red-700">{message}</p>;
}

function FormSection({ title, description = "", children }: any) {
  return (
    <section className="border border-[#111111]/10 bg-white p-5 sm:p-6">
      <h3 className="font-body text-[1.4rem] font-semibold leading-tight text-[#111111]">{title}</h3>
      {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-[#111111]/60">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
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
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#111111]/45 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-xl flex-col bg-white shadow-premium"
      >
        <div className="flex items-center justify-between border-b border-[#111111]/10 px-5 py-4">
          <h4 className="font-body text-xl font-semibold text-[#111111]">{title}</h4>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center text-[#111111]/60 transition hover:bg-[#F8F8F8] hover:text-[#111111]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-[#111111]/10 px-5 py-4">{footer}</div>}
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
            className={`border px-4 py-2 text-sm font-bold transition ${
              selected
                ? "border-[#111111] bg-[#111111] text-white"
                : "border-[#111111]/15 bg-white text-[#111111] hover:border-[#111111]/40"
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
      className="flex w-full items-center justify-between gap-4 border border-[#111111]/12 bg-white px-4 py-3 text-left transition hover:border-[#111111]/30"
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[#111111]">{label}</span>
        {helper && <span className="mt-0.5 block text-xs font-medium text-[#111111]/55">{helper}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 transition ${checked ? "bg-[#111111]" : "bg-[#111111]/15"}`}>
        <span className={`absolute top-1 h-4 w-4 bg-white transition-all ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

const INPUT_CLASS =
  "h-11 w-full border border-[#111111]/15 bg-white px-4 text-sm font-medium text-[#111111] outline-none transition placeholder:text-[#111111]/35 focus:border-[#111111]/50 focus:ring-2 focus:ring-[#111111]/10";

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
          <p className="min-w-0 truncate text-xs font-bold text-[#111111]/60">
            {path.length ? path.join(" > ") : "Choose a department below"}
          </p>
          <button
            type="button"
            disabled={!path.length}
            onClick={() => onSelect(path)}
            className="shrink-0 bg-[#111111] px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-[#222222] disabled:opacity-40"
          >
            Use this department
          </button>
        </div>
      }
    >
      {path.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#111111]/70">
          <button type="button" onClick={() => setPath([])} className="px-2 py-1 transition hover:bg-[#F8F8F8]">
            All Departments
          </button>
          {path.map((segment, index) => (
            <span key={segment} className="flex items-center gap-1.5">
              <span className="text-[#111111]/35">&gt;</span>
              <button
                type="button"
                onClick={() => setPath(path.slice(0, index + 1))}
                className={`px-2 py-1 transition hover:bg-[#F8F8F8] ${index === path.length - 1 ? "text-[#111111]" : ""}`}
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
            className="flex items-center justify-between gap-3 border border-[#111111]/10 bg-white px-4 py-3 text-left text-sm font-bold text-[#111111] transition hover:border-[#111111]/35 hover:bg-[#F8F8F8]"
          >
            <span>{node.name}</span>
            {node.children?.length ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#111111]/40"><path d="m9 18 6-6-6-6" /></svg>
            ) : (
              <span className="shrink-0 text-[11px] font-extrabold uppercase tracking-wide text-[#BDBDBD]">Select</span>
            )}
          </button>
        ))}
        {!currentLevel.length && (
          <p className="px-1 py-4 text-sm text-[#111111]/60">This department has no further options. Use the button below to select it.</p>
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
            className={`flex items-center justify-between gap-3 border px-4 py-3 text-left text-sm font-bold transition ${
              value === option
                ? "border-[#111111] bg-[#111111] text-white"
                : "border-[#111111]/10 bg-white text-[#111111] hover:border-[#111111]/35 hover:bg-[#F8F8F8]"
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
        <button type="button" onClick={onClose} className="w-full bg-[#111111] px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-[#222222]">
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
                  className={`flex items-center justify-between border px-4 py-3 text-left text-sm font-bold transition ${
                    active ? "border-[#111111] bg-[#111111] text-white" : "border-[#111111]/10 bg-white text-[#111111] hover:border-[#111111]/35"
                  }`}
                >
                  <span>{collection.name}</span>
                  {collection.isTrendingWedding && <span className={`text-[10px] uppercase tracking-[0.08em] ${active ? "text-white/70" : "text-[#111111]/45"}`}>Wedding</span>}
                </button>
              );
            })}
            {!parentCollections.length && (
              <p className="border border-dashed border-[#111111]/20 bg-white px-4 py-4 text-sm font-semibold text-[#111111]/60">
                Create a parent collection first.
              </p>
            )}
          </div>

          <div className="mt-3 border border-[#111111]/10 bg-[#F8F8F8] p-4">
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
                className="shrink-0 bg-[#111111] px-4 text-xs font-extrabold text-white transition hover:bg-[#222222] disabled:opacity-40"
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
                        ? "border-[#111111] bg-[#111111] text-white"
                        : "border-[#111111]/10 bg-white text-[#111111] hover:border-[#111111]/35 hover:bg-[#F8F8F8]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onToggle(collection.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-bold"
                    >
                      <span className="min-w-0 truncate">{collection.name}</span>
                      <span className={`grid h-5 w-5 shrink-0 place-items-center border ${selected ? "border-white bg-white text-[#111111]" : "border-[#111111]/30"}`}>
                        {selected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
              {!childCollections.length && (
                <p className="border border-dashed border-[#111111]/20 bg-white px-4 py-4 text-sm font-semibold text-[#111111]/60">
                  No child collections yet. Create one for RSVP cards, thank you cards, or another suite piece.
                </p>
              )}
            </div>

            <div className="mt-3 border border-[#111111]/10 bg-[#F8F8F8] p-4">
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
                  className="shrink-0 bg-[#111111] px-4 text-xs font-extrabold text-white transition hover:bg-[#222222] disabled:opacity-40"
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
              <label className="flex cursor-pointer items-start justify-between gap-3 border border-[#111111]/10 bg-white px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-xs font-extrabold text-[#111111]">Suite</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[#111111]/55">Product pages will say "Shop the {activeParent.name} suite".</span>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(activeParent?.isSuite)}
                  onChange={(event) => onSuiteChange(activeParent.id, event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#111111]"
                />
              </label>
              <label className="flex cursor-pointer items-start justify-between gap-3 border border-[#111111]/10 bg-white px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-xs font-extrabold text-[#111111]">Wedding page</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[#111111]/55">Show this parent collection in the Wedding page trending row.</span>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(activeParent?.isTrendingWedding)}
                  onChange={(event) => onTrendingChange(activeParent.id, event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#111111]"
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
        dragActive ? "border-[#111111] bg-[#F8F8F8]" : "border-[#111111]/20 bg-[#F8F8F8]/60 hover:border-[#111111]/45 hover:bg-[#F8F8F8]"
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
          <p className="text-sm font-extrabold text-[#111111]">Uploading... {progress}%</p>
          <div className="mt-2 h-1.5 w-full bg-[#111111]/10">
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
            <div className="relative h-40 w-40 shrink-0 overflow-hidden border border-[#111111]/10 bg-[#F8F8F8]">
              <img src={value} alt="Main product" className="h-full w-full object-cover" />
              <span className="absolute left-2 top-2 bg-[#111111] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#BDBDBD]">Main</span>
            </div>
            <div className="grid gap-2">
              <label className="cursor-pointer border border-[#111111]/15 bg-white px-4 py-2 text-center text-xs font-extrabold text-[#111111] transition hover:bg-[#F8F8F8]">
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
              <button type="button" onClick={() => onChange("")} className="border border-red-200 bg-white px-4 py-2 text-xs font-extrabold text-red-700 transition hover:bg-red-50">
                Remove
              </button>
              {uploading && <p className="text-xs font-bold text-[#111111]/60">Uploading... {progress}%</p>}
            </div>
          </div>
        ) : (
          <UploadDropzone id="main-image-upload" onFiles={handleFiles} uploading={uploading} progress={progress}>
            <span className="grid h-11 w-11 place-items-center bg-white text-[#111111]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L6 23" /></svg>
            </span>
            <span className="mt-3 text-sm font-extrabold text-[#111111]">Upload the main product image</span>
            <span className="mt-1 text-xs font-medium text-[#111111]/55">Drag and drop or click to browse. Up to 15MB.</span>
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
      <p className="mt-1 text-xs font-medium text-[#111111]/55">
        Upload several mockup views. Drag to reorder, or make one the main product image.
      </p>

      <div className="mt-2">
        <UploadDropzone id="mockup-upload" multiple onFiles={handleFiles} uploading={uploading} progress={progress}>
          <span className="grid h-11 w-11 place-items-center bg-white text-[#111111]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <span className="mt-3 text-sm font-extrabold text-[#111111]">Add mockup images</span>
          <span className="mt-1 text-xs font-medium text-[#111111]/55">Drag and drop multiple files or click to browse.</span>
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
              className="group/mockup cursor-grab border border-[#111111]/10 bg-white active:cursor-grabbing"
            >
              <div className="relative aspect-square overflow-hidden bg-[#F8F8F8]">
                <img src={mockup} alt={`Mockup ${index + 1}`} className="h-full w-full object-cover" />
              </div>
              <div className="grid gap-1 p-2">
                <button
                  type="button"
                  onClick={() => onPromoteToMain(index)}
                  className="border border-[#111111]/15 px-2 py-1 text-[11px] font-extrabold text-[#111111] transition hover:border-[#BDBDBD] hover:text-[#BDBDBD]"
                >
                  Make main image
                </button>
                <button type="button" onClick={() => removeMockup(index)} className="border border-red-200 px-2 py-1 text-[11px] font-extrabold text-red-700 transition hover:bg-red-50">
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
    dark: "bg-[#111111] text-white",
    soft: "bg-[#F8F8F8] text-[#111111]",
    accent: "border border-[#BDBDBD] bg-white text-[#8a6d1a]",
    danger: "bg-[#111111]/85 text-white",
  };
  return <span className={`px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] ${tones[tone]}`}>{children}</span>;
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

  const statusLabel = STATUS_OPTIONS.find((option) => option.value === form.status)?.label || "Draft";
  const visibilityLabel = VISIBILITY_OPTIONS.find((option) => option.value === form.visibility)?.label || "Public";

  return (
    <div className="border border-[#111111]/10 bg-white">
      <div className="border-b border-[#111111]/10 bg-[#F8F8F8] px-4 py-3">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#111111]/55">Live preview</p>
        <p className="mt-0.5 text-xs font-medium text-[#111111]/60">How this product will look to customers</p>
      </div>

      <div className="p-4">
        <div className="relative aspect-square overflow-hidden bg-[#F8F8F8]">
          {previewImage ? (
            <img
              src={previewImage}
              alt="Product preview"
              className={`h-full w-full object-cover transition ${form.isStockOut ? "opacity-55" : ""}`}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[#111111]/40">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L6 23" /></svg>
              <span className="text-xs font-bold">Main image preview</span>
            </div>
          )}

          <div className="absolute left-2 top-2 flex flex-col items-start gap-1.5">
            {form.isStockOut && <PreviewBadge tone="danger">{stockLabel}</PreviewBadge>}
            {form.isNewArrival && <PreviewBadge tone="soft">New Arrival</PreviewBadge>}
            {form.isBestSeller && <PreviewBadge tone="dark">Best Seller</PreviewBadge>}
            {form.featured && <PreviewBadge tone="accent">Featured</PreviewBadge>}
          </div>
        </div>

        <h4 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-5 text-[#111111]">
          {form.title || "Product title appears here"}
        </h4>

        {priceLabel && (
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-bold text-[#111111]">{priceLabel}</span>
            {compareLabel && <span className="text-[#111111]/50 line-through">{compareLabel}</span>}
          </p>
        )}

        {departmentLabel && (
          <p className="mt-2 text-xs font-semibold text-[#111111]/70">{form.departmentPath.join(" > ")}</p>
        )}

        {(form.eventCategory || form.recipientCategory || collectionNames.length > 0) && (
          <p className="mt-1 text-xs font-medium text-[#111111]/60">
            {[form.eventCategory, form.recipientCategory, ...collectionNames].filter(Boolean).join(" · ")}
          </p>
        )}

        {!!form.tags.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {form.tags.slice(0, 6).map((tag) => (
              <span key={tag} className="bg-[#F8F8F8] px-2 py-0.5 text-[11px] font-semibold text-[#111111]/75">
                {tag}
              </span>
            ))}
            {form.tags.length > 6 && (
              <span className="px-1 py-0.5 text-[11px] font-semibold text-[#111111]/50">+{form.tags.length - 6} more</span>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-[#111111]/10 pt-3">
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

export default function ProductUploadForm({ product = null, onSaved, onClose }) {
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

  const editingId = product?.id || null;

  useEffect(() => {
    setForm(buildInitialForm(product));
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

  const validate = (statusToSave) => {
    const nextErrors: any = {};
    const preparedCustomizerTemplate = form.customizerTemplate
      ? normalizeCustomizerTemplate(prepareCustomizerTemplateForSave(form.customizerTemplate))
      : null;

    if (!form.title.trim()) nextErrors.title = "Title is required.";

    if (statusToSave !== "draft") {
      if (!form.departmentPath.length) nextErrors.departmentPath = "Marketplace Department is required.";
      if (!form.description.trim()) nextErrors.description = "Description is required.";
      if (!form.mainImage && !form.mockups.length) nextErrors.mainImage = "A main product image is required.";
      if (!form.tags.length) nextErrors.tags = "Add at least one tag.";
      if (!form.suitableAudience) nextErrors.suitableAudience = "Suitable Audience is required.";
      if (!form.visibility) nextErrors.visibility = "Product Visibility is required.";
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

  const buildPayload = (statusToSave) => {
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
      slug: editingId ? product.slug : slugify(form.title),
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
      ...(preparedCustomizerTemplate?.enabled || product?.customizerTemplate
        ? { customizerTemplate: preparedCustomizerTemplate }
        : {}),
    };
  };

  const save = async (requestedAction) => {
    // "publish" keeps the admin's chosen status unless it is still draft.
    const statusToSave =
      requestedAction === "draft" ? "draft" : form.status === "hidden" ? "hidden" : "active";

    const validationErrors = validate(statusToSave);
    if (Object.keys(validationErrors).length) {
      setSaveError("Please fix the highlighted fields before continuing.");
      const firstField = formRef.current?.querySelector("[data-field-error]");
      firstField?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSaving(requestedAction);
    setSaveError("");
    setSuccessMessage("");

    try {
      const endpoint = editingId ? `/api/admin/products/${editingId}` : "/api/admin/products";
      const response = await fetch(endpoint, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(statusToSave)),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(String(firstError || "Product could not be saved."));
      }

      const message =
        requestedAction === "draft"
          ? "Draft saved."
          : statusToSave === "hidden"
            ? "Product saved as hidden."
            : "Product published. It is now live on the website.";
      setSuccessMessage(message);
      onSaved?.(data.product, message);
    } catch (error) {
      setSaveError(error.message || "Product could not be saved.");
    } finally {
      setSaving("");
    }
  };

  const previewPanel = <LivePreview form={form} collections={collections} />;

  return (
    <div ref={formRef} className="border border-[#111111]/10 bg-[#F8F8F8]/45 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#111111]/50">Husnalogy Admin</p>
          <h2 className="mt-1 font-body text-[2rem] font-semibold leading-tight text-[#111111]">
            {editingId ? "Edit product" : "Add a new product"}
          </h2>
        </div>
        <button type="button" onClick={onClose} className="border border-[#111111]/15 bg-white px-4 py-2 text-xs font-extrabold text-[#111111] transition hover:bg-[#F8F8F8]">
          Close
        </button>
      </div>

      {successMessage && (
        <p className="mt-4 border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-800">{successMessage}</p>
      )}
      {saveError && (
        <p className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{saveError}</p>
      )}

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* -------------------------------- Left: form ------------------ */}
        <div className="min-w-0 space-y-5">
          <FormSection title="Product information" description="Give the product a clear title and story customers can trust.">
            <div className="grid gap-5">
              <div data-field-error={errors.title ? "" : undefined}>
                <FieldLabel label="Title" required />
                <input
                  value={form.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="Describe the product the way a customer would search for it"
                  className={`mt-2 ${INPUT_CLASS} ${errors.title ? "border-red-400" : ""}`}
                />
                <FieldError message={errors.title} />
              </div>

              <div data-field-error={errors.departmentPath ? "" : undefined}>
                <FieldLabel label="Marketplace Department" required />
                <div className="mt-2 flex flex-wrap gap-2">
                  {SUGGESTED_DEPARTMENTS.map((path) => {
                    const selected = form.departmentPath.join(">") === path.join(">");
                    return (
                      <button
                        key={path.join(">")}
                        type="button"
                        onClick={() => update("departmentPath", path)}
                        className={`border px-3 py-2 text-xs font-bold transition ${
                          selected
                            ? "border-[#111111] bg-[#111111] text-white"
                            : "border-[#111111]/15 bg-white text-[#111111] hover:border-[#111111]/40"
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
                  className="mt-2.5 text-sm font-extrabold text-[#111111] underline underline-offset-4 transition hover:text-[#BDBDBD]"
                >
                  Browse all departments
                </button>
                {!!form.departmentPath.length && (
                  <p className="mt-2.5 border border-[#111111]/10 bg-white px-3 py-2 text-xs font-bold text-[#111111]/75">
                    {form.departmentPath.join(" > ")}
                  </p>
                )}
                <FieldError message={errors.departmentPath} />
              </div>

              <div data-field-error={errors.description ? "" : undefined}>
                <FieldLabel label="Description" required hint="Tell the product story and explain why it is special" />
                <textarea
                  value={form.description}
                  onChange={(event) => update("description", event.target.value)}
                  rows={7}
                  placeholder="Materials, personalization, finish, what is included, and why customers will love it..."
                  className={`mt-2 w-full border border-[#111111]/15 bg-white px-4 py-3 text-sm font-medium leading-6 text-[#111111] outline-none transition placeholder:text-[#111111]/35 focus:border-[#111111]/50 focus:ring-2 focus:ring-[#111111]/10 ${errors.description ? "border-red-400" : ""}`}
                />
                <FieldError message={errors.description} />
              </div>
            </div>
          </FormSection>

          <FormSection title="Images & mockups" description="Uploads are stored in Supabase Storage and shown on the customer website after publishing.">
            <div className="grid gap-6">
              <div data-field-error={errors.mainImage ? "" : undefined}>
                <MainImageUploader value={form.mainImage} onChange={(value) => update("mainImage", value)} error={errors.mainImage} />
              </div>
              <MockupUploader
                mockups={form.mockups}
                onChange={(value) => update("mockups", value)}
                onPromoteToMain={promoteMockupToMain}
              />
            </div>
          </FormSection>

          <FormSection title="Categories" description="Help customers find this product by occasion, recipient, and collection.">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <FieldLabel label="Events & Occasions" />
                <button type="button" onClick={() => setActiveModal("event")} className="mt-2 w-full border border-[#111111]/15 bg-white px-4 py-2.5 text-sm font-extrabold text-[#111111] transition hover:border-[#111111]/40">
                  Select
                </button>
                {form.eventCategory && <p className="mt-2 text-xs font-bold text-[#111111]/70">{form.eventCategory}</p>}
              </div>
              <div>
                <FieldLabel label="Recipient" />
                <button type="button" onClick={() => setActiveModal("recipient")} className="mt-2 w-full border border-[#111111]/15 bg-white px-4 py-2.5 text-sm font-extrabold text-[#111111] transition hover:border-[#111111]/40">
                  Select
                </button>
                {form.recipientCategory && <p className="mt-2 text-xs font-bold text-[#111111]/70">{form.recipientCategory}</p>}
              </div>
              <div>
                <FieldLabel label="Collections" />
                <button type="button" onClick={() => setActiveModal("collections")} className="mt-2 w-full border border-[#111111]/15 bg-white px-4 py-2.5 text-sm font-extrabold text-[#111111] transition hover:border-[#111111]/40">
                  Select
                </button>
                {!!form.collectionIds.length && (
                  <p className="mt-2 text-xs font-bold text-[#111111]/70">
                    {collections
                      .filter((item) => form.collectionIds.includes(item.id))
                      .map((item) => item.name)
                      .join(", ") || `${form.collectionIds.length} selected`}
                  </p>
                )}
              </div>
            </div>
          </FormSection>

          <FormSection title="Tags" description="Use descriptive words related to the subject, theme, color, style, and product type. Aim for 5 to 10 tags per product. Do not spam tags.">
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
                  className="shrink-0 bg-[#111111] px-5 text-sm font-extrabold text-white transition hover:bg-[#222222] disabled:opacity-40"
                >
                  Add Tag
                </button>
              </div>

              {!!form.tags.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {form.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-2 bg-[#F8F8F8] px-3 py-1.5 text-xs font-bold text-[#111111]">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`} className="text-[#111111]/50 transition hover:text-[#111111]">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs font-bold text-[#111111]/55">
                <span>All Tags {form.tags.length} of {MAX_TAGS} used</span>
                <span>Characters {tagChars} of {MAX_TAG_CHARS} used</span>
              </div>
              <FieldError message={errors.tags} />
            </div>
          </FormSection>

          <FormSection title="Additional information">
            <div className="grid gap-6">
              <div data-field-error={errors.suitableAudience ? "" : undefined}>
                <FieldLabel label="Suitable Audience" required />
                <div className="mt-2">
                  <PillGroup
                    value={form.suitableAudience}
                    onChange={(value) => update("suitableAudience", value)}
                    options={AUDIENCE_OPTIONS}
                  />
                </div>
                <FieldError message={errors.suitableAudience} />
              </div>

              <div data-field-error={errors.visibility ? "" : undefined}>
                <FieldLabel label="Product Visibility" required />
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {VISIBILITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => update("visibility", option.value)}
                      className={`border px-4 py-3 text-left transition ${
                        form.visibility === option.value
                          ? "border-[#111111] bg-[#111111] text-white"
                          : "border-[#111111]/15 bg-white text-[#111111] hover:border-[#111111]/40"
                      }`}
                    >
                      <span className="block text-sm font-extrabold">{option.label}</span>
                      <span className={`mt-0.5 block text-xs font-medium ${form.visibility === option.value ? "text-white/70" : "text-[#111111]/55"}`}>
                        {option.helper}
                      </span>
                    </button>
                  ))}
                </div>
                <FieldError message={errors.visibility} />
              </div>

              <div>
                <FieldLabel label="Show Customize It button" required hint="Whether customers can personalize this product" />
                <div className="mt-2">
                  <PillGroup
                    value={form.customizeEnabled ? "yes" : "no"}
                    onChange={(value) => update("customizeEnabled", value === "yes")}
                    options={[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                    ]}
                  />
                </div>
              </div>

            </div>
          </FormSection>

          {form.customizeEnabled && (
            <FormSection
              title="Design Studio"
              description="Create the actual editable product design here. Add pages, text, photo areas and shapes, mark what customers may personalize, and configure product options. Mockups above are what customers browse; this design is what they personalize."
            >
              <div data-field-error={errors.customizerTemplate ? "" : undefined}>
                <AdminDesignBuilder
                  template={form.customizerTemplate}
                  onChange={(next) => update("customizerTemplate", next)}
                  productName={form.title || "Product"}
                  product={{
                    title: form.title || "Product",
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
                  productStatus={form.status}
                  saving={Boolean(saving)}
                  errorMessage={saveError}
                />
                <FieldError message={errors.customizerTemplate} />
              </div>
            </FormSection>
          )}

          <FormSection title="Pricing">
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
          </FormSection>

          <FormSection title="Status & display" description="Control where and how this product appears on the website.">
            <div className="grid gap-6">
              <div>
                <FieldLabel label="Product Status" required />
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => update("status", option.value)}
                      className={`border px-4 py-3 text-left transition ${
                        form.status === option.value
                          ? "border-[#111111] bg-[#111111] text-white"
                          : "border-[#111111]/15 bg-white text-[#111111] hover:border-[#111111]/40"
                      }`}
                    >
                      <span className="block text-sm font-extrabold">{option.label}</span>
                      <span className={`mt-0.5 block text-xs font-medium ${form.status === option.value ? "text-white/70" : "text-[#111111]/55"}`}>
                        {option.helper}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <ToggleRow label="Featured" helper="Homepage featured sections" checked={form.featured} onChange={(value) => update("featured", value)} />
                <ToggleRow label="New Arrival" helper="New arrival sections" checked={form.isNewArrival} onChange={(value) => update("isNewArrival", value)} />
                <ToggleRow label="Best Seller" helper="Best seller sections" checked={form.isBestSeller} onChange={(value) => update("isBestSeller", value)} />
              </div>

              <div className="border border-[#111111]/10 bg-white p-4">
                <ToggleRow
                  label="Stock Out"
                  helper="Fades the product and shows a Stock Out label on the website"
                  checked={form.isStockOut}
                  onChange={(value) => update("isStockOut", value)}
                />
                {form.isStockOut && (
                  <div className="mt-3" data-field-error={errors.comingInDays ? "" : undefined}>
                    <FieldLabel label="Coming in days" hint="Optional — customers will see 'Coming in X days'" />
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
          </FormSection>

          <FormSection title="Agreement & publish">
            <div data-field-error={errors.agreement ? "" : undefined}>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.agreementAccepted}
                  onChange={(event) => update("agreementAccepted", event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#111111]"
                />
                <span className="text-sm font-medium leading-6 text-[#111111]">
                  I confirm that I have the right to publish and sell this product on Husnalogy.
                  <span className="ml-1 text-[#BDBDBD]">*</span>
                </span>
              </label>
              <FieldError message={errors.agreement} />
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => save("draft")}
                disabled={Boolean(saving)}
                className="border border-[#111111]/20 bg-white px-6 py-3 text-sm font-extrabold text-[#111111] transition hover:bg-[#F8F8F8] disabled:opacity-50"
              >
                {saving === "draft" ? "Saving..." : "Save as Draft"}
              </button>
              <button
                type="button"
                onClick={() => save("publish")}
                disabled={Boolean(saving)}
                className="bg-[#111111] px-6 py-3 text-sm font-extrabold text-white transition hover:bg-[#222222] disabled:opacity-50"
              >
                {saving === "publish" ? "Publishing..." : "Publish Product"}
              </button>
            </div>
          </FormSection>

          {/* Mobile preview: collapsible, below the form */}
          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => setMobilePreviewOpen((open) => !open)}
              className="flex w-full items-center justify-between border border-[#111111]/10 bg-white px-4 py-3 text-sm font-extrabold text-[#111111]"
            >
              Product preview
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`transition ${mobilePreviewOpen ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {mobilePreviewOpen && <div className="mt-2">{previewPanel}</div>}
          </div>
        </div>

        {/* -------------------------------- Right: sticky preview ------- */}
        <aside className="sticky top-24 hidden min-w-0 self-start lg:block">{previewPanel}</aside>
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
