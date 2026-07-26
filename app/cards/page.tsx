import { getCollectionOptions, getCollectionProducts } from "@/lib/collections";
import { getFilterOptions } from "@/lib/products";
import ProductListingPage from "../products/ProductListingPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cards",
  description: "Browse Husnalogy cards with page specific filters.",
};

export default async function CardsPage({ searchParams }) {
  const params = await searchParams;
  const scopeProducts = await getCollectionOptions("cards");
  const products = await getCollectionProducts("cards", params || {});

  return (
    <ProductListingPage
      title="Cards"
      eyebrow="Shop cards"
      description="Browse only card products. The filters stay visually consistent, but the options come only from matching card products."
      products={products}
      options={getFilterOptions(scopeProducts)}
      params={params || {}}
      clearHref="/cards"
      basePath="/cards"
      emptyTitle="No card products found."
      emptyDescription="Add an active card product in the admin dashboard and it will appear here automatically."
      filterTitle="Filter cards"
      searchPlaceholder="Search cards, announcements..."
    />
  );
}
