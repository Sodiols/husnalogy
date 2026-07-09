import { getActiveProducts, getFilterOptions } from "@/lib/products";
import ProductListingPage from "./ProductListingPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shop All Products",
  description:
    "Browse all Husnalogy products — wedding invitations, save the dates, cards, personalized gifts and stationery. Filter by theme, occasion, format, colour and price.",
  alternates: { canonical: "/products" },
};

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
      title="Wedding Invitations"
      description="Timeless designs for your forever day."
      products={products}
      options={getFilterOptions(allProducts)}
      params={params || {}}
      basePath="/products"
      emptyTitle="No active products found."
      emptyDescription="Try clearing the filters or add active products in the admin dashboard."
    />
  );
}
