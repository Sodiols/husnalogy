"use client";

// Visual layer of the customer-side protection: a subtle repeated watermark
// over the design workspace, a full cover when the window loses focus or a
// screenshot/print is detected, and print-only CSS that hides the artwork.
// The watermark lives in HTML (never inside the SVG), so exports, thumbnails,
// and admin order downloads are always clean.

const WATERMARK_TEXT = "HUSNALOGY PROTECTED PREVIEW";

const watermarkTile = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><text x="180" y="120" text-anchor="middle" transform="rotate(-24 180 120)" font-family="Arial, sans-serif" font-size="17" letter-spacing="3" fill="#303839" fill-opacity="0.075">${WATERMARK_TEXT}</text></svg>`,
);

export function CustomizerWatermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 print:hidden"
      style={{
        backgroundImage: `url("data:image/svg+xml,${watermarkTile}")`,
        backgroundRepeat: "repeat",
      }}
    />
  );
}

export default function CustomizerProtectionOverlay({ covered }: { covered: boolean }) {
  return (
    <>
      {/* Full cover while the tab is hidden, unfocused, printing, or a
          PrintScreen press was detected. */}
      {covered && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#F8F6F1] print:hidden">
          <div className="px-6 text-center">
            <p className="font-display text-2xl text-[#303839]">Protected preview</p>
            <p className="mt-2 text-sm text-[#303839]/60">
              Your design is hidden while the window is inactive.
            </p>
          </div>
        </div>
      )}

      {/* Print-only replacement (the print CSS below hides the editor). */}
      <div className="cz-print-notice hidden">
        <p style={{ fontFamily: "Georgia, serif", fontSize: 22, color: "#303839", padding: 48, textAlign: "center" }}>
          Protected preview. Copying, downloading, and printing are disabled.
        </p>
      </div>

      <style
        // Plain style tag (not styled-jsx) so it works in any rendering mode.
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  [data-customizer-root] [data-customizer-protected] { display: none !important; }
  [data-customizer-root] .cz-print-notice { display: block !important; }
}
[data-customizer-protected] {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
[data-customizer-protected] input,
[data-customizer-protected] textarea,
[data-customizer-protected] select {
  -webkit-user-select: text;
  user-select: text;
}
[data-customizer-protected] img,
[data-customizer-protected] svg image {
  -webkit-user-drag: none;
}
`,
        }}
      />
    </>
  );
}
