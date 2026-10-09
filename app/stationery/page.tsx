import { getCollectionOptions, getCollectionProducts } from "@/lib/collections";
import { getFilterOptions } from "@/lib/products";
import ProductListingPage from "../products/ProductListingPage";
import { staticPageMetadata } from "@/lib/seo/pages";

export const dynamic = "force-dynamic";

export const metadata = staticPageMetadata("/stationery");

export default async function StationeryPage({ searchParams }) {
  const params = await searchParams;
  const scopeProducts = await getCollectionOptions("stationery");
  const products = await getCollectionProducts("stationery", params || {});

  return (
    <ProductListingPage
      title="Stationery"
      eyebrow="Paper details"
      description="Menus, place cards, notes and finishing details, designed to match your occasion."
      products={products}
      options={getFilterOptions(scopeProducts)}
      params={params || {}}
      clearHref="/stationery"
      basePath="/stationery"
      emptyTitle="New stationery is coming soon"
      emptyDescription="Browse our other collections or contact us about stationery for your occasion."
      filterTitle="Filter stationery"
      searchPlaceholder="Search menus, programs, labels..."
    />
  );
}
