import { getCollectionOptions, getCollectionProducts } from "@/lib/collections";
import { getFilterOptions } from "@/lib/products";
import ProductListingPage from "../products/ProductListingPage";
import { staticPageMetadata } from "@/lib/seo/pages";

export const dynamic = "force-dynamic";

export const metadata = staticPageMetadata("/save-the-dates");

export default async function SaveTheDatesPage({ searchParams }) {
  const params = await searchParams;
  const scopeProducts = await getCollectionOptions("save-the-dates");
  const products = await getCollectionProducts("save-the-dates", params || {});

  return (
    <ProductListingPage
      title="Save the dates"
      eyebrow="Wedding stationery"
      description="Share your date early with a save the date personalized with your names and details."
      products={products}
      options={getFilterOptions(scopeProducts)}
      params={params || {}}
      clearHref="/save-the-dates"
      basePath="/save-the-dates"
      emptyTitle="New save the dates are coming soon"
      emptyDescription="Browse our wedding invitations or contact us about a save the date design."
      filterTitle="Filter save the dates"
      searchPlaceholder="Search save the date designs..."
    />
  );
}
