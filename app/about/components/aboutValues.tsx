"use client";

import Reveal from "./Reveal";

const values = [
  {
    label: "Love",
    title: "Personal before it is pretty.",
    body: "We ask about your colors, your story, and the details that make your celebration feel like you. Nothing leaves our studio until it feels personal, refined, and meaningful.",
    icon: (
      <path
        d="M20 34 C8 24 8 10 20 8 C26 7 30 12 30 16 C30 12 34 7 40 8 C52 10 52 24 40 34 L30 42 Z"
        fill="none"
        stroke="#303839"
        strokeWidth="2.5"
      />
    ),
  },
  {
    label: "Determination",
    title: "Every detail matters until the end.",
    body: "Wedding dates do not move easily, so our process is built around care, timing, and patience. We revise, refine, and prepare each piece with calm attention.",
    icon: (
      <>
        <circle
          cx="30"
          cy="24"
          r="18"
          fill="none"
          stroke="#303839"
          strokeWidth="2.5"
        />
        <path d="M30 6 L34 22 L30 24 L26 22 Z" fill="#303839" />
      </>
    ),
  },
];

export default function AboutValues() {
  return (
    <section className="lg:sticky lg:top-0 z-[2] flex min-h-[100svh] flex-col justify-center border-t border-[#303839]/8 bg-white py-[clamp(2.5rem,7vh,7rem)]">
      <div className="max-w-6xl px-6 mx-auto">
        <Reveal className="text-center">
          <span className="font-body text-xs uppercase tracking-[0.25em] text-[#303839]/50">
            What we build everything on
          </span>

          <h2 className="mt-[clamp(0.75rem,2vh,1rem)] font-display text-[clamp(1.5rem,1.1rem+2vw,2.25rem)] font-semibold text-[#303839]">
            Two values behind every design.
          </h2>
        </Reveal>

        <div className="mt-[clamp(2rem,5vh,4rem)] grid gap-px overflow-hidden rounded-none border border-[#303839]/10 bg-[#303839]/10 md:grid-cols-2">
          {values.map((value, index) => (
            <Reveal
              key={value.label}
              delay={index * 150}
              className="bg-[#f8f6f1] px-[clamp(1.5rem,4vw,3rem)] py-[clamp(2rem,4vh,4rem)]"
            >
              <svg
                viewBox="0 0 60 48"
                className="w-12 h-10 mb-6"
                aria-hidden="true"
              >
                {value.icon}
              </svg>

              <span className="font-display text-2xl italic text-[#303839]">
                {value.label}
              </span>

              <h3 className="mt-3 font-display text-[clamp(1.35rem,1.05rem+1.4vw,1.875rem)] leading-snug text-[#303839]">
                {value.title}
              </h3>

              <p className="mt-4 font-body text-[clamp(0.9rem,0.82rem+0.4vw,1rem)] leading-relaxed text-[#303839]/80">
                {value.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}