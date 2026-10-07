import Image from "next/image";
import Link from "next/link";

import Reveal from "./Reveal";

export default function AboutClosing() {
  return (
    <section aria-label="A note from the studio" className="bg-ink text-white">
      <div className="page-container section">
        <Reveal className="mx-auto flex max-w-[760px] flex-col items-center text-center">
          <span className="relative h-16 w-16 overflow-hidden rounded-full ring-1 ring-white/20">
            <Image src="/Brand Kit/Logo-1.png" alt="" fill sizes="64px" className="object-cover" />
          </span>

          <p className="eyebrow mt-8 text-white/70">A note from the studio</p>

          <blockquote className="mt-6font-display text-[clamp(1.85rem,1.3rem+2.2vw,3rem)] font-medium italic leading-[1.15] text-white [text-wrap:balance]">
            &ldquo;Your wedding happens once. We make sure the paper trail is worth keeping.&rdquo;
          </blockquote>

          <p className="mt-6 text-[15px] text-white/75">Team Husnalogy</p>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href="/products" className="btn btn-lg border-white bg-white text-ink hover:bg-cream">
              Start personalizing
            </Link>
            <Link href="/contact" className="btn btn-lg border-white/40 bg-transparent text-white hover:border-white hover:bg-white/10">
              Contact the studio
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
