import Image from "next/image";
import Link from "next/link";
import LinkHoverOverlay from "./link-hover-overlay";
import Reveal from "./reveal";

const giftingItems = [
  {
    title: "Personalized gifts",
    image: "/images/personalizedGifts.png",
    href: "/collections/personalized-gifts",
  },
  {
    title: "Birthday gifts",
    image: "/images/bdayGifts.png",
    href: "/collections/birthday-gifts",
  },
  {
    title: "Gifts for her",
    image: "/images/giftsForHer.png",
    href: "/collections/gifts-for-her",
  },
  {
    title: "Gifts for him",
    image: "/images/giftsForHim.png",
    href: "/collections/gifts-for-him",
  },
];

export default function GiftingIdeas() {
  return (
    <section className="bg-white px-4 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
      <div className="mx-auto max-w-[1480px]">
        <Reveal as="header" className="mb-12 lg:mb-14">
          <p className="mb-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/50">
            <span aria-hidden="true" className="h-px w-10 bg-[#303839]/40" />
            Thoughtfully chosen
          </p>
          <h2 className="font-display text-[2rem] font-medium text-[#303839] sm:text-[2.5rem] lg:text-[2.75rem]">
            Shop our top gifting ideas
          </h2>
        </Reveal>

        <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-12">
          {giftingItems.map((item, i) => (
            <Reveal key={item.title} delay={i * 110}>
              <Link href={item.href} className="group block text-center">
                <div className="relative aspect-[1.12/1] overflow-hidden rounded-none bg-[#f8f6f1] ring-1 ring-[#303839]/8">
                  <Image
                    src={item.image}
                    alt={item.title}
                    fill
                    sizes="(max-width: 1024px) 50vw, 25vw"
                    className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                  />
                  <LinkHoverOverlay />
                </div>

                <h3 className="mt-5 inline-block text-[15px] font-medium tracking-[0.01em] text-[#303839]">
                  <span className="bg-[linear-gradient(#303839,#303839)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat pb-1 transition-[background-size] duration-500 ease-out group-hover:bg-[length:100%_1px]">
                    {item.title}
                  </span>
                </h3>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
