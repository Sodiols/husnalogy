"use client";

import { useState } from "react";

import { useInView } from "../hooks/useInView";

const faqs = [
  {
    q: "What is Husnalogy?",
    a: (
      <>
        Husnalogy is a refined design studio for meaningful wedding invitations,
        custom cards, personalized gifts, and minimalist stationery created with
        a clean and timeless style.
      </>
    ),
  },
  {
    q: "What can I buy from Husnalogy?",
    a: (
      <>
        You can shop elegant wedding invitations, save the dates, thank you
        cards, custom cards, personalized gifts, and stationery designs for
        special moments.
      </>
    ),
  },
  {
    q: "Can I personalize Husnalogy designs?",
    a: (
      <>
        Yes. Many Husnalogy designs can be personalized with names, dates,
        photos, messages, event details, and other meaningful information.
      </>
    ),
  },
  {
    q: "Where should I start shopping?",
    a: (
      <>
        You can start from the{" "}
        <a href="/weddings" className="text-[#303839] underline underline-offset-4">
          wedding collection
        </a>{" "}
        or browse by category to find invitations, cards, gifts, and stationery
        that match your occasion.
      </>
    ),
  },
];

export default function AboutFAQ() {
  const [openIndex, setOpenIndex] = useState(null);
  const [revealRef, inView] = useInView(0.15);

  function toggleFAQ(index) {
    setOpenIndex(openIndex === index ? null : index);
  }

  return (
    <section className="lg:sticky lg:top-0 z-[7] flex min-h-[70vh] flex-col justify-center bg-[#f8f6f1] px-6 py-[clamp(2.5rem,7vh,7rem)] sm:px-10 lg:px-12 xl:px-20">
      <div
        ref={revealRef}
        className={`mx-auto w-full max-w-[980px] transition-all duration-700 ease-out motion-reduce:transition-opacity ${
          inView ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0 motion-reduce:translate-y-0"
        }`}
      >
        <h3 className="mb-[clamp(2rem,5vh,2.5rem)] text-center font-display text-[clamp(2.1rem,1.6rem+2vw,2.7rem)] font-semibold leading-tight text-[#303839]">
          FAQ
        </h3>

        <div className="border-t border-[#303839]/15">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;

            return (
              <div key={faq.q} className="border-b border-[#303839]/15">
                <button
                  type="button"
                  onClick={() => toggleFAQ(index)}
                  className="flex w-full items-center justify-between gap-6 py-7 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-body text-[.9rem] font-semibold leading-tight text-[#303839] sm:text-[1rem]">
                    {faq.q}
                  </span>

                  <span className="shrink-0 text-[1.25rem] font-semibold leading-none text-[#303839]">
                    {isOpen ? "×" : "+"}
                  </span>
                </button>

                {isOpen && (
                  <div className="pb-7 pr-8">
                    <p className="max-w-[760px] text-[0.75rem] leading-[1.8] text-[#303839]/78">
                      {faq.a}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
