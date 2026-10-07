"use client";

import { useId, useState } from "react";
import Link from "next/link";

import Reveal from "./Reveal";

const faqs = [
  {
    q: "What is Husnalogy?",
    a: (
      <>
        Husnalogy is a design studio for meaningful wedding invitations, custom cards, personalized gifts and
        minimalist stationery, created with a clean and timeless style.
      </>
    ),
  },
  {
    q: "What can I buy from Husnalogy?",
    a: (
      <>
        You can shop wedding invitations, save the dates, thank you cards, custom cards, personalized gifts and
        stationery designs for special moments.
      </>
    ),
  },
  {
    q: "Can I personalize Husnalogy designs?",
    a: (
      <>
        Yes. Many Husnalogy designs can be personalized with names, dates, photos, messages, event details and
        other meaningful information.
      </>
    ),
  },
  {
    q: "Where should I start shopping?",
    a: (
      <>
        Start with the{" "}
        <Link href="/weddings" className="font-semibold text-ink underline underline-offset-4">
          wedding collection
        </Link>{" "}
        or browse by category to find invitations, cards, gifts and stationery that match your occasion.
      </>
    ),
  },
];

export default function AboutFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const baseId = useId();

  return (
    <section aria-labelledby="about-faq-heading" className="bg-cream">
      <div className="page-container section grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-20">
        <Reveal className="max-w-[420px]">
          <p className="eyebrow">Questions</p>
          <h2 id="about-faq-heading" className="heading-section mt-3">
            Frequently asked
          </h2>
          <p className="text-lead mt-4">
            Can&rsquo;t find what you&rsquo;re looking for? We&rsquo;re happy to help.
          </p>
          <Link href="/contact" className="btn btn-secondary mt-7 bg-transparent">
            Contact us
          </Link>
        </Reveal>

        <Reveal delay={100} className="border-t border-ink/15">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            const buttonId = `${baseId}-q${index}`;
            const panelId = `${baseId}-a${index}`;

            return (
              <div key={faq.q} className="border-b border-ink/15">
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="group flex min-h-16 w-full cursor-pointer items-center justify-between gap-6 py-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    <span className="font-display text-[clamp(1.2rem,1.1rem+0.4vw,1.375rem)] font-medium leading-snug text-ink">
                      {faq.q}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors duration-200 ${
                        isOpen ? "border-ink bg-ink text-white" : "border-ink/20 text-ink group-hover:border-ink/50"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M5 12h14" />
                        <path d="M12 5v14" className={`origin-center transition-transform duration-300 ${isOpen ? "scale-y-0" : "scale-y-100"}`} />
                      </svg>
                    </span>
                  </button>
                </h3>

                {/* Grid-rows trick animates to the content's natural height. */}
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                >
                  <div className="overflow-hidden" inert={!isOpen}>
                    <p className="max-w-[640px] pb-6 pr-12 text-[15px] leading-[1.75] text-muted">{faq.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
