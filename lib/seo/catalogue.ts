/**
 * Search and sharing metadata for catalogue pages: products and collections.
 *
 * Built only from the published catalogue record. Callers pass products that
 * the storefront already resolved for public display (getProductBySlug /
 * getActiveProducts), so drafts, hidden and deleted products never reach here.
 * No customization, customer or order data is ever read.
 */

import type { Metadata } from "next";
import { publicPageMetadata, toMetaDescription } from "./metadata";
import { productImageAlt } from "./image-alt";
import { productShareImageUrls, type ShareImage } from "./share-image";

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Listed in the shop and eligible for search: active AND public. */
export function isIndexableProduct(product: any): boolean {
  return product?.status === "active" && (product?.visibility || "public") === "public";
}

export function productShareImage(product: any): ShareImage | null {
  const [url] = productShareImageUrls(product);
  if (!url) return null;
  const images = Array.isArray(product?.images) ? product.images : [];
  // Author alt text is matched by the original source, not the absolute URL.
  const source = images.find((image: any) => productShareImageUrls({ images: [image] })[0] === url) || url;
  return { url, alt: productImageAlt(product, typeof source === "string" ? source : url) };
}

export function productMetaDescription(product: any): string {
  const authored = clean(product?.seoDescription) || clean(product?.shortDescription) || clean(product?.description);
  if (authored) return toMetaDescription(authored);
  const title = clean(product?.title) || "This design";
  const category = clean(product?.category);
  return toMetaDescription(category ? `${title} from Husnalogy, in ${category}.` : `${title} from Husnalogy.`);
}

export function productMetadata(product: any): Metadata {
  const title = clean(product?.seoTitle) || clean(product?.title) || "Husnalogy design";
  return publicPageMetadata({
    title,
    description: productMetaDescription(product),
    path: `/products/${encodeURIComponent(product.slug)}`,
    image: productShareImage(product),
    // "direct" products are shared by link only: reachable, never a search result.
    noindex: !isIndexableProduct(product),
  });
}

type CollectionLike = {
  slug: string;
  title: string;
  description?: string;
  products?: any[];
};

export function collectionMetaDescription(collection: CollectionLike): string {
  const authored = clean(collection.description);
  // Built-in catalogue filters carry internal-sounding blurbs ("…available in
  // the store"); a plain sentence reads better as a search snippet.
  if (authored && !/\b(store|catalog|catalogue)\b/i.test(authored)) return toMetaDescription(authored);
  const name = clean(collection.title);
  return toMetaDescription(`Browse ${name.toLowerCase()} from Husnalogy, with refined designs made for meaningful moments.`);
}

export function collectionMetadata(
  collection: CollectionLike,
  { indexable, canonicalPath }: { indexable: boolean; canonicalPath?: string },
): Metadata {
  const firstWithImage = (collection.products || []).find((product) => productShareImage(product));
  return publicPageMetadata({
    title: clean(collection.title),
    description: collectionMetaDescription(collection),
    path: canonicalPath || `/collections/${encodeURIComponent(collection.slug)}`,
    image: firstWithImage ? productShareImage(firstWithImage) : null,
    noindex: !indexable,
  });
}
