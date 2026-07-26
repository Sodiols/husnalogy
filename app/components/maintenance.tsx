"use client";

import { useState } from "react";

export default function MaintenanceScreen({ storeName = "Husnalogy", storeTagline = "" }: { storeName?: string; storeTagline?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ loading: false, success: "", error: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, success: "", error: "" });

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "maintenance notify" }),
      });
      const data = await response.json();

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Subscription failed.");
      }

      setEmail("");
      setStatus({ loading: false, success: "Thank you — we'll email you the moment we're back.", error: "" });
    } catch (error) {
      setStatus({ loading: false, success: "", error: error.message || "Something went wrong." });
    }
  };

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
            We&rsquo;re preparing something beautiful. Leave your email and we&rsquo;ll let you know the
            moment we&rsquo;re back.
          </p>

          <form onSubmit={handleSubmit} className="relative mx-auto mt-8 flex w-full max-w-[420px] items-center">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email address"
              required
              aria-label="Email address"
              className="w-full border-b border-[#303839]/25 bg-transparent py-2.5 pl-0 pr-[116px] text-sm text-[#303839] outline-none transition placeholder:text-[#303839]/45 focus:border-[#303839]"
            />
            <button
              type="submit"
              disabled={status.loading}
              className="absolute right-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#303839] transition-colors duration-300 hover:text-black disabled:opacity-60"
            >
              {status.loading ? "Sending..." : "Notify me!"}
            </button>
          </form>

          <div className="mt-3 min-h-[18px]" aria-live="polite">
            {status.success && <p className="text-xs font-semibold text-[#303839]">{status.success}</p>}
            {status.error && <p className="text-xs font-semibold text-red-600">{status.error}</p>}
          </div>
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
