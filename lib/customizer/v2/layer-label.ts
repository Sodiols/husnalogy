/**
 * The name a layer goes by in the studio's Layers panel.
 *
 * A text layer reads as its words ("wedding") unless the admin gave it a
 * name of their own: the names the studio hands out itself — "Text",
 * "Heading", "Body text", "Text copy" — say nothing a glance at the row's
 * icon doesn't. Every other layer keeps its name, and a missing or id-like
 * name falls back to what the object is ("Image", "Shape"), never a raw id.
 */

const GENERIC_TEXT_NAME = /^(text|text layer|new text|heading|subheading|body|body text)( copy)*$/i;

const KIND_LABELS: Record<string, string> = {
  text: "Text",
  image: "Image",
  frame: "Photo frame",
  shape: "Shape",
  grid: "Photo grid",
  group: "Group",
  element: "Element",
  background: "Background",
  qrCode: "QR code",
};

/** What the object is, in words. */
export function layerKindLabel(layer: { type?: unknown } | null | undefined): string {
  return KIND_LABELS[String(layer?.type || "")] || "Layer";
}

/** The first line of a text layer's words, whitespace collapsed. */
function firstLine(text: unknown): string {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find(Boolean) || "";
}

export function layerDisplayName(layer: Record<string, any> | null | undefined): string {
  if (!layer) return "Layer";
  const name = String(layer.name ?? "").trim();
  const idLike = !name || name === String(layer.id ?? "");
  if (layer.type === "text") {
    const words = firstLine(layer.text);
    if (words && (idLike || GENERIC_TEXT_NAME.test(name))) return words;
  }
  return idLike ? layerKindLabel(layer) : name;
}
