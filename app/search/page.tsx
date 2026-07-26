import { getActiveProducts, getFilterOptions } from "@/lib/products";
import ProductListingPage from "../products/ProductListingPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Search",
  description: "Search Husnalogy wedding cards, invitations, gifts and stationery designs.",
};

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  const query = params?.q || "";

  const searchScopeProducts = query
    ? await getActiveProducts({ query })
    : await getActiveProducts();

  const products = await getActiveProducts({
    query,
    category: params?.category || "",
    productType: params?.productType || "",
    occasion: params?.occasion || "",
    style: params?.style || "",
    collection: params?.collection || "",
    featured: params?.featured || "",
    bestSeller: params?.bestSeller || "",
    minPrice: params?.minPrice || "",
    maxPrice: params?.maxPrice || "",
    sort: params?.sort || "",
  });

  return (
    <ProductListingPage
      title={query ? `Search results for “${query}”` : "Search Husnalogy"}
      eyebrow="Search products"
      description={
        query
          ? "Filter these search results by category, product type, occasion, style, collection, price, and product status."
          : "Search across Husnalogy products, then refine the results using the left side filter panel."
      }
      products={products}
      options={getFilterOptions(searchScopeProducts)}
      params={params || {}}
      clearHref="/search"
      basePath="/search"
      emptyTitle="No matching products were found."
      emptyDescription="Try a simpler search term, check the spelling, or clear the filters."
      filterTitle="Filter search results"
      searchPlaceholder="Search invitation, card, gift..."
    />
  );
}
