"use client";

import { useEffect, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import { buildPageSvg } from "@/lib/customizer/v2/svg";
import { createCanvasMeasure } from "@/lib/customizer/v2/text-layout";

type Job = { template: any; fonts: Array<{ family: string; weight: string; style: string; base64: string }> };

/**
 * window.__renderParity.load(job) registers the job's fonts (the test passes
 * the same TTF bytes the server measures with), renders every page through
 * CustomizerPreview, and resolves once drawn. window.__renderParity.server(pageId)
 * then returns the server renderer's SVG for that page, measured with the
 * browser's canvas; window.__renderParity.measure(texts) returns canvas widths.
 */
export default function RenderParityFixture() {
  const [job, setJob] = useState<Job | null>(null);
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    const host = window as any;
    host.__renderParity = {
      load: async (next: Job) => {
        for (const font of next.fonts) {
          const bytes = Uint8Array.from(atob(font.base64), (char) => char.charCodeAt(0));
          const face = new FontFace(font.family, bytes.buffer, { weight: font.weight, style: font.style });
          await face.load();
          document.fonts.add(face);
        }
        await document.fonts.ready;
        setJob(next);
      },
      server: (pageId: string) => buildPageSvg({ template: host.__renderParityJob.template, pageId, mode: "print", measure: createCanvasMeasure() }),
      measure: (items: Array<{ text: string; style: any }>) => {
        const measure = createCanvasMeasure();
        return items.map((item) => measure(item.text, item.style));
      },
    };
  }, []);

  useEffect(() => {
    if (!job) return;
    (window as any).__renderParityJob = job;
    // Two frames: React commits, then layout measured with the loaded fonts.
    requestAnimationFrame(() => requestAnimationFrame(() => setDrawn((count) => count + 1)));
  }, [job]);

  return (
    <main data-render-parity data-drawn={drawn} style={{ padding: 16, background: "#ffffff" }}>
      {job?.template?.pages?.map((page: any) => (
        <section key={page.id} data-parity-page={page.id} style={{ width: 750 }}>
          <CustomizerPreview template={job.template} values={{}} page={page.id} showSafeArea={false} showBleed={false} />
        </section>
      ))}
    </main>
  );
}
