export default function LinkHoverOverlay() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {/* Quiet veil + inset hairline: signals interactivity without shouting. */}
      <span className="absolute inset-0 rounded-[inherit] bg-[#303839]/10" />
      <span className="absolute inset-2 rounded-[inherit] border border-white/70 sm:inset-3" />
    </span>
  );
}
