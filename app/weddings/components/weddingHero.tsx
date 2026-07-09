import Image from "next/image";

import Reveal from "../../components/reveal";

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
        <Reveal className="w-full max-w-[640px] text-left" y={18}>
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/60">
            <span aria-hidden="true" className="h-px w-10 bg-[#303839]/40" />
            Wedding Collection
          </p>

          <h1 className="mt-6 font-display text-[38px] font-medium leading-[1.04] text-[#303839] sm:text-[48px] lg:text-[56px] xl:text-[62px]">
            Wedding invitations
            <br />
            <em className="font-normal italic">made for your moment.</em>
          </h1>

          <p className="mt-6 max-w-[460px] text-[15px] leading-[1.8] text-[#303839]/70">
            Explore refined wedding invitations, save the dates, RSVP cards, and
            stationery designed to feel personal, timeless, and meaningful.
          </p>

          <div className="mt-10 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
            <a
              href="/collections/wedding-invitations"
              className="inline-flex h-12 items-center justify-center rounded-none bg-[#303839] px-8 text-[11px] font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-300 hover:bg-[#434c4d]"
            >
              Shop Wedding Invitations
            </a>
            <a
              href="/collections/wedding-suites"
              className="inline-flex h-12 items-center justify-center rounded-none border border-[#303839]/30 bg-white/40 px-8 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#303839] backdrop-blur-sm transition-colors duration-300 hover:border-[#303839] hover:bg-white"
            >
              View Wedding Suites
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
