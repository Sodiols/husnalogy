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
      title={query ? `Results for “${query}”` : "Search"}
      eyebrow="Search"
      description={
        query
          ? "Refine the results with filters, or try a different search above."
          : "Use the search bar above to find invitations, cards, gifts and stationery."
      }
      products={products}
      options={getFilterOptions(searchScopeProducts)}
      params={params || {}}
      clearHref="/search"
      basePath="/search"
      emptyTitle={query ? `No results for “${query}”` : "Start a search"}
      emptyDescription={
        query
          ? "Check the spelling, try a shorter phrase such as “wedding” or “gift”, or browse our collections."
          : "Search for an occasion, product or style, or browse our collections."
      }
      filterTitle="Filter search results"
      searchPlaceholder="Search invitation, card, gift..."
    />
  );
}
