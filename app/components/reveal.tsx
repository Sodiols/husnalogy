"use client";

/**
 * Reveal
 * Scroll-reveal animation is intentionally disabled site-wide — only the About
 * page animates on scroll, and it uses its own local Reveal / useInView. This
 * wrapper renders its children immediately (no fade or lift) while keeping the
 * same props so existing callers continue to work unchanged.
 */
export default function Reveal({
  children,
  as: Tag = "div",
  // Animation props are accepted but ignored so callers don't need to change.
  delay,
  y,
  once,
  className = "",
  ...rest
}: any) {
  return (
    <Tag className={className} {...rest}>
      {children}
    </Tag>
  );
}
