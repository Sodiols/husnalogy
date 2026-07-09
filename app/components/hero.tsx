"use client";

import Image from "next/image";

const PROMISES = [
  ["Personalized", "Made to your details"],
  ["Handcrafted", "Premium paper & finish"],
  ["Worldwide", "Shipped with care"],
];

export default function Hero({ spotlight = null }: { spotlight?: any }) {
  const product = spotlight?.product || null;

  const chipLabel = spotlight?.name || "Signature collection";
  const frameImage = spotlight?.image || "/images/heroIMG.png";
  const frameAlt = spotlight?.name
    ? `${spotlight.name} — featured collection`
    : "Husnalogy signature wedding invitation suite";

  const primaryHref = spotlight?.href || "/weddings";
  const primaryLabel = spotlight ? "Shop the collection" : "Shop invitations";

  const cardTitle = product?.title || spotlight?.name || "The Classic Suite";
  const cardImage = product?.image || spotlight?.image || "/images/weddings/classic.png";
  const cardHref = product?.href || spotlight?.href || "/weddings";
  const cardMeta =
    product?.price != null
      ? `From $${Number(product.price).toLocaleString()}`
      : spotlight
        ? "View collection"
        : "From $48";

  return (
    <section className="relative isolate overflow-hidden bg-[#f8f6f1]">
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-[#303839]/10" />

      {/* Signature: a quiet vertical brand rail on the far edge. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-5 top-1/2 hidden -translate-y-1/2 rotate-180 text-[10px] font-semibold uppercase tracking-[0.42em] text-[#303839]/35 [writing-mode:vertical-rl] xl:inline-block"
      >
        Husnalogy — Timeless by design
      </span>

      <div className="relative mx-auto flex h-[120vh] max-w-[1480px] flex-col justify-center gap-8 px-4 pb-20 pt-4 sm:px-6 lg:grid lg:h-[85vh] lg:items-center lg:gap-16 lg:px-10 lg:py-0 lg:grid-cols-[1.02fr_0.98fr]">
        {/* Thesis */}
        <div className="order-2 max-w-[560px] lg:order-none">
          <p className="hero-rise flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.32em] text-[#303839]/55">
            Wedding invitations &middot; curated gifts
          </p>

          <h1
            className="hero-rise mt-4 font-body text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-[#303839] sm:text-[34px] md:text-[40px] lg:mt-6 lg:text-[40px] lg:leading-[1.08] xl:text-[44px] 2xl:text-[50px]"
            style={{ animationDelay: "80ms" }}
          >
            Made for the moments
            <br />
            <span className="font-normal">worth keeping.</span>
          </h1>

          <p
            className="hero-rise mt-4 max-w-[440px] text-[14px] leading-[1.7] text-[#303839]/70 sm:text-[15px] sm:leading-[1.85] lg:mt-6"
            style={{ animationDelay: "150ms" }}
          >
            Thoughtfully designed invitations and gifts, personalized to
            celebrate the people and milestones that matter most.
          </p>

          <div
            className="hero-rise mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4 lg:mt-9"
            style={{ animationDelay: "230ms" }}
          >
            <a
              href={primaryHref}
              className="group inline-flex h-[50px] items-center justify-center gap- rounded-[6px] bg-[#303839] px-8 text-[10.5px] font-semibold uppercase tracking-[0.24em] text-white transition-colors duration-300 hover:bg-[#1f2627]"
            >
              {primaryLabel}
              <span
                aria-hidden="true"
                className="inline-flex transition-transform duration-300 ease-out group-hover:translate-x-1"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <path d="M4 12h15" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
            </a>
            <a
              href="/gifts"
              className="inline-flex h-[50px] items-center justify-center rounded-[6px] border border-[#303839]/20 px-8 text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[#303839] transition-colors duration-300 hover:border-[#303839] hover:bg-[#303839] hover:text-white"
            >
              Explore gifts
            </a>
          </div>

          {/* Serif micro trust-row — brand promises, not invented stats. */}
          <dl
            className="hero-rise mt-11 hidden flex-wrap items-center gap-x-9 gap-y-5 border-t border-[#303839]/10 pt-7 lg:flex"
            style={{ animationDelay: "300ms" }}
          >
            {PROMISES.map(([term, desc]) => (
              <div key={term} className="min-w-[112px]">
                <dt className="font-body text-[19px] leading-none text-[#303839]">{term}</dt>
                <dd className="mt-1.5 text-[11px] uppercase tracking-[0.14em] text-[#303839]/50">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Signature: framed, shoppable product image. */}
        <div
          className="hero-rise relative order-1 mx-auto w-full max-w-[380px] lg:order-none lg:max-w-[520px]"
          style={{ animationDelay: "180ms" }}
        >
          <div className="relative rounded-[10px] bg-[#ece9e1] p-3 shadow-[0_30px_90px_rgba(48,56,57,0.14)]">
            <div className="relative h-[34vh] w-full overflow-hidden rounded-[6px] sm:h-[40vh] lg:h-[64vh]">
              <Image
                src={frameImage}
                alt={frameAlt}
                fill
                priority
                sizes="(min-width: 1024px) 520px, 90vw"
                className="object-cover object-center transition-transform duration-[1400ms] ease-out hover:scale-[1.04]"
              />
            </div>
            <span className="absolute left-6 top-6 max-w-[70%] truncate rounded-[6px] bg-[#303839] px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-white">
              {chipLabel}
            </span>
          </div>

          {/* Floating "shop this" card — the ecommerce moment. */}
          <a
            href={cardHref}
            className="group absolute -bottom-5 -left-4 flex w-[264px] items-center gap-3.5 rounded-[12px] border border-[#303839]/10 bg-white/95 p-2.5 backdrop-blur-sm transition-colors duration-300 hover:border-[#303839]/25 sm:-left-8"
          >
            <div className="relative h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[9px] bg-[#f8f6f1]">
              <Image
                src={cardImage}
                alt=""
                fill
                sizes="54px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#303839]/45">Featured</p>
              <p className="mt-1 truncate text-[14px] font-semibold leading-tight text-[#303839]">{cardTitle}</p>
              <p className="mt-0.5 text-[11px] font-medium text-[#303839]/55">{cardMeta}</p>
            </div>
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#303839]/15 text-[#303839] transition-colors duration-300 group-hover:border-[#303839] group-hover:bg-[#303839] group-hover:text-white"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                <path d="M5 12h13" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
