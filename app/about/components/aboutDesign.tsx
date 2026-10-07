import Image from "next/image";
import Link from "next/link";

import Reveal from "./Reveal";

const items = [
  {
    title: "Invitations",
    body: "The first impression of your day, designed to be kept long after the wedding ends.",
    href: "/weddings",
    cta: "Shop invitations",
    image: "/images/weddings/classic.png",
    alt: "A cream envelope closed with a monogrammed seal",
  },
  {
    title: "Save the Dates",
    body: "A small promise sent early, so the people you love can make time for your celebration.",
    href: "/save-the-dates",
    cta: "Shop save the dates",
    image: "/images/weddings/trendy.png",
    alt: "A modern save the date card with bold serif names",
  },
  {
    title: "Gifts with intention",
    body: "Keepsakes for bridal parties, parents and couples, designed to feel thoughtful and lasting.",
    href: "/gifts",
    cta: "Shop gifts",
    image: "/images/personalizedGifts.png",
    alt: "A personalized photo mug held in two hands",
  },
];

export default function AboutDesign() {
  return (
    <section aria-labelledby="about-make-heading" className="bg-white">
      <div className="page-container section">
        <Reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-[560px]">
            <p className="eyebrow">What we make</p>
            <h2 id="about-make-heading" className="heading-section mt-3">
              Stationery and gifts, drawn around your story.
            </h2>
          </div>
          <Link
            href="/products"
            className="group inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-ink underline-offset-4 hover:underline"
          >
            Browse everything
            <Arrow className="transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Reveal>

        <ul className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:mt-14 lg:grid-cols-3">
          {items.map((item, index) => (
            <Reveal as="li" key={item.title} delay={index * 100}>
              <Link href={item.href} className="group block rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink">
                <span className="relative block aspect-[4/5] overflow-hidden rounded-[10px] bg-cream-deep">
                  <Image
                    src={item.image}
                    alt={item.alt}
                    fill
                    sizes="(min-width: 1024px) 30vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03]"
                  />
                </span>
                <span className="mt-5 block font-display text-[clamp(1.5rem,1.3rem+0.6vw,1.75rem)] font-medium leading-tight text-ink">
                  {item.title}
                </span>
                <span className="mt-2 block max-w-[38ch] text-[15px] leading-[1.7] text-muted">{item.body}</span>
                <span className="mt-4 inline-flex items-center gap-2 text-[14px] font-semibold text-ink underline-offset-4 group-hover:underline">
                  {item.cta}
                  <Arrow className="transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </Link>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Arrow({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
