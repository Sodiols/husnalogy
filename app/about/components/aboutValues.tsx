import Reveal from "./Reveal";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const values = [
  {
    label: "Love",
    title: "Personal before it is pretty.",
    body: "We ask about your colors, your story and the details that make your celebration feel like you. Nothing leaves our studio until it feels personal, refined and meaningful.",
    icon: <path {...stroke} d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" />,
  },
  {
    label: "Determination",
    title: "Every detail matters until the end.",
    body: "Wedding dates do not move easily, so our process is built around care, timing and patience. We revise, refine and prepare each piece with calm attention.",
    icon: (
      <>
        <circle {...stroke} cx="12" cy="12" r="9" />
        <path {...stroke} d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
      </>
    ),
  },
];

export default function AboutValues() {
  return (
    <section aria-labelledby="about-values-heading" className="bg-cream">
      <div className="page-container section">
        <Reveal className="mx-auto max-w-[640px] text-center">
          <p className="eyebrow">What we build everything on</p>
          <h2 id="about-values-heading" className="heading-section mt-3">
            Two values behind every design.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-2 md:gap-6 lg:mt-14">
          {values.map((value, index) => (
            <Reveal
              key={value.label}
              delay={index * 120}
              className="flex flex-col rounded-[10px] border border-line bg-white p-7 sm:p-10"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-cream text-ink">
                  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden="true">
                    {value.icon}
                  </svg>
                </span>
                <span className="font-display text-[15px] text-muted">0{index + 1}</span>
              </div>

              <p className="mt-8 font-display text-[26px] font-medium italic leading-none text-ink">{value.label}</p>
              <h3 className="mt-4font-display text-[clamp(1.4rem,1.2rem+0.8vw,1.75rem)] font-medium leading-snug text-ink">
                {value.title}
              </h3>
              <p className="mt-3 text-[15px] leading-[1.75] text-muted">{value.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
