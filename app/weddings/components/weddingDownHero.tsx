// weddings/components/weddingDownHero.jsx

import Reveal from "../../components/reveal";

const points = [
  {
    icon: "pen",
    title: "Personalized Design",
    text: "Every detail tailored to your names, story, and celebration style.",
  },
  {
    icon: "gem",
    title: "Premium Materials",
    text: "Refined papers, soft textures, and finishes crafted to feel luxurious.",
  },
  {
    icon: "heart",
    title: "Made with Care",
    text: "Thoughtfully designed and reviewed before it ever reaches your hands.",
  },
];

export default function WeddingDownHero() {
  return (
    <section className="overflow-hidden bg-[#f8f6f1] px-4 py-16 sm:px-6 sm:py-20 lg:px-12 lg:py-24 xl:px-16">
      <div className="mx-auto max-w-[1480px]">
        <Reveal as="header" className="mx-auto max-w-[720px] text-center">
          <p className="flex items-center justify-center gap-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/55">
            <span aria-hidden="true" className="h-px w-9 bg-[#303839]/45" />
            Wedding Stationery Studio
            <span aria-hidden="true" className="h-px w-9 bg-[#303839]/45" />
          </p>

          <h2 className="mt-6 font-display text-[2rem] font-medium leading-[1.08] text-[#303839] sm:text-[2.5rem] lg:text-[2.75rem]">
            Your Wedding, Designed Your Way
          </h2>

          <p className="mx-auto mt-5 max-w-[620px] text-[1rem] leading-[1.75] text-[#303839]/70">
            From the save the date to the final thank you, Husnalogy helps you create
            wedding pieces that feel personal, refined, and beautifully made for your
            special day.
          </p>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-[1040px] grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-4 md:gap-5 lg:mt-14">
          {points.map((point, i) => (
            <Reveal key={point.title} delay={i * 100} className="h-full">
              <div className="flex h-full flex-col items-center rounded-none border border-[#303839]/[0.06] bg-white p-7 text-center shadow-[0_10px_30px_rgba(48,56,57,0.05)] transition-all duration-500 hover:-translate-y-1.5 hover:border-[#303839]/35 hover:shadow-[0_24px_55px_rgba(48,56,57,0.12)]">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-[#ece9e1] text-[#303839]">
                  <StudioIcon name={point.icon} />
                </span>
                <h3 className="mt-5 font-display text-[1.35rem] font-medium text-[#303839]">{point.title}</h3>
                <p className="mt-2 text-[13px] leading-6 text-[#303839]/65">{point.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function StudioIcon({ name }) {
  const base: any = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  switch (name) {
    case "pen":
      return (
        <svg {...base}>
          <path d="m4 20 4-1 11-11a2.2 2.2 0 0 0-3.1-3.1L5 16l-1 4Z" />
          <path d="m14.5 6.5 3 3" />
        </svg>
      );
    case "gem":
      return (
        <svg {...base}>
          <path d="M6 3h12l3 6-9 12L3 9l3-6Z" />
          <path d="M3 9h18" />
          <path d="M9 3 7.5 9 12 21l4.5-12L15 3" />
        </svg>
      );
    case "heart":
      return (
        <svg {...base}>
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" />
        </svg>
      );
    default:
      return null;
  }
}
