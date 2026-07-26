import { getCollectionOptions, getCollectionProducts } from "@/lib/collections";
import { getFilterOptions } from "@/lib/products";
import ProductListingPage from "../products/ProductListingPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Stationery",
  description: "Browse Husnalogy stationery with page specific filters.",
};

export default async function StationeryPage({ searchParams }) {
  const params = await searchParams;
  const scopeProducts = await getCollectionOptions("stationery");
  const products = await getCollectionProducts("stationery", params || {});

  return (
    <ProductListingPage
      title="Stationery"
      eyebrow="Paper details"
      description="Browse only stationery products. The filter choices are based on stationery products only."
      products={products}
      options={getFilterOptions(scopeProducts)}
      params={params || {}}
      clearHref="/stationery"
      basePath="/stationery"
      emptyTitle="No stationery products found."
      emptyDescription="Add an active stationery product in the admin dashboard and it will appear here automatically."
      filterTitle="Filter stationery"
      searchPlaceholder="Search menus, programs, labels..."
    />
  );
}
