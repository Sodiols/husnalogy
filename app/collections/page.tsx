import Link from "next/link";

import { getAllCollectionSuites } from "@/lib/collections";
import { getMainMockupImage } from "@/app/products/product-image";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "All Collections",
  description: "Browse every active Husnalogy product collection.",
};

export default async function CollectionsPage() {
  const collections = await getAllCollectionSuites();

  return (
    <main className="bg-white text-[#303839]">
      <section className="mx-auto max-w-[1480px] px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <header className="max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#303839]/55">Husnalogy</p>
          <h1 className="mt-3 font-body text-[2rem] font-medium leading-tight text-[#303839] sm:text-[2.5rem] lg:text-[2.75rem]">
            All collections
          </h1>
          <p className="mt-4 text-sm leading-7 text-[#303839]/65">
            Explore complete collections and the individual designs inside each one.
          </p>
        </header>

        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4">
          {collections.map((collection) => {
            const image = getMainMockupImage(collection.products[0]);
            const itemCount = collection.subCollections.length || collection.products.length;

            return (
              <Link key={collection.id} href={`/collections/${collection.slug}`} className="group block min-w-0">
                <div className="aspect-square overflow-hidden rounded-[10px] bg-[#F8F6F1]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image}
                    alt={collection.name}
                    className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]"
                  />
                </div>
                <h2 className="mt-3 line-clamp-1 text-sm font-semibold text-[#303839] sm:text-[0.95rem]">
                  {collection.name}
                </h2>
                <p className="mt-1 text-xs text-[#303839]/60">
                  {itemCount} {itemCount === 1 ? "item" : "items"}
                </p>
              </Link>
            );
          })}
        </div>

        {!collections.length && (
          <p className="mt-10 border border-[#303839]/12 bg-[#F8F6F1] p-6 text-sm text-[#303839]/65">
            No active collections are available yet.
          </p>
        )}
      </section>
    </main>
  );
}
