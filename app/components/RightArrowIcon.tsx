export default function RightArrowIcon({ className = "" }: { className?: string }) {
  const safeClassName = className.replace(/\bgroup-hover:translate-x-1\b/g, "").trim();

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      width="11"
      height="11"
      className={`husnalogy-cta-arrow opacity-90 ${safeClassName}`.trim()}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
