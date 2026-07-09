"use client";

import Reveal from "./reveal";

export default function About() {
  const aboutItems = [
    [
      "A studio with meaning",
      "Husnalogy creates refined cards, invitations, gifts and stationery for meaningful life moments. Every design is made with clean typography, timeless detail and quiet elegance.",
    ],
    [
      "Personalized with care",
      "From wedding invitations to custom gifts, we help you create pieces that feel personal, thoughtful and beautifully made for your special occasion.",
    ],
    [
      "Simple peace of mind",
      "Our goal is to make your design experience calm, easy and elegant, with clear options and a premium visual style you can trust.",
    ],
  ];

  return (
    <section
      id="about"
      className="bg-[#f8f6f1] px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-10 lg:py-24"
    >
      <div className="mx-auto max-w-[1480px]">
        <Reveal>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/50">
            The Husnalogy story
          </p>
          <h2 className="font-display text-[2rem] font-medium text-[#303839] sm:text-[2.5rem] lg:text-[2.75rem]">
            What is Husnalogy?
          </h2>

          <a
            href="/about"
            className="group mt-3 inline-block text-xs font-semibold text-charcoal"
          >
            <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:100%_1px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-500 ease-out group-hover:bg-[length:0%_1px]">
              Read our beautifully crafted story
            </span>
          </a>
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-[1020px] gap-10 text-left md:grid-cols-3 md:gap-12">
          {aboutItems.map(([title, text], i) => (
            <Reveal key={title} delay={i * 120}>
              <div className="border-t border-[#303839]/15 pt-6">
                <h3 className="font-display text-[1.35rem] font-medium text-[#303839]">{title}</h3>

                <p className="mt-4 text-[15px] leading-[1.8] text-[#303839]/70">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-16">
          <h3 className="text-[15px] font-semibold text-[#303839]">
            Have a question? We are here to help.
          </h3>

          <a
            href="/contact"
            className="mt-5 inline-flex h-12 items-center justify-center rounded-none border border-[#303839] px-8 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#303839] transition-colors duration-300 hover:bg-[#303839] hover:text-white"
          >
            Contact Us
          </a>
        </Reveal>
      </div>
    </section>
  );
}
