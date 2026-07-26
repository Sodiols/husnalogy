import {
  getCollectionDefinition,
  getCollectionOptions,
  getCollectionProducts,
  getCollectionSuite,
} from "@/lib/collections";
import { getFilterOptions } from "@/lib/products";
import ProductListingPage from "../../products/ProductListingPage";
import { getMainMockupImage } from "../../products/product-image";
import Link from "next/link";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const suite = await getCollectionSuite(slug);
  const collection = suite || getCollectionDefinition(slug);

  return {
    title: collection.title,
    description: collection.description,
  };
}

export default async function CollectionPage({ params, searchParams }) {
  const { slug } = await params;
  const queryParams = await searchParams;
  const suite = await getCollectionSuite(slug);
  const collection = suite || getCollectionDefinition(slug);
  const products = suite?.products || await getCollectionProducts(slug, queryParams || {});
  const collectionProductsForOptions = suite?.products || await getCollectionOptions(slug);

  if (suite?.subCollections?.length) {
    return <CollectionSuitePage collection={suite} subCollections={suite.subCollections} />;
  }

  return (
    <ProductListingPage
      title={collection.title}
      eyebrow={collection.eyebrow || "Husnalogy collection"}
      description={collection.description}
      products={products}
      options={getFilterOptions(collectionProductsForOptions)}
      params={queryParams || {}}
      clearHref={`/collections/${slug}`}
      basePath={`/collections/${slug}`}
      emptyTitle="No matching products are live yet."
      emptyDescription="This page is already connected. When you add an active product with matching title, category, collection, theme, or tags, it will appear here automatically."
      filterTitle={`Filter ${collection.title}`}
      searchPlaceholder={`Search ${collection.title.toLowerCase()}...`}
    />
  );
}

function CollectionSuitePage({ collection, subCollections = [] }) {
  const visibleChildren = subCollections.filter((item) => item.products.length > 0);
  const totalChildren = visibleChildren.length;

  return (
    <main className="bg-white text-[#303839]">
      <section className="mx-auto max-w-[1480px] px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-8 max-w-3xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#303839]">Wedding suite</p>
          <h1 className="mt-3 font-display text-[2.2rem] font-semibold leading-tight text-[#303839] sm:text-[3rem]">
            {collection.name}
          </h1>
          {collection.description && (
            <p className="mt-4 text-sm leading-7 text-[#303839]/65">{collection.description}</p>
          )}
        </header>

        <div className="grid gap-x-5 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {visibleChildren.map((child) => (
            <SubCollectionCard key={child.id} collection={child} />
          ))}
        </div>

        {!visibleChildren.length && (
          <div className="border border-[#303839]/12 bg-[#f8f6f1] p-6 text-sm text-[#303839]/65">
            No sub-collections in this suite have active products yet.
          </div>
        )}

        <p className="mt-16 text-center text-sm text-[#303839]/70">
          Showing {totalChildren} of {totalChildren} sub-collections
        </p>
      </section>
    </main>
  );
}

function SubCollectionCard({ collection }) {
  const productCount = collection.products.length;
  const image = getMainMockupImage(collection.products[0]);

  return (
    <Link href={`/collections/${collection.slug}`} className="group block min-w-0">
      <div className="aspect-square overflow-hidden rounded-[18px] bg-[#f8f6f1]">
        <img
          src={image}
          alt={collection.name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
        />
      </div>
      <h2 className="mt-2 line-clamp-1 text-[0.95rem] font-extrabold leading-5 text-[#303839]">
        {collection.name}
      </h2>
      {productCount > 0 && (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-[#303839]">
          <span className="relative inline-block h-3.5 w-3.5">
            <span className="absolute left-0 top-1 h-2.5 w-2.5 border border-[#303839]" />
            <span className="absolute left-1 top-0 h-2.5 w-2.5 border border-[#303839] bg-white/40" />
          </span>
          {productCount} style{productCount === 1 ? "" : "s"}
        </p>
      )}
    </Link>
  );
}
