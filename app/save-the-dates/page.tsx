import { getCollectionOptions, getCollectionProducts } from "@/lib/collections";
import { getFilterOptions } from "@/lib/products";
import ProductListingPage from "../products/ProductListingPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Save The Dates",
  description: "Browse save the date designs from Husnalogy with page specific filters.",
};

export default async function SaveTheDatesPage({ searchParams }) {
  const params = await searchParams;
  const scopeProducts = await getCollectionOptions("save-the-dates");
  const products = await getCollectionProducts("save-the-dates", params || {});

  return (
    <ProductListingPage
      title="Save The Dates"
      eyebrow="Wedding stationery"
      description="Browse only save the date products. The filters below are built from save the date products only."
      products={products}
      options={getFilterOptions(scopeProducts)}
      params={params || {}}
      clearHref="/save-the-dates"
      basePath="/save-the-dates"
      emptyTitle="No save the date products found."
      emptyDescription="Add an active save the date product in the admin dashboard and it will appear here automatically."
      filterTitle="Filter save the dates"
      searchPlaceholder="Search save the date designs..."
    />
  );
}
