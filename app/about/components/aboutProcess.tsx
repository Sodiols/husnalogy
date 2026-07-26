"use client";

import { useInView } from "../hooks/useInView";
import Float from "./Float";

const steps = [
  {
    number: "01",
    title: "Conversation",
    body: "We learn your story and your date before we draw a single line.",
  },
  {
    number: "02",
    title: "Sketch",
    body: "Concepts are shaped around your details, never copied from a fixed template.",
  },
  {
    number: "03",
    title: "Proof",
    body: "We revise until the design feels clear, balanced, and ready.",
  },
  {
    number: "04",
    title: "Craft",
    body: "Printing, cutting, and assembly are handled with careful attention.",
  },
  {
    number: "05",
    title: "Send",
    body: "Your order is checked, packed, and prepared for its final journey.",
  },
];

function Step({ step, isLast }) {
  const [ref, inView] = useInView(0.25);

  return (
    <div ref={ref} className="relative flex gap-5 pb-[clamp(0.5rem,1.25vh,1rem)] last:pb-0 md:gap-6">
      {!isLast && (
        <span
          className={`absolute left-[23px] top-12 h-[calc(100%-3rem)] w-px transition-colors duration-700 md:left-[23px] ${
            inView ? "bg-[#303839]" : "bg-[#303839]/20"
          }`}
        />
      )}

      <div
        className={`flex h-12 w-12 flex-none items-center justify-center rounded-full border-2 font-body text-sm transition-colors duration-500 ${
          inView
            ? "border-[#303839] bg-[#303839] text-[#f8f6f1]"
            : "border-[#303839]/30 bg-transparent text-[#303839]/45"
        }`}
      >
        {step.number}
      </div>

      <div
        className={`pt-2 transition-all duration-700 ${
          inView
            ? "translate-x-0 opacity-100"
            : "translate-x-2 opacity-75 motion-reduce:translate-x-0 motion-reduce:opacity-100"
        }`}
      >
        <h3 className="font-display text-[clamp(1.1rem,0.95rem+0.8vw,1.45rem)] text-[#303839]">
          {step.title}
        </h3>

        <p className="mt-1.5 max-w-md font-body text-[clamp(0.8rem,0.76rem+0.25vw,0.88rem)] leading-relaxed text-[#303839]/70">
          {step.body}
        </p>
      </div>
    </div>
  );
}

export default function AboutProcess() {
  return (
    <section className="relative z-[5] bg-[#f8f6f1] text-[#303839] lg:min-h-[145svh]">
      <div className="flex min-h-[100svh] flex-col justify-center py-[clamp(1.25rem,3vh,3rem)] lg:sticky lg:top-[84px] lg:min-h-[calc(100svh-84px)]">
        <div className="max-w-3xl px-6 mx-auto">
          <div className="mb-[clamp(0.85rem,2vh,1.4rem)]">
            <span className="font-body text-xs uppercase tracking-[0.25em] text-[#303839]/70">
              From sketch to send
            </span>

            <h2 className="mt-[clamp(0.5rem,1.2vh,0.85rem)] text-[clamp(1.45rem,1.1rem+1.7vw,2rem)] font-display">
              Five steps, never skipped.
            </h2>
          </div>

          <Float amplitude={8} duration={7000}>
            {steps.map((step, index) => (
              <Step
                key={step.number}
                step={step}
                isLast={index === steps.length - 1}
              />
            ))}
          </Float>
        </div>
      </div>
    </section>
  );
}
