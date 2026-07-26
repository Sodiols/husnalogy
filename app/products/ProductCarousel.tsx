"use client";

import { useRef } from "react";
import ProductCard from "./ProductCard";

function Chevron({ direction = "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 6 6 6-6 6"} />
    </svg>
  );
}

function CarouselButton({ children, onClick, ariaLabel, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      data-shape="round"
      className={`grid h-[42px] w-[42px] place-items-center rounded-full bg-white text-[#303839] shadow-[0_8px_24px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.03] transition-all duration-300 ease-out hover:scale-[1.04] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]/20 ${className}`}
    >
      {children}
    </button>
  );
}

export default function ProductCarousel({
  title,
  products = [],
  className = "",
  itemClassName = "w-[78vw] max-w-[280px] shrink-0 sm:w-[44%] sm:max-w-none lg:w-[30%]",
}) {
  const railRef = useRef(null);

  if (!products.length) return null;

  const scrollCarousel = (direction) => {
    const rail = railRef.current;
    if (!rail) return;

    const amount = Math.max(280, rail.clientWidth * 0.82);

    rail.scrollBy({
      left: direction === "next" ? amount : -amount,
      behavior: "smooth",
    });
  };

  return (
    <section className={`relative min-w-0 max-w-full overflow-hidden ${className}`}>
      <div className="mb-5 flex min-w-0 items-center justify-between gap-4">
        {title && (
          <h2 className="min-w-0 font-display text-2xl leading-tight text-[#303839] md:text-3xl">
            {title}
          </h2>
        )}

        <div className="flex shrink-0 items-center gap-2">
          <CarouselButton
            onClick={() => scrollCarousel("prev")}
            ariaLabel="Previous products"
          >
            <Chevron direction="left" />
          </CarouselButton>

          <CarouselButton
            onClick={() => scrollCarousel("next")}
            ariaLabel="Next products"
          >
            <Chevron direction="right" />
          </CarouselButton>
        </div>
      </div>

      <div className="relative min-w-0 max-w-full overflow-hidden">
        <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-10" />
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-10" />

        <div
          ref={railRef}
          className="flex max-w-full snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth pb-2 sm:gap-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {products.map((product) => (
            <div
              key={product.id || product.slug || product.title}
              className={`min-w-0 snap-start ${itemClassName}`}
            >
              <ProductCard product={product} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
