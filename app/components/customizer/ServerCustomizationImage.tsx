"use client";

import { useEffect, useState } from "react";

export default function ServerCustomizationImage({ customizationId, outputPageId, fallbackSrc, alt, className = "h-full w-full object-cover", containerClassName = "relative overflow-hidden bg-[#F8F6F1]" }: any) {
  const [src, setSrc] = useState(fallbackSrc || "/images/weddings.png");
  const [loading, setLoading] = useState(Boolean(customizationId));

  useEffect(() => {
    setSrc(fallbackSrc || "/images/weddings.png");
    if (!customizationId) { setLoading(false); return; }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    const loadServerPreview = async () => {
      try {
        const response = await fetch("/api/customizer/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customizationId, jobType: "mockup" }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (cancelled || !response.ok || payload.ok === false) return;

        const output = (payload.outputs || []).find((candidate: any) => candidate.pageId === outputPageId)
          || (payload.outputs || []).find((candidate: any) => String(candidate.pageId || "").startsWith("mockup:"));
        if (output?.signedUrl) setSrc(output.signedUrl);
      } catch (requestError) {
        if (!cancelled && !controller.signal.aborted && (requestError as Error)?.name !== "AbortError") {
          // Keep the supplied fallback image when the optional server preview cannot be loaded.
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadServerPreview();
    return () => {
      cancelled = true;
      if (!controller.signal.aborted) controller.abort();
    };
  }, [customizationId, fallbackSrc, outputPageId]);

  return (
    <div className={containerClassName} aria-busy={loading}>
      <img src={src} alt={alt || "Personalized product"} className={className} />
      {loading && <span className="absolute bottom-2 right-2 h-2.5 w-2.5 animate-pulse rounded-full bg-[#D4AF37]" aria-label="Updating personalized preview" />}
    </div>
  );
}
