/**
 * Alternative text for public product imagery.
 *
 * Author-written text wins: `product.imageAltText[i]` describes
 * `product.images[i]` (the product data model stores them in the same order).
 * It is used only for that exact image, so a description can never be
 * attached to a different picture (a mockup, a placeholder).
 *
 * Otherwise the product's own title names the picture. Nothing is inferred
 * from the title about colour, material or people: the fallback states only
 * what the catalogue record says.
 *
 * Client-safe: no server imports.
 */

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sourceOf(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return value.src || value.url || value.image || value.imageUrl || "";
  return "";
}

/** The author's alt text for this exact image, or "". */
export function authoredImageAlt(product: any, src: string): string {
  if (!product || !src) return "";
  const images = Array.isArray(product.images) ? product.images.map(sourceOf) : [];
  const texts = Array.isArray(product.imageAltText) ? product.imageAltText : [];
  const index = images.indexOf(src);
  return index >= 0 ? clean(texts[index]).slice(0, 250) : "";
}

/**
 * Alt text for one of a product's images.
 * `position` / `total` (1-based) distinguish the views of a multi-image gallery.
 */
export function productImageAlt(product: any, src: string, position = 1, total = 1): string {
  const authored = authoredImageAlt(product, src);
  if (authored) return authored;
  const title = clean(product?.title) || "Husnalogy design";
  return total > 1 && position > 1 ? `${title}, view ${position} of ${total}` : title;
}
