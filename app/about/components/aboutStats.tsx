"use client";

import Reveal from "./Reveal";

const stats = [
  {
    number: "6000+",
    label: "Weddings designed with care",
  },
  {
    number: "1800+",
    label: "Hours of lettering and proofing",
  },
  {
    number: "0",
    label: "Templates reused without thought",
  },
];

export default function AboutStats() {
  return (
    <section className="lg:sticky lg:top-0 z-[4] flex min-h-[50svh] flex-col justify-center border-t border-[#303839]/8 bg-[#f8f6f1] py-[clamp(2.5rem,7vh,7rem)]">
      <div className="grid max-w-6xl grid-cols-1 gap-[clamp(2rem,5vh,3rem)] px-6 mx-auto text-center md:grid-cols-3">
        {stats.map((stat, index) => (
          <Reveal key={stat.label} delay={index * 150}>
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-[#303839]/15 bg-white">
              <span className="font-display text-lg font-semibold text-[#303839]">
                {stat.number}
              </span>
            </div>

            <p className="font-body text-xs uppercase tracking-[0.2em] text-[#303839]/60">
              {stat.label}
            </p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}