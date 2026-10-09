import Image from "next/image";
import Link from "next/link";

const giftingItems = [
  { title: "Personalized gifts", image: "/images/personalizedGifts.png", imageAlt: "White photo mug with a personalized message, held in two hands", href: "/collections/personalized-gifts" },
  // This photo ships with a white rounded frame baked into the file; `bleed`
  // enlarges it past the tile edges so the frame is cropped like the others.
  { title: "Birthday gifts", image: "/images/bdayGifts.png", imageAlt: "Birthday gift box with a personalized mug, a candle and a card", href: "/collections/birthday-gifts", bleed: true },
  { title: "Gifts for her", image: "/images/giftsForHer.png", imageAlt: "Pair of yellow luggage tags with a daisy design and a handwritten name", href: "/collections/gifts-for-her" },
  { title: "Gifts for him", image: "/images/giftsForHim.png", imageAlt: "Photo collage necktie beside a black gift box", href: "/collections/gifts-for-him" },
];

export default function GiftingIdeas() {
  return (
    <section aria-labelledby="gifting-heading" className="bg-white">
      <div className="page-container section">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4 lg:mb-10">
          <div>
            <p className="eyebrow">Thoughtfully chosen</p>
            <h2 id="gifting-heading" className="heading-section mt-3">
              Gifting ideas
            </h2>
          </div>
          <Link href="/gifts" className="btn-text btn text-[15px]">
            Shop all gifts
          </Link>
        </header>

        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-4">
          {giftingItems.map((item) => (
            <li key={item.title}>
              <Link href={item.href} className="group block">
                <span className="relative block aspect-[4/5] overflow-hidden rounded-[10px] bg-cream">
                  <span className={`absolute ${item.bleed ? "-inset-[5%]" : "inset-0"}`}>
                    <Image src={item.image} alt={item.imageAlt} fill sizes="(max-width: 1024px) 55vw, 28vw" className="object-cover" />
                  </span>
                </span>
                <span className="mt-4 block text-[15px] font-semibold text-ink underline-offset-4 group-hover:underline">
                  {item.title}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
