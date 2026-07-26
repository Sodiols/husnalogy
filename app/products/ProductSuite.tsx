"use client";

import { useState } from "react";
import Link from "next/link";

const INITIAL_VISIBLE = 8;

/**
 * ProductSuite — "Shop the <collection> suite"
 * Zazzle-style module: a grid of the suite's child collections. Each tile shows
 * the child collection's lead product image, its name, and how many styles it
 * holds. Tiles link to the child collection's products.
 *
 * Renders nothing unless the product's collection has children with products.
 */
export default function ProductSuite({
  product,
  collection,
  title = "",
  childCollections = [],
  className = "",
}) {
  const [showAll, setShowAll] = useState(false);

  if (!childCollections.length) return null;

  const heading = title || `Shop the ${collection || product?.title || "wedding"} suite`;
  const visibleCollections = showAll ? childCollections : childCollections.slice(0, INITIAL_VISIBLE);
  const hasMore = childCollections.length > INITIAL_VISIBLE;

  return (
    <section className={`min-w-0 max-w-full overflow-hidden text-[#303839] ${className}`}>
      <div className="flex min-w-0 items-center gap-4">
        <h2 className="min-w-0 font-display text-2xl leading-tight md:text-[28px]">{heading}</h2>
        <span aria-hidden="true" className="h-px flex-1 bg-[#303839]/15" />
      </div>

      <div className="mt-7 grid min-w-0 grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4">
        {visibleCollections.map((child) => (
          <Link key={child.id} href={child.href} className="group block min-w-0">
            <div className="max-w-full overflow-hidden rounded-none bg-[#f8f6f1]">
              <img
                src={child.image}
                alt={child.name}
                className="aspect-square w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
              />
            </div>

            <p className="mt-2.5 text-sm font-bold leading-snug text-[#303839] group-hover:underline group-hover:underline-offset-4">
              {child.name}
            </p>

            {child.count > 1 && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-[#303839]/65">
                <i className="fa-regular fa-clone" aria-hidden="true" />
                {child.count} styles
              </p>
            )}
          </Link>
        ))}
      </div>

      {hasMore && (
        <div className="mt-9 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="rounded-none border-2 border-[#303839]/70 px-8 py-3 text-sm font-semibold text-[#303839] transition hover:border-[#303839] hover:bg-[#303839] hover:text-white"
          >
            {showAll ? "Show Fewer Products" : "Show More Products"}
          </button>
        </div>
      )}

      <p className="mt-8 text-center text-sm text-[#303839]/60">
        Showing {visibleCollections.length} of {childCollections.length} products
      </p>
    </section>
  );
}
