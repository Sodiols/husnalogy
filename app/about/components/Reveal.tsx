"use client";

import { useInView } from "../hooks/useInView";

export default function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: any) {
  const [ref, inView] = useInView(0.2);

  return (
    <Tag
      ref={ref}
      className={`transition-all duration-700 ease-out motion-reduce:transition-opacity motion-reduce:duration-300 ${
        inView
          ? "translate-y-0 opacity-100"
          : "translate-y-8 opacity-0 motion-reduce:translate-y-0"
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}