import type { MetadataRoute } from "next";
import { getActiveProducts } from "@/lib/products";
import { getPublicCollectionEntries, LANDING_PAGE_COLLECTIONS } from "@/lib/collections";
import { buildSitemapEntries } from "@/lib/seo/sitemap";
import { getSiteUrl } from "@/lib/site-url";

// Read the live catalogue on every request: a product that is published,
// unpublished or deleted is reflected immediately, and a catalogue read
// failure returns an error (crawlers retry) instead of a silently shorter
// sitemap that would look like mass removals.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, collections] = await Promise.all([getActiveProducts(), getPublicCollectionEntries()]);
  return buildSitemapEntries({
    siteUrl: getSiteUrl(),
    products,
    // A built-in twin of a landing page (/collections/gifts -> /gifts) is not a separate URL.
    collections: collections.filter((entry) => !(entry.source === "builtin" && entry.slug in LANDING_PAGE_COLLECTIONS)),
  });
}
