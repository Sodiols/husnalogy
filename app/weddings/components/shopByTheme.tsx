import Image from "next/image";

import LinkHoverOverlay from "../../components/link-hover-overlay";
import Reveal from "../../components/reveal";

const themes = [
  { title: "Simple", image: "/images/weddings/simple.png", href: "/collections/simple-wedding" },
  { title: "Minimal", image: "/images/weddings/minimalist.png", href: "/collections/minimal-wedding" },
  { title: "Floral", image: "/images/weddings/boho.png", href: "/collections/floral-wedding" },
  { title: "Classic", image: "/images/weddings/classic.png", href: "/collections/classic-wedding" },
  { title: "Rustic", image: "/images/weddings/rustic.png", href: "/collections/rustic-wedding" },
  { title: "Modern", image: "/images/weddings/blackAndWhite.png", href: "/collections/modern-wedding" },
];

export default function ShopByTheme() {
  return (
    <section className="overflow-hidden bg-white px-4 py-16 sm:px-6 sm:py-20 lg:px-12 lg:py-24 xl:px-16">
      <div className="mx-auto max-w-[1480px]">
        <Reveal as="header" className="mx-auto max-w-[680px] text-center">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/55">
            Curated for your style
          </p>
          <h2 className="font-display text-[2rem] font-medium leading-[1.08] text-[#303839] sm:text-[2.5rem] lg:text-[2.75rem]">
            Shop by Theme
          </h2>
          <p className="mt-5 text-[0.98rem] leading-[1.6] text-[#303839]/65">
            Discover invitation styles and curated pieces designed to match your story.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:mt-14 lg:grid-cols-6">
          {themes.map((theme, i) => (
            <Reveal key={theme.title} delay={i * 80} className="h-full">
              <a
                href={theme.href}
                className="group flex h-full flex-col items-center text-center"
              >
                <div className="relative h-[130px] w-[130px] overflow-hidden rounded-full bg-[#f8f6f1] sm:h-[150px] sm:w-[150px] lg:h-[160px] lg:w-[160px]">
                  <Image
                    src={theme.image}
                    alt={`${theme.title} wedding theme`}
                    fill
                    sizes="(min-width: 1024px) 160px, (min-width: 640px) 30vw, 45vw"
                    className="object-cover"
                  />
                  <LinkHoverOverlay />
                </div>

                <p className="mt-5 text-[0.98rem] font-medium text-[#303839] transition-colors duration-300 group-hover:text-[#303839]">
                  {theme.title}
                </p>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
