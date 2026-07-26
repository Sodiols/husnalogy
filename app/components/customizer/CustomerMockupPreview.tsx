"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CustomizerPreview from "./CustomizerPreview";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";

type RenderOutput = {
  id: string;
  pageId: string;
  signedUrl: string;
  format: string;
  checksum: string;
};

export default function CustomerMockupPreview({ template, values, editorState, customizationId, saveStatus }: any) {
  const enabled = isCustomizerFeatureEnabled(template, "customizer_v2_mockups");
  const config = template?.mockupTemplates?.[0] || template?.settings?.mockupTemplates?.[0];
  const [viewId, setViewId] = useState(config?.views?.[0]?.id || "");
  const [snapshot, setSnapshot] = useState({ values, editorState });
  const [outputs, setOutputs] = useState<Record<string, RenderOutput>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!config) return;
    const timer = window.setTimeout(() => setSnapshot({ values, editorState }), 350);
    return () => window.clearTimeout(timer);
  }, [config, values, editorState]);

  useEffect(() => {
    if (!enabled || !config || !customizationId || String(customizationId).startsWith("local_")) return;
    if (saveStatus === "saving" || saveStatus === "unsaved") return;
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/customizer/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customizationId, jobType: "mockup" }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not update the product preview.");
        if (sequence !== requestSequence.current) return;
        setOutputs(Object.fromEntries((payload.outputs || []).filter((output: RenderOutput) => output.signedUrl).map((output: RenderOutput) => [output.pageId, output])));
      } catch (requestError: any) {
        if (requestError?.name !== "AbortError" && sequence === requestSequence.current) {
          setError(String(requestError?.message || "Could not update the product preview."));
        }
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }, 650);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, config, customizationId, saveStatus, retry, values, editorState]);

  const view = useMemo(() => config?.views?.find((item: any) => item.id === viewId) || config?.views?.[0], [config, viewId]);
  const serverOutput = view ? outputs[`mockup:${view.id}`] : undefined;
  if (!enabled || !config || !view) return null;

  return (
    <aside className="pointer-events-auto w-56 overflow-hidden rounded-2xl border border-[#303839]/12 bg-white/95 shadow-[0_14px_40px_rgba(48,56,57,0.16)] backdrop-blur-md" aria-label="Product mockup preview" aria-busy={loading}>
      <div className="flex items-center justify-between border-b border-[#303839]/8 px-3 py-2">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/55">Product preview</p>
          <p className="mt-0.5 text-[9px] font-semibold text-[#303839]/40">{serverOutput ? "Server rendered" : "Live preview"}</p>
        </div>
        {loading && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#D4AF37]" aria-label="Updating preview" />}
      </div>
      <div className="relative aspect-[4/3] overflow-hidden bg-[#F8F6F1]">
        {serverOutput ? (
          <img src={serverOutput.signedUrl} alt={`${view.name || "Product"} mockup`} className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <>
            {view.baseImageUrl ? <img src={view.baseImageUrl} alt="Product mockup" className="absolute inset-0 h-full w-full object-fill" /> : null}
            {(view.artworkAreas || []).filter((area: any) => area.visible !== false).map((area: any) => (
              <div key={area.id} className="absolute overflow-hidden" style={{ left: `${area.x / config.width * 100}%`, top: `${area.y / config.height * 100}%`, width: `${area.width / config.width * 100}%`, height: `${area.height / config.height * 100}%`, transform: `rotate(${area.rotation || 0}deg)`, opacity: area.opacity ?? 1, clipPath: area.clipPath || undefined }}>
                <CustomizerPreview template={template} values={snapshot.values} editorState={snapshot.editorState} page={area.sourcePageId} showSafeArea={false} showBleed={false} />
              </div>
            ))}
            {(view.overlays || []).filter((overlay: any) => overlay.visible !== false).map((overlay: any) => overlay.src ? <img key={overlay.id} src={overlay.src} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" style={{ opacity: overlay.opacity ?? 1, mixBlendMode: overlay.blendMode || "normal" }} /> : null)}
          </>
        )}
      </div>
      {error && (
        <div className="flex items-center justify-between gap-2 border-t border-red-900/10 bg-red-50 px-3 py-2">
          <p className="line-clamp-2 text-[10px] font-semibold text-red-800">{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="min-h-9 shrink-0 rounded-full border border-red-800/20 bg-white px-3 text-[10px] font-extrabold text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">Retry</button>
        </div>
      )}
      {config.views.length > 1 && (
        <div className="flex gap-1 overflow-x-auto p-2">
          {config.views.map((item: any) => <button key={item.id} type="button" onClick={() => setViewId(item.id)} className={`min-h-9 whitespace-nowrap rounded-full px-3 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${item.id === view.id ? "bg-[#303839] text-white" : "bg-[#F8F6F1] text-[#303839]"}`}>{item.name}</button>)}
        </div>
      )}
    </aside>
  );
}
