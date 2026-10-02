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
import ExploreMoreTile from "@/app/components/explore-more-tile";

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
      emptyTitle="New designs are coming soon"
      emptyDescription="This collection is being prepared. Browse our other collections or contact us about a design for your occasion."
      filterTitle={`Filter ${collection.title}`}
      searchPlaceholder={`Search ${collection.title.toLowerCase()}...`}
    />
  );
}

function CollectionSuitePage({ collection, subCollections = [] }) {
  const visibleChildren = subCollections.filter((item) => item.products.length > 0);
  const totalChildren = visibleChildren.length;

  return (
    <main className="bg-white text-ink">
      <section className="page-container pb-16 pt-8 sm:pt-10 lg:pb-20 lg:pt-12">
        <header className="max-w-[720px]">
          <p className="eyebrow">Wedding suite</p>
          <h1 className="heading-page mt-3 capitalize">{collection.name}</h1>
          {collection.description && <p className="text-lead mt-4 max-w-[640px]">{collection.description}</p>}
        </header>

        <p className="mt-8 border-y border-line py-3 text-[14px] text-muted">
          <span className="font-semibold text-ink">{totalChildren}</span> {totalChildren === 1 ? "design" : "designs"} in this suite
        </p>

        <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
          {visibleChildren.map((child) => (
            <li key={child.id} className="min-w-0">
              <SubCollectionCard collection={child} />
            </li>
          ))}
          {totalChildren > 0 && totalChildren < 4 && (
            <li className="col-span-2 min-w-0 sm:col-span-1">
              <ExploreMoreTile />
            </li>
          )}
        </ul>

        {!visibleChildren.length && (
          <div className="mt-8 rounded-[10px] bg-cream px-6 py-10 text-center" role="status">
            <h2 className="font-display text-[1.75rem] font-medium text-ink">This suite is being prepared</h2>
            <p className="mx-auto mt-3 max-w-[480px] text-[15px] leading-7 text-muted">Browse our other collections in the meantime.</p>
            <Link href="/collections" className="btn btn-primary mt-6">Browse all collections</Link>
          </div>
        )}
      </section>
    </main>
  );
}

function SubCollectionCard({ collection }) {
  const productCount = collection.products.length;
  const image = getMainMockupImage(collection.products[0]);

  return (
    <Link href={`/collections/${collection.slug}`} className="group block min-w-0">
      <span className="block aspect-square overflow-hidden rounded-[10px] bg-cream">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" className="h-full w-full object-cover" />
      </span>
      <h2 className="heading-card mt-3 line-clamp-2 capitalize group-hover:underline group-hover:underline-offset-4">
        {collection.name}
      </h2>
      {productCount > 0 && (
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
          <span aria-hidden="true" className="relative inline-block h-3.5 w-3.5">
            <span className="absolute left-0 top-1 h-2.5 w-2.5 border border-ink/60" />
            <span className="absolute left-1 top-0 h-2.5 w-2.5 border border-ink/60 bg-white/40" />
          </span>
          {productCount} style{productCount === 1 ? "" : "s"}
        </p>
      )}
    </Link>
  );
}
