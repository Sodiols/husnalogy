import Image from "next/image";
import Link from "next/link";

import Reveal from "../../components/reveal";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F8F6F1]";

export default function WeddingHero() {
  return (
    <section className="relative isolate overflow-hidden bg-[#f8f6f1]">
      <Image
        src="/images/weddings/weddingHeroImg.png"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="100vw"
        className="object-cover object-center md:object-[78%_center] lg:object-[72%_center]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#f8f6f1]/88 via-[#f8f6f1]/45 to-[#f8f6f1]/88 md:bg-gradient-to-r md:from-[#f8f6f1] md:via-[#f8f6f1]/62 md:to-transparent" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-[#303839]/20" />

      <div className="relative mx-auto flex min-h-[70vh] max-w-[1480px] items-center px-4 py-16 sm:px-6 lg:px-10 lg:py-20">
        <Reveal className="w-full max-w-[680px] text-left" y={18}>
          <p className="flex flex-wrap items-center gap-x-2.5 text-[12px] font-semibold tracking-[0.01em]">
            <span className="text-[#303839]">Weddings</span>
            <span className="uppercase tracking-[0.14em] text-[#303839]/45">
              Wedding Collection
            </span>
          </p>

          <h1 className="mt-5 font-body text-[2rem] font-medium leading-[1.05] tracking-[-0.03em] text-[#303839] sm:text-[2.5rem] lg:text-[2.75rem]">
            Wedding invitations
            <br />
            made for your moment.
          </h1>

          <p className="mt-6 max-w-[520px] text-[15px] leading-[1.75] text-[#303839]/75">
            Explore refined wedding invitations, save the dates, RSVP cards, and
            stationery designed to feel personal, timeless, and meaningful.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href="/collections/wedding-invitations"
              className={`inline-flex h-[52px] items-center justify-center rounded-[6px] border border-[#303839] bg-[#F8F6F1] px-8 text-[13px] font-semibold text-[#303839] transition-colors duration-300 hover:bg-[#303839] hover:text-[#F8F6F1] ${focusRing}`}
            >
              Shop Wedding Invitations
            </Link>

            <Link
              href="/collections/wedding-suites"
              className={`group inline-flex items-center gap-2 rounded-[4px] text-[13px] font-semibold text-[#303839] transition-colors duration-300 hover:text-[#303839]/60 ${focusRing}`}
            >
              View Wedding Suites
              <span
                aria-hidden="true"
                className="inline-flex transition-transform duration-300 ease-out group-hover:translate-x-1"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="15"
                  height="15"
                >
                  <path d="M4 12h15" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
