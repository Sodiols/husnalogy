import { getCollectionOptions, getCollectionProducts } from "@/lib/collections";
import { getFilterOptions } from "@/lib/products";
import ProductListingPage from "../products/ProductListingPage";
import { staticPageMetadata } from "@/lib/seo/pages";

export const dynamic = "force-dynamic";

export const metadata = staticPageMetadata("/cards");

export default async function CardsPage({ searchParams }) {
  const params = await searchParams;
  const scopeProducts = await getCollectionOptions("cards");
  const products = await getCollectionProducts("cards", params || {});

  return (
    <ProductListingPage
      title="Cards"
      eyebrow="Cards"
      description="Thank you cards, greeting cards and notes, personalized with your own words."
      products={products}
      options={getFilterOptions(scopeProducts)}
      params={params || {}}
      clearHref="/cards"
      basePath="/cards"
      emptyTitle="New cards are coming soon"
      emptyDescription="Browse our other collections or contact us about a card for your occasion."
      filterTitle="Filter cards"
      searchPlaceholder="Search cards, announcements..."
    />
  );
}
