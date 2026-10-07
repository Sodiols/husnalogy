"use client";

import { useInView } from "../hooks/useInView";

/**
 * A short, quiet rise as content enters the viewport — the same easing as the
 * home hero (`hero-rise`). Reduced-motion visitors see content immediately.
 */
export default function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
  ...rest
}: any) {
  const [ref, inView] = useInView(0.15);

  return (
    <Tag
      ref={ref}
      className={`transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        inView
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100"
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
