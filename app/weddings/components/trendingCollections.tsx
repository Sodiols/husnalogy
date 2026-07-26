"use client";

import Link from "next/link";
import { useRef } from "react";
import Reveal from "../../components/reveal";
import { getMainMockupImage } from "../../products/product-image";

const FALLBACK_IMAGES = [
  "/images/weddings/invitations/collection1.png",
  "/images/weddings/invitations/collection2.png",
  "/images/weddings/invitations/collection3.png",
  "/images/weddings.png",
];

function itemCountLabel(count) {
  return `${count} item${count === 1 ? "" : "s"}`;
}

function getImages(collection) {
  const subCollectionImages = (collection.subCollections || [])
    .map((child) => getMainMockupImage(child.products?.[0]))
    .filter(Boolean);
  const productImages = (collection.products || [])
    .map((product) => getMainMockupImage(product))
    .filter(Boolean);
  const images = subCollectionImages.length ? subCollectionImages : productImages;
  const source = images.length ? images : FALLBACK_IMAGES;

  return Array.from({ length: 4 }, (_, index) => source[index] || source[0] || FALLBACK_IMAGES[index]);
}

function CollectionCard({ collection }) {
  const images = getImages(collection);
  const products = collection.products || [];

  return (
    <Link
      href={`/collections/${collection.slug}`}
      className="group w-[86%] shrink-0 sm:w-[48%] lg:w-[39rem]"
    >
      <div className="relative grid aspect-[1.55] grid-cols-[minmax(0,1fr)_82px] gap-1.5 overflow-hidden bg-[#f8f6f1] sm:aspect-[1.62] sm:grid-cols-[minmax(0,1fr)_96px]">
        <div className="min-w-0 overflow-hidden">
          <img
            src={images[0]}
            alt={collection.name}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
          />
        </div>

        <div className="grid min-w-0 grid-rows-3 gap-1.5">
          {images.slice(1, 4).map((image, index) => (
            <div key={`${image}-${index}`} className="overflow-hidden bg-white">
              <img
                src={image}
                alt=""
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]"
              />
            </div>
          ))}
        </div>

        <span className="absolute bottom-2 right-2 rounded-md bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#303839] shadow-[0_8px_22px_rgba(0,0,0,0.18)] backdrop-blur">
          {itemCountLabel(products.length)}
        </span>
      </div>

      <h3 className="mt-3 line-clamp-1 text-[1rem] font-semibold leading-tight text-[#303839] transition-colors duration-300 group-hover:text-[#303839] sm:text-[1.05rem]">
        {collection.name}
      </h3>
    </Link>
  );
}

export default function TrendingCollections({ collections = [] }) {
  const sliderRef = useRef(null);
  const visibleCollections = collections.slice(0, 10);

  const scrollByAmount = (direction) => {
    if (!sliderRef.current) return;
    sliderRef.current.scrollBy({
      left: direction * sliderRef.current.clientWidth * 0.85,
      behavior: "smooth",
    });
  };

  return (
    <section className="overflow-hidden bg-white">
      <div className="mx-auto max-w-[1480px] px-4 py-14 sm:px-6 sm:py-16 lg:px-12 xl:px-16">
        <Reveal className="mb-6">
          <h2 className="font-display text-[2rem] font-medium leading-tight text-[#303839] sm:text-[2.5rem]">
            Trending Wedding Collections
          </h2>
        </Reveal>

        {!visibleCollections.length ? (
          <Reveal className="border border-[#303839]/12 bg-[#f8f6f1] p-7 text-sm leading-6 text-[#303839]/70">
            No wedding collections are marked as trending yet. Check a collection as trending in the admin panel to show it here.
          </Reveal>
        ) : (
          <Reveal className="relative" y={28}>
            {visibleCollections.length > 2 && (
              <>
                <button
                  type="button"
                  onClick={() => scrollByAmount(-1)}
                  aria-label="Scroll left"
                  data-shape="round"
                  className="absolute left-0 top-[38%] z-20 grid h-11 w-11 -translate-x-1/2 place-items-center rounded-full border border-[#303839]/10 bg-white text-[#303839] shadow-[0_14px_36px_rgba(0,0,0,0.15)] transition duration-300 hover:bg-[#303839] hover:text-white"
                >
                  <Chevron direction="left" />
                </button>

                <button
                  type="button"
                  onClick={() => scrollByAmount(1)}
                  aria-label="Scroll right"
                  data-shape="round"
                  className="absolute right-0 top-[38%] z-20 grid h-11 w-11 translate-x-1/2 place-items-center rounded-full border border-[#303839]/10 bg-white text-[#303839] shadow-[0_14px_36px_rgba(0,0,0,0.15)] transition duration-300 hover:bg-[#303839] hover:text-white"
                >
                  <Chevron direction="right" />
                </button>
              </>
            )}

            <div
              ref={sliderRef}
              className="flex gap-4 overflow-x-auto scroll-smooth pb-4 sm:gap-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {visibleCollections.map((collection) => (
                <CollectionCard key={collection.id || collection.slug} collection={collection} />
              ))}
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

function Chevron({ direction }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "left" ? <path d="m15 6-6 6 6 6" /> : <path d="m9 6 6 6-6 6" />}
    </svg>
  );
}
