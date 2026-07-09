"use client";

import { useEffect, useRef, useState } from "react";
import Float from "./Float";
import RightArrowIcon from "../../components/RightArrowIcon";

const HEADLINE_WORDS = [
  { text: "Every", script: false },
  { text: "invitation", script: false },
  { text: "we", script: false },
  { text: "create", script: false },
  { text: "is", script: false },
  { text: "made", script: false },
  { text: "with", script: false },
  { text: "love", script: true },
  { text: "and", script: false },
  { text: "quiet", script: false },
  { text: "detail.", script: false },
];

const STORY_NOTES = [
  {
    year: "2018",
    text: "Started with a love for meaningful cards and refined details.",
  },
  {
    year: "2021",
    text: "Designed more thoughtful pieces for weddings, gifts, and memories.",
  },
  {
    year: "Today",
    text: "Still creating every design with care, patience, and purpose.",
  },
];

export default function AboutHero() {
  const sectionRef = useRef(null);
  const cardRef = useRef(null);

  const [isVisible, setIsVisible] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const fallback = window.setTimeout(() => {
      setIsVisible(true);
    }, 160);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          window.clearTimeout(fallback);
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(section);

    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
    };
  }, []);

  const handlePointerMove = (event) => {
    if (event.pointerType === "touch") return;

    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;

    setTilt({
      x: x * 7,
      y: y * -7,
    });
  };

  const handlePointerLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  const handleContinueStory = (event) => {
    event.preventDefault();

    const storySection = document.getElementById("about-story");
    if (!storySection) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    storySection.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
    window.history.replaceState(null, "", "#about-story");
  };

  return (
    <section
      ref={sectionRef}
      className="lg:sticky lg:top-0 z-0 overflow-hidden bg-[#f8f6f1] text-[#303839] [font-family:var(--font-about-body)]"
      style={{
        "--font-about-display": "var(--font-cormorant), serif",
        "--font-about-body": "var(--font-montserrat), var(--font-inter), sans-serif",
        "--font-about-script": "var(--font-caveat), cursive",
      } as any}
    >
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        <div className="absolute left-[-12rem] top-[-12rem] h-[26rem] w-[26rem] rounded-full border border-[#E6E6E6]/20" />
        <div className="absolute bottom-[-14rem] right-[-14rem] h-[32rem] w-[32rem] rounded-full border border-[#303839]/10" />
        <div className="absolute left-[8%] top-[20%] h-2 w-2 rounded-full bg-[#E6E6E6]/45" />
        <div className="absolute right-[12%] top-[70%] h-3 w-3 rounded-full bg-[#303839]/15" />
      </div>

      <div className="relative z-10 mx-auto grid min-h-[65vh] w-full max-w-6xl items-center gap-[clamp(1rem,2.4vh,1.8rem)] px-6 py-[clamp(1rem,2.4vh,1.8rem)] lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
        <div>
          <p className="mb-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.24em] text-[#303839]/60">
            <span
              aria-hidden="true"
              className={`h-px bg-[#303839] transition-all duration-700 ${isVisible ? "w-9" : "w-0"
                }`}
            />
            About Husnalogy
          </p>

          <h1 className="[font-family:var(--font-about-display)] max-w-[640px] text-[clamp(1.25rem,0.95rem+2vw,2.45rem)] font-medium leading-[1.07] tracking-[-0.02em] text-[#303839]">
            {HEADLINE_WORDS.map((word, index) => (
              <span
                key={`${word.text}-${index}`}
                className={`mr-[0.22em] inline-block overflow-hidden align-baseline ${word.script ? "px-[0.12em] py-[0.08em] -mx-[0.04em] -my-[0.08em]" : ""
                  }`}
              >
                <span
                  className={`inline-block transition-all duration-700 ease-out ${isVisible
                      ? "translate-y-0 opacity-100"
                      : "translate-y-[115%] opacity-0"
                    } ${word.script
                      ? "relative -top-[0em] [font-family:var(--font-about-script)] text-[1.02em] font-semibold leading-none text-[#303839]/75"
                      : ""
                    }`}
                  style={{
                    transitionDelay: `${120 + index * 45}ms`,
                  }}
                >
                  {word.text}
                </span>
              </span>
            ))}
          </h1>
          <p
            className={`mt-[clamp(0.9rem,2vh,1.35rem)] max-w-[560px] text-[15px] font-light leading-7 text-[#303839]/68 transition-all duration-700 sm:text-base ${isVisible
              ? "translate-y-0 opacity-100"
              : "translate-y-4 opacity-0"
              }`}
            style={{ transitionDelay: "720ms" }}
          >
            Husnalogy is a refined design studio for wedding invitations,
            meaningful cards, personalized gifts, and elegant stationery. Every
            piece is created to feel calm, personal, and beautifully remembered.
          </p>

          <a
            href="#about-story"
            onClick={handleContinueStory}
            className={`group mt-[clamp(1rem,2.4vh,1.65rem)] inline-flex items-center gap-2.5 rounded-none border border-[#303839]/80 px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#303839] transition-all duration-700 hover:bg-[#303839] hover:text-[#f8f6f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E6E6E6] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f8f6f1] ${isVisible
              ? "translate-y-0 opacity-100"
              : "translate-y-4 opacity-0"
              }`}
            style={{ transitionDelay: "900ms" }}
          >
            <span>Continue Our Story</span>

            <RightArrowIcon className="group-hover:translate-x-1" />
          </a>
        </div>

        <Float amplitude={12} duration={7000}>
          <div
            className="relative flex flex-col items-center [perspective:1000px]"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          >
          <div
            ref={cardRef}
            className={`relative aspect-[5/3.35] w-[min(82vw,310px)] rounded-none border border-[#303839]/12 bg-[#f8f6f1] shadow-[0_34px_80px_-38px_rgba(48,56,57,0.75),inset_0_1px_0_rgba(255,255,255,0.7)] transition-all duration-700 ${isVisible
              ? "translate-y-0 opacity-100"
              : "translate-y-8 opacity-0"
              }`}
            style={{
              transform: `rotate(-3deg) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg)`,
              transitionDelay: "520ms",
            }}
          >
            <div className="absolute inset-[10px] rounded-none border border-[#E6E6E6]/24" />

            <div className="absolute inset-0 flex flex-col justify-center px-8 py-7">
              <span className="mb-5 block h-px w-16 bg-[#E6E6E6]/70" />

              <p className="[font-family:var(--font-about-display)] text-3xl italic leading-none text-[#303839]">
                Husnalogy
              </p>

              <div className="space-y-3 mt-7">
                <span className="block h-px w-[78%] bg-[#303839]/13" />
                <span className="block h-px w-[58%] bg-[#303839]/13" />
                <span className="block h-px w-[42%] bg-[#303839]/13" />
              </div>
            </div>

            <div
              aria-hidden="true"
              className={`absolute -bottom-7 -right-7 flex h-[88px] w-[88px] items-center justify-center rounded-full bg-[#303839] p-3 shadow-[0_18px_34px_rgba(48,56,57,0.32)] transition-all duration-700 ease-out ${isVisible
                ? "translate-y-0 rotate-0 scale-100 opacity-100"
                : "-translate-y-12 rotate-[-14deg] scale-150 opacity-0"
                }`}
              style={{ transitionDelay: "1050ms" }}
            >
              <div className="flex items-center justify-center w-full h-full rounded-full">
                <span>
                  <img src="/Brand Kit/Logo-1.png" alt="logo" className="object-contain w-full h-full rounded-full" />
                </span>
              </div>
            </div>
          </div>

          <svg
            className="mt-1 h-[clamp(1.5rem,4vh,3rem)] w-[min(82vw,310px)] overflow-visible"
            viewBox="0 0 360 160"
            aria-hidden="true"
          >
            <path
              d="M180 0 C105 32, 255 48, 135 86 S245 130, 180 158"
              fill="none"
              stroke="#303839"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="5 9"
              className="opacity-40 transition-all duration-[1400ms] ease-out"
              style={{
                strokeDashoffset: isVisible ? 0 : 260,
                transitionDelay: "720ms",
              }}
            />
          </svg>

          <div className="-mt-1 flex w-[min(82vw,310px)] flex-col gap-[clamp(0.3rem,0.8vh,0.5rem)]">
            {STORY_NOTES.map((note, index) => {
              const rotation =
                index === 0 ? "-1.2deg" : index === 1 ? "1deg" : "-0.6deg";

              return (
                <div
                  key={note.year}
                  className={`flex items-baseline gap-3 rounded-none border border-[#303839]/10 bg-[#f8f6f1] px-4 py-[clamp(0.32rem,0.8vh,0.5rem)] shadow-[0_16px_26px_-22px_rgba(48,56,57,0.65)] transition-all duration-700 ${isVisible
                    ? "translate-y-0 opacity-100"
                    : "translate-y-5 opacity-0"
                    }`}
                  style={{
                    rotate: rotation,
                    transitionDelay: `${1100 + index * 180}ms`,
                  }}
                >
                  <span className="[font-family:var(--font-about-display)] shrink-0 text-[15px] font-semibold text-[#303839]/50">
                    {note.year}
                  </span>

                  <span className="text-[13px] leading-[1.55] text-[#303839]/62">
                    {note.text}
                  </span>
                </div>
              );
            })}
          </div>
          </div>
        </Float>
      </div>
    </section>
  );
}
