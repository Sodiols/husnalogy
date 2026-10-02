import Link from "next/link";

export default function TopBar() {
  return (
    <div className="bg-ink text-white">
      <div className="page-container flex min-h-9 items-center justify-center gap-4 py-2 text-center text-[13px] leading-5">
        <p className="text-white/90">Personalized invitations, cards and gifts for life&rsquo;s meaningful occasions</p>
        <Link
          href="/products"
          className="hidden shrink-0 font-semibold text-white underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-white md:inline"
        >
          Shop all
        </Link>
      </div>
    </div>
  );
}
