import { getActiveProducts, getFilterOptions } from "@/lib/products";
import ProductListingPage from "./ProductListingPage";
import { staticPageMetadata } from "@/lib/seo/pages";

export const dynamic = "force-dynamic";

export const metadata = staticPageMetadata("/products");

export default async function ProductsPage({ searchParams }) {
  const params = await searchParams;
  const allProducts = await getActiveProducts();
  const products = await getActiveProducts({
    query: params?.q || "",
    category: params?.category || "",
    collectionId: params?.collectionId || "",
    productType: params?.productType || "",
    occasion: params?.occasion || "",
    style: params?.style || "",
    collection: params?.collection || "",
    featured: params?.featured || "",
    bestSeller: params?.bestSeller || "",
    newest: params?.newest || "",
    minPrice: params?.minPrice || "",
    maxPrice: params?.maxPrice || "",
    sort: params?.sort || "",
  });

  return (
    <ProductListingPage
      title="Shop all"
      eyebrow="Husnalogy"
      description="Wedding invitations, save the dates, cards, gifts and stationery. Every design can be personalized before you order."
      products={products}
      options={getFilterOptions(allProducts)}
      params={params || {}}
      basePath="/products"
      emptyTitle="New designs are coming soon"
      emptyDescription="Browse our collections or contact us about a design for your occasion."
    />
  );
}
