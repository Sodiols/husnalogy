"use client";

import { useParallax } from "../hooks/useParallax";
import Reveal from "./Reveal";

export default function AboutStory() {
  const [cardRef, cardOffset] = useParallax(0.12);

  return (
    <section id="about-story" className="lg:sticky lg:top-0 z-[1] flex min-h-[100svh] scroll-mt-24 flex-col justify-center bg-[#fff] py-[clamp(2.5rem,7vh,7rem)]">
      <div className="grid items-center max-w-6xl px-6 mx-auto gap-[clamp(2rem,5vh,5rem)] md:grid-cols-2">
        <div
          ref={cardRef}
          style={{ transform: `translateY(${cardOffset}px)` }}
          className="order-2 md:order-1"
        >
          <div className="relative max-w-sm mx-auto">
            <div className="absolute -inset-3 rounded-none border border-[#E6E6E6]/40" />

            <div className="relative rounded-none bg-[#ece9e1] p-[clamp(1.5rem,4vw,2.5rem)] shadow-xl">
              <svg
                viewBox="0 0 80 80"
                className="w-12 h-12 mb-6"
                aria-hidden="true"
              >
                <path
                  d="M40 70 C40 50 20 44 22 26 C23 14 34 6 40 2"
                  fill="none"
                  stroke="#303839"
                  strokeWidth="2.5"
                />
                <path
                  d="M40 30 C30 24 26 16 28 8"
                  fill="none"
                  stroke="#303839"
                  strokeWidth="2.5"
                />
                <path
                  d="M40 46 C50 40 54 32 52 24"
                  fill="none"
                  stroke="#303839"
                  strokeWidth="2.5"
                />
              </svg>

              <p className="font-display text-2xl italic text-[#303839]">
                Est. with one favor
              </p>

              <p className="mt-2 font-body text-xs uppercase tracking-[0.2em] text-[#303839]/60">
                A kitchen table, three weeks before a wedding
              </p>
            </div>
          </div>
        </div>

        <div className="order-1 md:order-2">
          <Reveal>
            <span className="font-body text-xs uppercase tracking-[0.25em] text-[#303839]">
              How we started
            </span>
          </Reveal>

          <Reveal delay={100}>
            <h2 className="mt-[clamp(0.75rem,2vh,1rem)] font-display text-[clamp(1.5rem,1.1rem+2vw,2.25rem)] leading-tight text-[#303839]">
              A name built from love and a habit of finishing what we start.
            </h2>
          </Reveal>

          <Reveal delay={200}>
            <p className="mt-[clamp(1rem,2.5vh,1.5rem)] font-body text-[clamp(0.9rem,0.82rem+0.5vw,1.0625rem)] leading-relaxed text-[#303839]/80">
              Husnalogy began on a kitchen table, with a stack of cardstock, a
              borrowed glue gun, and a wedding three weeks away. What started as
              one favor for a friend turned into a small studio built on a
              simple belief: the paper that announces your day deserves the same
              care as the day itself.
            </p>
          </Reveal>

          <Reveal delay={300}>
            <p className="mt-[clamp(0.75rem,2vh,1rem)] font-body text-[clamp(0.9rem,0.82rem+0.5vw,1.0625rem)] leading-relaxed text-[#303839]/80">
              Every piece we make still passes through the same hands that cut
              that first card, slower than a factory, more stubborn than a trend,
              and unwilling to let anything leave unfinished.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
