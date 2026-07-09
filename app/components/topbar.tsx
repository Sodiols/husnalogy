"use client";

import RightArrowIcon from "./RightArrowIcon";

export default function TopBar() {
  return (
    <div className="bg-charcoal text-white">
      <div className="mx-auto flex max-w-[1480px] items-center justify-center px-4 py-2 text-center text-[10.5px] font-medium uppercase tracking-[0.18em] sm:px-6 lg:justify-between lg:px-10">
        <div className="hidden items-center gap-6 text-white/75 lg:flex">
          <span>Husnalogy</span>
          <span aria-hidden="true" className="h-3 w-px bg-white/25" />
          <span>Premium Design</span>
          <span aria-hidden="true" className="h-3 w-px bg-white/25" />
          <span>Personalized Gifts</span>
        </div>

        <p className="text-white/90">
          Elegant cards, gifts and stationery crafted with intention
        </p>

        <a
          href="/products"
          className="group hidden items-center gap-2 text-white underline-offset-4 transition hover:underline lg:inline-flex"
        >
          Shop Now
          <RightArrowIcon className="group-hover:translate-x-1" />
        </a>
      </div>
    </div>
  );
}
