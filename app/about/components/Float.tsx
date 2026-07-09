"use client";

import { useEffect, useRef } from "react";

/**
 * Float
 * Wraps children in a gentle, continuous vertical drift — ambient motion
 * that makes a decorative element feel alive without distracting.
 *
 * Uses the Web Animations API (no global CSS / keyframes), and fully honours
 * `prefers-reduced-motion` by skipping the animation entirely.
 *
 * Because the drift is applied to this wrapper, it composes cleanly with any
 * transforms on the children (e.g. a 3D tilt or an entrance transition) instead
 * of overriding them.
 *
 * Props:
 *  - amplitude : peak vertical travel in px (default 9)
 *  - duration  : one full up-down cycle in ms (default 7000)
 *  - delay     : start delay in ms (default 0)
 *  - as        : element/tag to render (default "div")
 *  - className : passthrough classes
 */
export default function Float({
  children,
  className = "",
  amplitude = 9,
  duration = 7000,
  delay = 0,
  as: Tag = "div",
}: any) {
  const ref = useRef<any>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof node.animate !== "function") return undefined;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (reduceMotion) return undefined;

    const animation = node.animate(
      [
        { transform: "translateY(0px)" },
        { transform: `translateY(-${amplitude}px)` },
        { transform: "translateY(0px)" },
      ],
      {
        duration,
        delay,
        iterations: Infinity,
        easing: "ease-in-out",
      }
    );

    return () => animation.cancel();
  }, [amplitude, duration, delay]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
