import Link from "next/link";
import ProductBrowser from "./ProductBrowser";
import { getProductCollections } from "@/lib/collections/store";

const PRODUCTS_PER_PAGE = 20;

const FILTER_PARAM_KEYS = [
  "style",
  "occasion",
  "productType",
  "color",
  "minPrice",
  "maxPrice",
  "featured",
  "newest",
  "bestSeller",
  "category",
  "collection",
];

export default async function ProductListingPage({
  title = "Shop all",
  eyebrow = "",
  description = "",
  products = [],
  options = {},
  params = {},
  basePath = "/products",
  clearHref = "",
  emptyTitle = "Nothing here yet",
  emptyDescription = "New designs are added regularly. Browse all collections or contact us about a custom design.",
}: any) {
  const collections = await getProductCollections().catch(() => []);
  const totalProducts = products.length;
  const totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCTS_PER_PAGE));
  const requestedPage = Number.parseInt(params?.page || "1", 10);
  const currentPage = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), totalPages);
  const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const paginatedProducts = products.slice(startIndex, startIndex + PRODUCTS_PER_PAGE);
  const hasActiveFilters = FILTER_PARAM_KEYS.some((key) => params?.[key]);
  const resetHref = clearHref || basePath;

  return (
    <main className="bg-white text-ink">
      <section id="catalog" className="page-container scroll-mt-28 pb-16 pt-8 sm:pt-10 lg:pb-20 lg:pt-12">
        <header className="max-w-[720px]">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className={`heading-page ${eyebrow ? "mt-3" : ""}`}>{title}</h1>
          {description && <p className="text-lead mt-4 max-w-[640px]">{description}</p>}
        </header>

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
          <div className="mt-8 rounded-[10px] bg-cream px-6 py-10 text-center sm:px-10 sm:py-14" role="status">
            <h2 className="font-display text-[1.75rem] font-medium leading-tight text-ink">
              {hasActiveFilters ? "No designs match these filters" : emptyTitle}
            </h2>
            <p className="mx-auto mt-3 max-w-[480px] text-[15px] leading-7 text-muted">
              {hasActiveFilters ? "Try removing a filter or two to see more designs." : emptyDescription}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {hasActiveFilters ? (
                <Link href={resetHref} className="btn btn-primary">
                  Clear filters
                </Link>
              ) : (
                <Link href="/collections" className="btn btn-primary">
                  Browse all collections
                </Link>
              )}
              <Link href="/contact" className="btn btn-secondary">
                Contact us
              </Link>
            </div>
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
      className="mt-12 flex flex-wrap items-center justify-center gap-2 border-t border-line pt-8"
      aria-label="Product pagination"
    >
      {currentPage > 1 && (
        <Link
          href={buildPageHref(basePath, params, previousPage)}
          className="btn btn-secondary btn-sm"
        >
          Previous
        </Link>
      )}

      {paginationItems.map((item, index) => {
        if (item === "ellipsis") {
          return (
            <span
              key={`ellipsis-${index}`}
              className="grid h-11 min-w-11 place-items-center px-3 text-sm font-semibold text-muted"
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
              "grid h-11 min-w-11 place-items-center rounded-[6px] px-4 text-sm font-semibold transition-colors",
              isActive
                ? "bg-ink text-white"
                : "border border-field bg-white text-ink hover:border-ink/50",
            ].join(" ")}
          >
            {item}
          </Link>
        );
      })}

      {currentPage < totalPages && (
        <Link
          href={buildPageHref(basePath, params, nextPage)}
          className="btn btn-primary btn-sm"
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
