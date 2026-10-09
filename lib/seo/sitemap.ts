/**
 * The sitemap's URL list, as a pure function of the published catalogue.
 *
 * Included: registered public pages (lib/seo/pages), collections with at
 * least one public product, and every active + public product. Excluded by
 * construction: drafts, hidden, deleted and direct-link products, empty or
 * unknown collections, and every private, account, studio, auth, API and
 * thank-you route (none of them is in the registry).
 *
 * `lastModified` is only ever a stored timestamp: a product's `updated_at`, a
 * collection's newest member, the newest product for catalogue listings.
 * Pages without a meaningful date carry none, rather than "now" on every
 * request. No changefreq / priority: search engines ignore them, and invented
 * values would be misleading.
 */

import type { MetadataRoute } from "next";
import { isIndexableProduct } from "./catalogue";
import { PUBLIC_PAGES } from "./pages";
import { productShareImageUrls } from "./share-image";

/** The sitemaps.org per-file limit. Split with generateSitemaps() before reaching it. */
export const SITEMAP_URL_LIMIT = 50_000;

type CollectionEntry = { slug: string; updatedAt?: string; products: any[] };

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function newest(dates: Array<Date | null>): Date | undefined {
  let latest: Date | undefined;
  for (const date of dates) if (date && (!latest || date > latest)) latest = date;
  return latest;
}

export function absoluteUrl(siteUrl: string, path: string): string {
  return path === "/" ? siteUrl : `${siteUrl}${path}`;
}

export function buildSitemapEntries({
  siteUrl,
  supabaseUrl,
  products,
  collections,
}: {
  siteUrl: string;
  supabaseUrl?: string;
  products: any[];
  collections: CollectionEntry[];
}): MetadataRoute.Sitemap {
  const publicProducts = products.filter((product) => isIndexableProduct(product) && String(product.slug || "").trim());
  const publicSlugs = new Set(publicProducts.map((product) => product.slug));
  const catalogueUpdated = newest(publicProducts.map((product) => toDate(product.updatedAt)));
  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];
  const push = (entry: MetadataRoute.Sitemap[number]) => {
    if (seen.has(entry.url)) return;
    seen.add(entry.url);
    entries.push(entry);
  };

  for (const page of PUBLIC_PAGES) {
    const isCatalogue = "catalogue" in page && page.catalogue;
    push({
      url: absoluteUrl(siteUrl, page.path),
      ...(isCatalogue && catalogueUpdated ? { lastModified: catalogueUpdated } : {}),
    });
  }

  for (const collection of collections) {
    const members = collection.products.filter((product) => publicSlugs.has(product.slug));
    if (!collection.slug || !members.length) continue;
    const lastModified = newest([toDate(collection.updatedAt), ...members.map((product) => toDate(product.updatedAt))]);
    push({
      url: absoluteUrl(siteUrl, `/collections/${encodeURIComponent(collection.slug)}`),
      ...(lastModified ? { lastModified } : {}),
    });
  }

  for (const product of publicProducts) {
    const lastModified = toDate(product.updatedAt);
    const [image] = productShareImageUrls(product, { siteUrl, supabaseUrl });
    push({
      url: absoluteUrl(siteUrl, `/products/${encodeURIComponent(product.slug)}`),
      ...(lastModified ? { lastModified } : {}),
      ...(image ? { images: [image] } : {}),
    });
  }

  if (entries.length > SITEMAP_URL_LIMIT) {
    // Far beyond today's catalogue. Keep the file valid and say so loudly:
    // the fix is to split products into app/products/sitemap.ts with
    // generateSitemaps() and list each file in app/robots.ts.
    console.error(`Sitemap has ${entries.length} URLs; only the first ${SITEMAP_URL_LIMIT} are published. Split it.`);
    return entries.slice(0, SITEMAP_URL_LIMIT);
  }
  return entries;
}
