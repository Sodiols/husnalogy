export default function MaintenanceScreen({ storeName = "Husnalogy", storeTagline = "" }: { storeName?: string; storeTagline?: string }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f8f6f1] text-[#303839]">
      {/* Soft brand circle */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[min(94vw,620px)] w-[min(94vw,620px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ece9e1]/60"
      />

      {/* Unplugged cable — the signature element */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[71%] flex items-center">
        <span className="h-[9px] flex-1 border-y-2 border-[#303839]/85" />
        <MalePlug />
        <span className="w-4 sm:w-8" />
        <FemalePlug />
        <span className="h-[9px] flex-1 border-y-2 border-[#303839]/85" />
      </div>

      {/* Content */}
      <div className="absolute inset-x-0 top-[42%] flex -translate-y-1/2 flex-col items-center px-5 text-center">
        <div className="w-full max-w-[560px]">
          <span className="mx-auto grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-white shadow-[0_10px_30px_rgba(48,56,57,0.08)] ring-1 ring-[#303839]/8 sm:h-24 sm:w-24">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/Brand Kit/Logo-2.png"
              alt={storeName}
              className="h-12 w-12 object-contain sm:h-14 sm:w-14"
            />
          </span>
          {storeTagline ? (
            <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#303839]/50">{storeTagline}</p>
          ) : null}
          <h1 className="mt-6 font-display text-[2rem] font-medium leading-[1.1] text-[#303839] sm:text-[2.6rem]">
            We&rsquo;re updating the store
          </h1>
          <p className="mx-auto mt-4 max-w-[420px] text-sm leading-7 text-[#303839]/65">
            We&rsquo;re preparing something beautiful. Please return soon or contact Husnalogy if you need help with an existing order.
          </p>
          <a href="/contact" className="mt-8 inline-flex border-b border-[#303839] pb-1 text-xs font-bold uppercase tracking-[0.16em]">Contact Husnalogy</a>
        </div>
      </div>
    </main>
  );
}

/* Left (male) plug facing right, monochrome brand ink. */
function MalePlug() {
  return (
    <svg width="66" height="54" viewBox="0 0 66 54" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="13" width="40" height="28" rx="8" fill="#f8f6f1" stroke="#303839" strokeWidth="2.5" />
      <rect x="41" y="20" width="9" height="14" rx="2" fill="#f8f6f1" stroke="#303839" strokeWidth="2.5" />
      <rect x="50" y="20" width="14" height="4.5" rx="2.25" fill="#303839" />
      <rect x="50" y="29.5" width="14" height="4.5" rx="2.25" fill="#303839" />
    </svg>
  );
}

/* Right (female) connector facing left. */
function FemalePlug() {
  return (
    <svg width="66" height="54" viewBox="0 0 66 54" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="22" y="11" width="42" height="32" rx="10" fill="#f8f6f1" stroke="#303839" strokeWidth="2.5" />
      <rect x="14" y="19" width="10" height="16" rx="3" fill="#f8f6f1" stroke="#303839" strokeWidth="2.5" />
      <rect x="34" y="20" width="4.5" height="5" rx="1.5" fill="#303839" />
      <rect x="34" y="29" width="4.5" height="5" rx="1.5" fill="#303839" />
    </svg>
  );
}
