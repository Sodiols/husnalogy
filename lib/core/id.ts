export function createId(prefix = "item") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);

  return `${prefix}-${Date.now()}-${random}`;
}

export function nowIso() {
  return new Date().toISOString();
}
