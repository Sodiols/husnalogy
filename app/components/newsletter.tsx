"use client";

import { useState } from "react";

import Reveal from "./reveal";

export default function Newsletter() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ loading: false, success: "", error: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, success: "", error: "" });

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "newsletter section" }),
      });
      const data = await response.json();

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Subscription failed.");
      }

      setEmail("");
      setStatus({ loading: false, success: "Subscribed successfully.", error: "" });
    } catch (error) {
      setStatus({ loading: false, success: "", error: error.message || "Something went wrong." });
    }
  };

  return (
    <section className="bg-white px-4 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-24">
      <Reveal className="mx-auto max-w-[1480px]">
        <div className="rounded-none border border-[#303839]/5 bg-[#f8f6f1] px-5 py-12 sm:px-12 sm:py-14 lg:px-16 lg:py-16">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-16">
            {/* Left */}
            <div className="text-center lg:text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/50">
                Stay Inspired
              </p>
              <h2 className="mx-auto mt-4 max-w-[520px] font-display text-[2rem] font-medium leading-[1.12] text-[#303839] sm:text-[2.5rem] lg:mx-0 lg:text-[2.75rem]">
                Receive thoughtful
                <br className="hidden sm:block" /> updates from Husnalogy
              </h2>
              <p className="mx-auto mt-5 max-w-[440px] text-[15px] leading-[1.75] text-[#303839]/70 lg:mx-0">
                Be the first to discover new wedding invitations, meaningful gifts, and refined
                stationery created for life&rsquo;s special moments.
              </p>
            </div>

            {/* Right */}
            <div className="lg:border-l lg:border-[#303839]/12 lg:pl-16">
              <form
                onSubmit={handleSubmit}
                className="relative mx-auto flex w-full max-w-[420px] items-center lg:mx-0"
              >
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your email address"
                  required
                  className="w-full border-b border-[#303839]/25 bg-transparent py-2 pr-24 text-sm text-[#303839] outline-none transition placeholder:text-[#303839]/45 focus:border-[#303839]"
                />
                <button
                  type="submit"
                  disabled={status.loading}
                  className="absolute right-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#303839] transition hover:text-black disabled:opacity-60"
                >
                  {status.loading ? "Saving..." : "Subscribe"}
                </button>
              </form>

              <p className="mt-4 flex items-center justify-center gap-2 text-xs text-[#303839]/55 lg:justify-start">
                <svg
                  className="h-4 w-4 shrink-0 text-[#303839]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                No spam. Only meaningful updates from Husnalogy.
              </p>

              {status.success && (
                <p className="mt-2 text-center text-xs font-semibold text-green-700 lg:text-left">
                  {status.success}
                </p>
              )}
              {status.error && (
                <p className="mt-2 text-center text-xs font-semibold text-red-600 lg:text-left">
                  {status.error}
                </p>
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
