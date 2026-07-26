"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeToRecentlyViewed } from "../lib/customer-lists";
import { getMainMockupImage, pinMockupImage } from "./product-image";

function CarouselButton({ children, onClick, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      data-shape="round"
      className="grid h-9 w-9 place-items-center rounded-full bg-white text-[22px] text-[#303839] ring-1 ring-[#303839]/10 transition hover:bg-[#E6E6E6] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]/20"
    >
      {children}
    </button>
  );
}

export default function RecentlyViewedCarousel({ currentSlug, catalog = [] }) {
  const [items, setItems] = useState([]);
  const railRef = useRef(null);

  const catalogBySlug = useMemo(() => {
    const map = new Map();

    (catalog || []).forEach((product) => {
      if (product?.slug) {
        map.set(product.slug, product);
      }
    });

    return map;
  }, [catalog]);

  useEffect(() => {
    let mounted = true;
    let frameId = null;

    const updateRecentlyViewed = (products = []) => {
      if (!mounted) return;

      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        if (!mounted) return;

        const hasCatalog = catalogBySlug.size > 0;
        const seen = new Set();

        const recentlyViewedProducts = Array.isArray(products)
          ? products
              .filter((item) => {
                if (!item?.slug || item.slug === currentSlug) return false;
                if (seen.has(item.slug)) return false;
                if (hasCatalog && !catalogBySlug.has(item.slug)) return false;

                seen.add(item.slug);
                return true;
              })
              .map((item) => {
                const live = catalogBySlug.get(item.slug);
                return pinMockupImage(live ? { ...item, ...live } : item);
              })
              .slice(0, 12)
          : [];

        setItems(recentlyViewedProducts);
      });
    };

    const unsubscribe = subscribeToRecentlyViewed(updateRecentlyViewed);

    return () => {
      mounted = false;

      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [currentSlug, catalogBySlug]);

  if (!items.length) return null;

  const scrollCarousel = (direction) => {
    const rail = railRef.current;
    if (!rail) return;

    rail.scrollBy({
      left: direction === "next" ? rail.clientWidth * 0.78 : -rail.clientWidth * 0.78,
      behavior: "smooth",
    });
  };

  return (
    <section className="mx-auto w-full max-w-[1480px] px-4 pb-4 pt-2 sm:px-6 lg:px-8">
      <div className="border-t border-[#303839]/12 pt-10 sm:pt-12">
        <div className="mb-4 flex min-w-0 items-center justify-between gap-4">
          <h2 className="min-w-0 font-display text-xl leading-tight text-[#303839] md:text-2xl">
            Recently viewed
          </h2>

          <div className="flex shrink-0 items-center gap-2">
            <CarouselButton
              onClick={() => scrollCarousel("prev")}
              ariaLabel="Previous recently viewed products"
            >
              <span className="block -translate-y-[2px]">&lsaquo;</span>
            </CarouselButton>

            <CarouselButton
              onClick={() => scrollCarousel("next")}
              ariaLabel="Next recently viewed products"
            >
              <span className="block -translate-y-[2px]">&rsaquo;</span>
            </CarouselButton>
          </div>
        </div>

        <div
          ref={railRef}
          className="flex max-w-full snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((product) => {
            const image = getMainMockupImage(product);

            return (
              <Link
                key={product.id || product.slug || product.title}
                href={`/products/${product.slug}`}
                aria-label={product.title ? `View ${product.title}` : "View product"}
                className="group relative block aspect-square w-[104px] shrink-0 snap-start overflow-hidden rounded-none bg-[#E6E6E6] ring-1 ring-[#303839]/10 transition hover:ring-[#303839]/25 sm:w-[112px] md:w-[120px] lg:w-[124px]"
              >
                <Image
                  src={image}
                  alt={product.title || "Recently viewed product"}
                  fill
                  sizes="(max-width: 640px) 104px, (max-width: 1024px) 120px, 124px"
                  className="object-cover"
                />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
