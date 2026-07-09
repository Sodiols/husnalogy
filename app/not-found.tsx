import Link from "next/link";

export const metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="relative overflow-hidden bg-transparent px-4 py-10 sm:px-6 lg:px-10 lg:py-12">
      <div className="mx-auto flex min-h-[74vh] max-w-[1480px] flex-col">
        {/* Top: return path + quiet apology */}
        <div className="flex items-start justify-between gap-4">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#303839] transition-colors duration-300 hover:text-black"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Go back to the site
          </Link>

          <p className="max-w-[180px] text-right text-[10px] font-semibold uppercase leading-5 tracking-[0.22em] text-[#303839]/45">
            Oops! We can&rsquo;t find that page.
          </p>
        </div>

        {/* Transparent, outlined 404 sitting to the right */}
        <div className="pointer-events-none relative flex flex-1 items-center justify-end">
          <span
            aria-hidden="true"
            className="select-none font-body font-extrabold leading-[0.8] tracking-tight text-transparent [-webkit-text-stroke:1.5px_rgba(48,56,57,0.28)]"
            style={{ fontSize: "min(42vw, 30rem)" }}
          >
            404
          </span>
        </div>

        {/* Bottom-left: the message + the way out */}
        <div className="mt-auto max-w-[560px]">
          <h1 className="font-body text-4xl font-extrabold uppercase leading-[0.95] tracking-tight text-[#303839] sm:text-5xl lg:text-6xl">
            Not
            <br />
            Found.
          </h1>
          <p className="mt-5 max-w-[420px] text-sm leading-7 text-[#303839]/60">
            The page you&rsquo;re looking for may have moved or no longer exists.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex h-[50px] items-center justify-center rounded-[8px] bg-[#303839] px-8 text-[11px] font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-300 hover:bg-[#434c4d]"
            >
              Back to home
            </Link>
            <Link
              href="/products"
              className="inline-flex h-[50px] items-center justify-center rounded-[8px] border border-[#303839]/25 bg-white/50 px-8 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#303839] transition-colors duration-300 hover:border-[#303839] hover:bg-white"
            >
              Browse products
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
