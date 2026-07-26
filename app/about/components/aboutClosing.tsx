"use client";

import { useInView } from "../hooks/useInView";

export default function AboutClosing() {
  const [ref, show] = useInView(0.3);

  const ease =
    "transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-opacity motion-reduce:duration-300";

  return (
    <section
      ref={ref}
      className="lg:sticky lg:top-0 z-[6] flex min-h-[65svh] flex-col items-center justify-center overflow-hidden border-t border-[#303839]/8 bg-[#f8f6f1] px-6 py-[clamp(2.5rem,7vh,6rem)]"
    >
      {/* Soft neutral glow for depth */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(58% 58% at 50% 36%, rgba(255,255,255,0.9), transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_-10%,transparent_55%,rgba(48,56,57,0.05))]"
      />

      <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center text-center">
        {/* Logo in a soft gold ring */}
        <div
          className={`${ease} relative grid h-[clamp(4rem,8vw,5.5rem)] w-[clamp(4rem,8vw,5.5rem)] place-items-center rounded-full ${
            show ? "scale-100 opacity-100" : "scale-90 opacity-0"
          }`}
          style={{ transitionDelay: "0ms" }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-white/70 blur-xl"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border border-[#303839]/20"
          />
          <img
            src="/Brand Kit/logo-2.png"
            alt="Husnalogy"
            className="relative h-[78%] w-[78%] rounded-full object-contain"
          />
        </div>

        {/* Eyebrow */}
        <p
          className={`${ease} mt-[clamp(1.25rem,3vh,2rem)] text-[11px] font-semibold uppercase tracking-[0.34em] text-[#303839]/55 ${
            show ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          }`}
          style={{ transitionDelay: "140ms" }}
        >
          A note from the studio
        </p>

        {/* Gold divider draws in from the centre */}
        <span
          aria-hidden="true"
          className={`mt-5 block h-px w-20 origin-center bg-gradient-to-r from-transparent via-[#303839]/45 to-transparent transition-transform duration-[1000ms] ease-out ${
            show ? "scale-x-100" : "scale-x-0"
          }`}
          style={{ transitionDelay: "280ms" }}
        />

        {/* Quote */}
        <blockquote
          className={`${ease} relative mt-[clamp(1.25rem,3vh,2rem)] font-display text-[clamp(1.6rem,1.1rem+2.4vw,2.6rem)] italic leading-[1.18] text-[#303839] ${
            show ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
          }`}
          style={{ transitionDelay: "420ms" }}
        >
          <span
            aria-hidden="true"
            className="absolute -top-7 left-1/2 -translate-x-1/2 select-none font-display text-6xl not-italic leading-none text-[#303839]/15 sm:-left-6 sm:translate-x-0"
          >
            &ldquo;
          </span>
          Your wedding happens once.
          <br />
          We make sure the paper trail is worth keeping.
        </blockquote>

        {/* Handwritten signature */}
        <p
          className={`${ease} mt-[clamp(1.5rem,4vh,2.5rem)] [font-family:var(--font-caveat)] text-[clamp(1.6rem,1.2rem+1.2vw,2.1rem)] text-[#303839]/85 ${
            show ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
          style={{ transitionDelay: "600ms" }}
        >
          — Team Husnalogy
        </p>
      </div>
    </section>
  );
}
