import { getCollectionOptions, getCollectionProducts } from "@/lib/collections";
import { getFilterOptions } from "@/lib/products";
import ProductListingPage from "../products/ProductListingPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Gifts",
  description: "Browse Husnalogy gifts with page specific filters.",
};

export default async function GiftsPage({ searchParams }) {
  const params = await searchParams;
  const scopeProducts = await getCollectionOptions("gifts");
  const products = await getCollectionProducts("gifts", params || {});

  return (
    <ProductListingPage
      title="Gifts"
      eyebrow="Personalized gifting"
      description="Browse only gift products. The filter options change automatically based on the gifts currently available in the store."
      products={products}
      options={getFilterOptions(scopeProducts)}
      params={params || {}}
      clearHref="/gifts"
      basePath="/gifts"
      emptyTitle="No gift products found."
      emptyDescription="Add an active gift product in the admin dashboard and it will appear here automatically."
      filterTitle="Filter gifts"
      searchPlaceholder="Search personalized gifts..."
    />
  );
}
