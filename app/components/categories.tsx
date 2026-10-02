"use client";

import Image from "next/image";
import Link from "next/link";

import Reveal from "./reveal";

const categories = [
  { title: "Weddings", href: "/weddings", image: "/images/weddings.png" },
  { title: "Thank you cards", href: "/cards", image: "/images/weddings/classic.png" },
  { title: "Gifts", href: "/gifts", image: "/images/gifts.png" },
  { title: "Personalized gifts", href: "/collections/personalized-gifts", image: "/images/personalizedGifts.png" },
  { title: "Stationery", href: "/stationery", image: "/images/weddings/minimalist.png" },
  { title: "Shop all", href: "/products", image: "/images/invitations.png" },
];

export default function Categories() {
  return (
    // No bottom padding: the gifting section that follows on the same white
    // surface supplies the single gap between the two.
    <section id="products" aria-labelledby="categories-heading" className="bg-white">
      <div className="page-container section pb-0 sm:pb-0 lg:pb-0">
        <Reveal as="header" className="mb-8 lg:mb-10">
          <p className="eyebrow">Find your occasion</p>
          <h2 id="categories-heading" className="heading-section mt-3">
            Shop by category
          </h2>
        </Reveal>

        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-6">
          {categories.map((cat, i) => (
            <Reveal as="li" key={cat.title} delay={i * 60} className="h-full">
              <Link href={cat.href} className="group flex h-full flex-col items-center text-center">
                <span className="relative block aspect-square w-full max-w-[168px] overflow-hidden rounded-full bg-cream ring-1 ring-line transition-shadow duration-200 group-hover:ring-ink/40">
                  <Image
                    src={cat.image}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 168px, (min-width: 640px) 30vw, 45vw"
                    className="object-cover"
                  />
                </span>
                <span className="mt-4 text-[15px] font-semibold leading-snug text-ink underline-offset-4 group-hover:underline">
                  {cat.title}
                </span>
              </Link>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
