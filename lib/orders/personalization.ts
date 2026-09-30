/**
 * Validation of the simple, product-page personalization form (the product's
 * `customizationFields`: names, dates, venue, a photo …) — the flow that does
 * not use the full customizer.
 *
 * Values are checked against the SERVER copy of the product's field list:
 * unknown field names, wrong types, choices that are not offered and missing
 * required answers are rejected. Uploaded files are accepted only as storage
 * paths that the database confirms belong to the customer; their stored
 * description (bucket, name, MIME type, size) comes from the database, never
 * from the request. No URL from the browser is ever stored.
 */

import { isValidEmail } from "@/lib/validation";
import { normalizeText } from "@/lib/orders/bd-contact";

export type VerifiedUpload = {
  bucket: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
};

export type PersonalizationResult =
  | { ok: true; values: Record<string, string | boolean>; files: Record<string, VerifiedUpload> }
  | { ok: false; errors: string[] };

type Field = { name: string; label: string; type: string; options: string[]; required: boolean };

function fieldsOf(product: Record<string, any>): Field[] {
  const list = Array.isArray(product?.customizationFields) ? product.customizationFields : [];
  return list
    .filter((field: any) => field && typeof field.name === "string" && field.name)
    .map((field: any) => ({
      name: String(field.name),
      label: String(field.label || field.name),
      type: String(field.type || "text"),
      options: Array.isArray(field.options) ? field.options.map(String) : [],
      required: field.required === true,
    }));
}

const FILE_TYPES = new Set(["image", "file"]);

function checkScalar(field: Field, value: string | boolean): { ok: true; value: string | boolean } | { ok: false; error: string } {
  if (field.type === "checkbox") {
    return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: `${field.label} must be a yes/no choice.` };
  }
  if (typeof value !== "string") return { ok: false, error: `${field.label} has an invalid value.` };

  const text = normalizeText(value, { min: 0, max: 1000, multiline: field.type === "textarea" });
  if (text.ok === false) return { ok: false, error: `${field.label} contains characters that are not allowed or is too long.` };
  const clean = text.value;
  if (!clean) return { ok: true, value: "" };

  switch (field.type) {
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(clean) && !Number.isNaN(Date.parse(clean)) ? { ok: true, value: clean } : { ok: false, error: `${field.label} must be a valid date.` };
    case "time":
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(clean) ? { ok: true, value: clean } : { ok: false, error: `${field.label} must be a valid time.` };
    case "email":
      return isValidEmail(clean) && clean.length <= 254 ? { ok: true, value: clean.toLowerCase() } : { ok: false, error: `${field.label} must be a valid email address.` };
    case "number":
      return /^-?\d+(\.\d+)?$/.test(clean) && Number.isFinite(Number(clean)) ? { ok: true, value: clean } : { ok: false, error: `${field.label} must be a number.` };
    case "color":
      return /^#[0-9a-f]{6}$/i.test(clean) ? { ok: true, value: clean.toLowerCase() } : { ok: false, error: `${field.label} must be a colour.` };
    case "select":
      return !field.options.length || field.options.includes(clean) ? { ok: true, value: clean } : { ok: false, error: `${field.label} must be one of the offered choices.` };
    default:
      // A URL is never an answer to a text field — it is how the old product
      // page smuggled signed storage links into orders.
      return /^(https?|javascript|data|vbscript):/i.test(clean) ? { ok: false, error: `${field.label} cannot contain a link.` } : { ok: true, value: clean };
  }
}

export function resolvePersonalization(
  product: Record<string, any>,
  personalization: Record<string, string | boolean>,
  uploads: Record<string, { path: string }>,
  verifiedUploads: Map<string, VerifiedUpload>,
): PersonalizationResult {
  const fields = fieldsOf(product);
  const byName = new Map(fields.map((field) => [field.name, field]));
  const errors: string[] = [];
  const values: Record<string, string | boolean> = {};
  const files: Record<string, VerifiedUpload> = {};

  for (const [name, raw] of Object.entries(personalization || {})) {
    const field = byName.get(name);
    if (!field) {
      errors.push(`"${name.slice(0, 60)}" is not a personalization field for this product.`);
      continue;
    }
    if (FILE_TYPES.has(field.type)) {
      errors.push(`${field.label} must be uploaded as a file.`);
      continue;
    }
    const checked = checkScalar(field, raw);
    if (checked.ok === false) errors.push(checked.error);
    else if (checked.value !== "" && checked.value !== false) values[name] = checked.value;
  }

  for (const [name, reference] of Object.entries(uploads || {})) {
    const field = byName.get(name);
    if (!field || !FILE_TYPES.has(field.type)) {
      errors.push(`"${name.slice(0, 60)}" does not accept a file.`);
      continue;
    }
    const verified = verifiedUploads.get(reference.path);
    if (!verified) {
      errors.push(`The file for ${field.label} could not be verified. Please upload it again.`);
      continue;
    }
    files[name] = verified;
  }

  for (const field of fields) {
    if (!field.required) continue;
    const answered = FILE_TYPES.has(field.type) ? Boolean(files[field.name]) : values[field.name] !== undefined;
    if (!answered) errors.push(`${field.label} is required.`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, values, files };
}
