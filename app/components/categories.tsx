"use client";

import Image from "next/image";

import LinkHoverOverlay from "./link-hover-overlay";
import Reveal from "./reveal";

const categories = [
  { title: "Weddings", href: "/weddings", image: "/images/weddings.png" },
  { title: "Thank You Cards", href: "/cards", image: "/images/weddings/classic.png" },
  { title: "Gifts", href: "/gifts", image: "/images/gifts.png" },
  { title: "Personalized Gifts", href: "/gifts", image: "/images/personalizedGifts.png" },
  { title: "Stationery", href: "/stationery", image: "/images/weddings/minimalist.png" },
  { title: "Best Sellers", href: "/best-seller", image: "/images/invitations.png" },
];

export default function Categories() {
  return (
    <section
      id="products"
      className="relative z-10 overflow-hidden bg-white px-4 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24"
    >
      <div className="mx-auto max-w-[1480px]">

        <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-8 lg:grid-cols-6 lg:gap-6">
          {categories.map((cat, i) => (
            <Reveal key={cat.title} delay={i * 80} className="h-full">
              <a
                href={cat.href}
                className="group flex h-full flex-col items-center text-center"
              >
                <div className="relative aspect-square w-full max-w-[136px] overflow-hidden rounded-full bg-[#f8f6f1] ring-1 ring-[#303839]/8 transition-shadow duration-300 group-hover:ring-[#303839]/25 sm:max-w-[156px] lg:max-w-[170px]">
                  <Image
                    src={cat.image}
                    alt={cat.title}
                    fill
                    sizes="(min-width: 1024px) 160px, (min-width: 640px) 30vw, 45vw"
                    className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                  />
                  <LinkHoverOverlay />
                </div>

                <p className="mt-4 flex min-h-[2.6rem] w-full items-start justify-center text-[15px] font-medium leading-snug tracking-[0.01em] text-[#303839] transition-colors duration-300 group-hover:text-black sm:mt-5">
                  <span className="line-clamp-2">{cat.title}</span>
                </p>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
