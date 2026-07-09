export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug || "").trim());
}

export function cleanString(value) {
  return String(value ?? "").trim();
}

export function cleanOptionalString(value) {
  const cleaned = cleanString(value);
  return cleaned || "";
}

export function clampString(value, maxLength = 500) {
  return cleanString(value).slice(0, maxLength);
}

export function clampNumber(value, { min = 0, max = 10000000, fallback = 0 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }

  return String(value || "")
    .split(/[\n,]+/)
    .map(cleanString)
    .filter(Boolean);
}

export function normalizeBoolean(value) {
  return value === true || value === "true" || value === "on" || value === "1";
}

export function normalizePrice(value) {
  if (value === "" || value === null || value === undefined) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export function jsonResponse(data, status = 200) {
  return Response.json(data, { status });
}

export function validationError(message, details = {}) {
  return jsonResponse({ ok: false, error: message, details }, 400);
}
