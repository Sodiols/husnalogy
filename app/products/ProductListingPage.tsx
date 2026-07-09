import Link from "next/link";
import ProductBrowser from "./ProductBrowser";
import { getProductCollections } from "@/lib/collections/store";

const PRODUCTS_PER_PAGE = 20;

export default async function ProductListingPage({
  products = [],
  options = {},
  params = {},
  basePath = "/products",
  emptyTitle = "No active products found.",
  emptyDescription = "When matching active products are added in the admin dashboard, they will appear here automatically.",
}: any) {
  const collections = await getProductCollections().catch(() => []);
  const totalProducts = products.length;
  const totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCTS_PER_PAGE));
  const requestedPage = Number.parseInt(params?.page || "1", 10);
  const currentPage = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), totalPages);
  const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const paginatedProducts = products.slice(startIndex, startIndex + PRODUCTS_PER_PAGE);

  return (
    <main className="bg-white text-[#303839]">
      <section id="catalog" className="mx-auto max-w-[1480px] scroll-mt-28 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <ProductBrowser
          products={paginatedProducts}
          relatedCatalog={products}
          collections={collections}
          options={options}
          params={params || {}}
          count={totalProducts}
          basePath={basePath}
        />

        {!totalProducts && (
          <div className="mt-10 rounded-none border border-[#303839]/12 bg-white p-6">
            <p className="text-sm font-semibold text-[#303839]">{emptyTitle}</p>
            <p className="mt-2 text-sm leading-6 text-[#303839]/68">{emptyDescription}</p>
          </div>
        )}

        {totalProducts > PRODUCTS_PER_PAGE && (
          <ProductPagination
            basePath={basePath}
            params={params || {}}
            currentPage={currentPage}
            totalPages={totalPages}
          />
        )}
      </section>
    </main>
  );
}

function ProductPagination({ basePath, params = {}, currentPage, totalPages }) {
  const paginationItems = getPaginationItems(currentPage, totalPages);
  const previousPage = Math.max(currentPage - 1, 1);
  const nextPage = Math.min(currentPage + 1, totalPages);

  return (
    <nav
      className="mt-12 flex flex-wrap items-center justify-center gap-2 border-t border-[#303839]/10 pt-8"
      aria-label="Product pagination"
    >
      {currentPage > 1 && (
        <Link
          href={buildPageHref(basePath, params, previousPage)}
          className="rounded-none border border-[#303839]/15 bg-white px-5 py-3 text-sm font-bold text-[#303839] transition hover:border-[#303839]"
        >
          Previous
        </Link>
      )}

      {paginationItems.map((item, index) => {
        if (item === "ellipsis") {
          return (
            <span
              key={`ellipsis-${index}`}
              className="grid h-11 min-w-11 place-items-center rounded-full px-3 text-sm font-bold text-[#303839]/45"
            >
              ...
            </span>
          );
        }

        const isActive = item === currentPage;

        return (
          <Link
            key={item}
            href={buildPageHref(basePath, params, item)}
            aria-current={isActive ? "page" : undefined}
            className={[
              "grid h-11 min-w-11 place-items-center rounded-none px-4 text-sm font-bold transition",
              isActive
                ? "bg-[#303839] text-white"
                : "border border-[#303839]/15 bg-white text-[#303839] hover:border-[#303839]",
            ].join(" ")}
          >
            {item}
          </Link>
        );
      })}

      {currentPage < totalPages && (
        <Link
          href={buildPageHref(basePath, params, nextPage)}
          className="rounded-none bg-[#303839] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#303839]"
        >
          Next
        </Link>
      )}
    </nav>
  );
}

function buildPageHref(basePath, params = {}, page) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (key === "page") return;
    if (value === undefined || value === null || value === "") return;

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== "") {
          search.append(key, String(item));
        }
      });
      return;
    }

    search.set(key, String(value));
  });

  if (page > 1) {
    search.set("page", String(page));
  }

  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function getPaginationItems(currentPage, totalPages) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, "ellipsis", totalPages];
  }

  if (currentPage >= totalPages - 2) {
    return [1, "ellipsis", totalPages - 2, totalPages - 1, totalPages];
  }

  return [
    1,
    "ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis",
    totalPages,
  ];
}
