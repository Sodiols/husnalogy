import { getCollectionOptions, getCollectionProducts } from "@/lib/collections";
import { getFilterOptions } from "@/lib/products";
import ProductListingPage from "../products/ProductListingPage";
import { staticPageMetadata } from "@/lib/seo/pages";

export const dynamic = "force-dynamic";

export const metadata = staticPageMetadata("/gifts");

export default async function GiftsPage({ searchParams }) {
  const params = await searchParams;
  const scopeProducts = await getCollectionOptions("gifts");
  const products = await getCollectionProducts("gifts", params || {});

  return (
    <ProductListingPage
      title="Gifts"
      eyebrow="Personalized gifting"
      description="Personalized gifts for birthdays, weddings and the people who matter to you."
      products={products}
      options={getFilterOptions(scopeProducts)}
      params={params || {}}
      clearHref="/gifts"
      basePath="/gifts"
      emptyTitle="New gifts are coming soon"
      emptyDescription="Browse our other collections or contact us about a personalized gift."
      filterTitle="Filter gifts"
      searchPlaceholder="Search personalized gifts..."
    />
  );
}
