import Link from "next/link";

import { getAllCollectionSuites } from "@/lib/collections";
import { getMainMockupImage } from "@/app/products/product-image";
import ExploreMoreTile from "@/app/components/explore-more-tile";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "All Collections",
  description: "Browse every active Husnalogy product collection.",
};

export default async function CollectionsPage() {
  const collections = await getAllCollectionSuites();

  return (
    <main className="bg-white text-ink">
      <section className="page-container pb-16 pt-8 sm:pt-10 lg:pb-20 lg:pt-12">
        <header className="max-w-[720px]">
          <p className="eyebrow">Husnalogy</p>
          <h1 className="heading-page mt-3">All collections</h1>
          <p className="text-lead mt-4 max-w-[640px]">
            Complete collections of matching designs, from invitations to the finishing details.
          </p>
        </header>

        <p className="mt-8 border-y border-line py-3 text-[14px] text-muted">
          <span className="font-semibold text-ink">{collections.length}</span> {collections.length === 1 ? "collection" : "collections"}
        </p>

        <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
          {collections.map((collection) => {
            const image = getMainMockupImage(collection.products[0]);
            const itemCount = collection.subCollections.length || collection.products.length;

            return (
              <li key={collection.id} className="min-w-0">
                <Link href={`/collections/${collection.slug}`} className="group block">
                  <span className="block aspect-square overflow-hidden rounded-[10px] bg-cream">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="" className="h-full w-full object-cover" />
                  </span>
                  <h2 className="heading-card mt-3 line-clamp-2 capitalize group-hover:underline group-hover:underline-offset-4">
                    {collection.name}
                  </h2>
                  <p className="mt-1 text-[13px] text-muted">
                    {itemCount} {itemCount === 1 ? "design" : "designs"}
                  </p>
                </Link>
              </li>
            );
          })}
          {collections.length > 0 && collections.length < 4 && (
            <li className="col-span-2 min-w-0 sm:col-span-1">
              <ExploreMoreTile title="More collections are on the way" text="Browse every design in the shop, or ask us about a collection for your occasion." />
            </li>
          )}
        </ul>

        {!collections.length && (
          <div className="mt-8 rounded-[10px] bg-cream px-6 py-10 text-center" role="status">
            <h2 className="font-display text-[1.75rem] font-medium text-ink">New collections are coming soon</h2>
            <p className="mx-auto mt-3 max-w-[480px] text-[15px] leading-7 text-muted">In the meantime, browse every design in the shop.</p>
            <Link href="/products" className="btn btn-primary mt-6">Shop all</Link>
          </div>
        )}
      </section>
    </main>
  );
}
