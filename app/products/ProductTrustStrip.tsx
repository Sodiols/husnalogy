"use client";

import { useEffect, useState } from "react";

/**
 * ProductTrustStrip
 * The reassurance block Zazzle shows directly beneath the buy box:
 * an estimated delivery window, returns policy, and a satisfaction guarantee.
 *
 * The delivery window is computed from the current date on the client (so it
 * stays accurate without an SSR/CSR hydration mismatch). Copy is intentionally
 * generic placeholder text — adjust the policy wording to your real terms.
 */
function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;

  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }

  return result;
}

function formatDeliveryWindow(start, end) {
  const sameMonth = start.getMonth() === end.getMonth();
  const month = { month: "short" };
  const startLabel = start.toLocaleDateString("en-US", month);
  const endLabel = end.toLocaleDateString("en-US", month);

  if (sameMonth) {
    return `${startLabel} ${start.getDate()} – ${end.getDate()}`;
  }

  return `${startLabel} ${start.getDate()} – ${endLabel} ${end.getDate()}`;
}

function TrustRow({ icon, title, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E6E6E6] text-[#303839]">
        <i className={`fa-solid ${icon} text-[13px]`} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-5">{title}</p>
        <p className="text-sm leading-5 text-[#303839]/65">{value}</p>
      </div>
    </div>
  );
}

export default function ProductTrustStrip({ className = "" }) {
  const [deliveryWindow, setDeliveryWindow] = useState("");

  useEffect(() => {
    const now = new Date();
    const start = addBusinessDays(now, 5);
    const end = addBusinessDays(now, 9);
    setDeliveryWindow(formatDeliveryWindow(start, end));
  }, []);

  return (
    <div
      className={`space-y-4 rounded-none bg-white px-5 py-5 text-[#303839] ${className}`}
    >
      <TrustRow
        icon="fa-truck-fast"
        title="Estimated delivery"
        value={
          deliveryWindow
            ? `Arrives ${deliveryWindow} with standard shipping`
            : "Calculating your delivery window…"
        }
      />
      <TrustRow
        icon="fa-rotate-left"
        title="Easy returns"
        value="30-day return policy on every order"
      />
      <TrustRow
        icon="fa-shield-heart"
        title="100% satisfaction guarantee"
        value="Love it, or we'll make it right"
      />
    </div>
  );
}
