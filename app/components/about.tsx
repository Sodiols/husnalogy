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
      "Our goal is to make your design experience calm, easy and elegant, with clear options and a visual style you can trust.",
    ],
  ];

  return (
    <section id="about" className="bg-cream text-center">
      <div className="page-container section">
        <Reveal>
          <p className="eyebrow">The Husnalogy story</p>
          <h2 className="heading-section mt-3">What is Husnalogy?</h2>

          <a
            href="/about"
            className="group mt-4 inline-block text-[14px] font-semibold text-ink"
          >
            <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:100%_1px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-500 ease-out group-hover:bg-[length:0%_1px]">
              Read our beautifully crafted story
            </span>
          </a>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-[1020px] gap-8 text-left md:grid-cols-3 md:gap-12">
          {aboutItems.map(([title, text], i) => (
            <Reveal key={title} delay={i * 120}>
              <div className="border-t border-ink/15 pt-6">
                <h3 className="font-display text-[1.5rem] font-medium leading-tight text-ink">{title}</h3>

                <p className="mt-3 text-[15px] leading-7 text-muted">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-12">
          <h3 className="text-[15px] font-semibold text-ink">
            Have a question? We are here to help.
          </h3>

          <a href="/contact" className="btn btn-secondary mt-4 bg-transparent hover:bg-ink hover:text-white">
            Contact us
          </a>
        </Reveal>
      </div>
    </section>
  );
}
