"use client";

import { useParallax } from "../hooks/useParallax";
import Reveal from "./Reveal";

const items = [
  {
    title: "Invitations",
    body: "The first impression of your day, designed to be kept long after the wedding ends.",
    speed: 0.05,
    icon: (
      <>
        <rect
          x="6"
          y="12"
          width="44"
          height="32"
          rx="2"
          fill="none"
          stroke="#303839"
          strokeWidth="2.5"
        />
        <path
          d="M6 14 L28 32 L50 14"
          fill="none"
          stroke="#303839"
          strokeWidth="2.5"
        />
      </>
    ),
  },
  {
    title: "Save the Dates",
    body: "A small promise sent early, so the people you love can make time for your celebration.",
    speed: 0.09,
    icon: (
      <>
        <rect
          x="8"
          y="10"
          width="40"
          height="36"
          rx="2"
          fill="none"
          stroke="#303839"
          strokeWidth="2.5"
        />
        <path d="M8 20 H48" stroke="#303839" strokeWidth="2.5" />
        <path
          d="M18 6 V14 M38 6 V14"
          stroke="#303839"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="28" cy="32" r="5" fill="#303839" />
      </>
    ),
  },
  {
    title: "Gifts with intention",
    body: "Keepsakes for bridal parties, parents, and couples, designed to feel thoughtful and lasting.",
    speed: 0.05,
    icon: (
      <>
        <rect
          x="8"
          y="20"
          width="40"
          height="26"
          fill="none"
          stroke="#303839"
          strokeWidth="2.5"
        />
        <path
          d="M8 20 H48 V12 H8 Z"
          fill="none"
          stroke="#303839"
          strokeWidth="2.5"
        />
        <path d="M28 12 V46" stroke="#303839" strokeWidth="2.5" />
      </>
    ),
  },
];

function DesignCard({ item, index }) {
  const [ref, offset] = useParallax(item.speed);

  return (
    <Reveal delay={index * 120}>
      <div
        ref={ref}
        style={{ transform: `translateY(${offset}px)` }}
        className="h-full rounded-none border border-[#E6E6E6]/20 bg-[#ece9e1] p-[clamp(1.5rem,3vw,2.5rem)]"
      >
        <svg
          viewBox="0 0 56 56"
          className="mb-[clamp(1rem,2.5vh,1.5rem)] h-[clamp(2.25rem,3vw,3rem)] w-[clamp(2.25rem,3vw,3rem)]"
          aria-hidden="true"
        >
          {item.icon}
        </svg>

        <h3 className="font-display text-[clamp(1.35rem,1.05rem+1.4vw,1.875rem)] text-[#303839]">{item.title}</h3>

        <p className="mt-4 font-body text-[clamp(0.9rem,0.82rem+0.4vw,1rem)] leading-relaxed text-[#303839]/80">
          {item.body}
        </p>
      </div>
    </Reveal>
  );
}

export default function AboutDesign() {
  return (
    <section className="lg:sticky lg:top-0 z-[3] flex min-h-[100svh] flex-col justify-center bg-[#f8f6f1] py-[clamp(2.5rem,7vh,7rem)]">
      <div className="max-w-6xl px-6 mx-auto">
        <Reveal className="max-w-xl">
          <span className="font-body text-xs uppercase tracking-[0.25em] text-[#303839]">
            What we make
          </span>

          <h2 className="mt-[clamp(0.75rem,2vh,1rem)] font-display text-[clamp(1.5rem,1.1rem+2vw,2.25rem)] leading-tight text-[#303839]">
            Stationery and gifts, drawn around your story.
          </h2>
        </Reveal>

        <div className="grid gap-[clamp(1rem,3vh,1.5rem)] mt-[clamp(2rem,5vh,4rem)] md:grid-cols-3">
          {items.map((item, index) => (
            <DesignCard key={item.title} item={item} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}