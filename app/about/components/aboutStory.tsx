import Image from "next/image";

import Reveal from "./Reveal";
import { BUSINESS_INFO } from "@/lib/launch-config";

export default function AboutStory() {
  return (
    <section id="about-story" aria-labelledby="about-story-heading" className="bg-white">
      <div className="page-container section grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
        <Reveal className="relative">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] bg-cream-deep lg:aspect-[5/6]">
            <Image
              src="/images/weddings/WeddingHeroIMG.png"
              alt="A deckle-edged invitation suite with gold wax seals and dried flowers"
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover object-[78%_center]"
            />
          </div>
        </Reveal>

        <div className="max-w-[560px]">
          <Reveal>
            <p className="eyebrow">Our story</p>
            <h2 id="about-story-heading" className="heading-section mt-3">
              A studio for the occasions you want to remember.
            </h2>
          </Reveal>

          <Reveal delay={100}>
            <p className="text-lead mt-6">
              Husnalogy was founded by {BUSINESS_INFO.founder} to create invitations, cards, gifts and stationery for
              life&rsquo;s meaningful occasions, with clear typography and quiet, considered detail.
            </p>
            <p className="text-lead mt-4">
              Every design is made to be personalized. Add your names, dates and words, review the result,
              and we prepare your order with care.
            </p>
          </Reveal>

          <Reveal delay={200} className="mt-10 flex items-center gap-4 border-t border-line pt-6">
            <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-1 ring-line">
              <Image src="/Brand Kit/Logo-2.png" alt="" fill sizes="48px" className="object-cover" />
            </span>
            <span>
              <span className="block font-display text-[22px] font-medium italic leading-tight text-ink">{BUSINESS_INFO.founder}</span>
              <span className="text-caption block">Founder, Husnalogy</span>
            </span>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
