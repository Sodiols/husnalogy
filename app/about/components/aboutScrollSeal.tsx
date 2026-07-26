"use client";

import { useEffect, useState } from "react";

export default function AboutScrollSeal() {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;

      setPercent(
        docHeight > 0 ? Math.min(Math.max(scrollTop / docHeight, 0), 1) : 0
      );
    };

    onScroll();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent);

  return (
    <div
      className="fixed z-50 hidden bottom-6 left-6 h-14 w-14 md:block"
      aria-hidden="true"
    >
      <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="#303839"
          stroke="#1E352C"
          strokeWidth="2"
        />

        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke="#E6E6E6"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>

      <span className="absolute inset-0 flex items-center justify-center font-display text-lg italic text-[#f8f6f1]">
        H
      </span>
    </div>
  );
}