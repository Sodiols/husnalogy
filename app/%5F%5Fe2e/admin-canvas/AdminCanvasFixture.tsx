"use client";

/**
 * Admin design-builder canvas, mounted on the deterministic fixture template.
 *
 * The full builder needs an authenticated administrator and loads products from
 * Supabase, so its canvas could not be exercised by an automated browser test.
 * This mounts the REAL `AdminCanvas` — the shared Konva interaction stage and
 * the shared renderer on the admin surface — and commits gestures through the
 * builder's own `applyCanvasLayerPatches`, so a test exercises production code
 * for selection, drag, resize, rotation, zoom and the atomic batch commit.
 *
 * What it deliberately does NOT reproduce is builder chrome (panels, save,
 * publish). Those are not part of the interaction engine under test.
 */

import { useCallback, useRef, useState } from "react";

import AdminCanvas from "@/app/admin/dashboard/design-builder/AdminCanvas";
import { applyCanvasLayerPatches, updateLayer } from "@/app/admin/dashboard/design-builder/builder-utils";
import { ensureCustomizerMetrics, recordDocumentCommit, recordEditorEvent } from "@/lib/customizer/v2/dev-metrics";

export default function AdminCanvasFixture({ initialTemplate }: { initialTemplate: Record<string, any> }) {
  const [template, setTemplate] = useState(initialTemplate);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ panX: 0, panY: 0 });
  const templateRef = useRef(template);
  templateRef.current = template;
  const mounted = useRef(false);
  if (!mounted.current) {
    mounted.current = true;
    ensureCustomizerMetrics();
  }

  const commit = useCallback((next: Record<string, any>, layerCount: number) => {
    recordDocumentCommit("transform");
    if (layerCount > 1) recordEditorEvent("batchTransformCommit");
    templateRef.current = next;
    setTemplate(next);
  }, []);

  return (
    <main className="flex h-screen flex-col bg-[#f3f1ec]">
      <div className="flex items-center gap-2 p-2 text-sm">
        <span data-testid="admin-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((current) => Math.min(4, current * 2))}>Zoom in</button>
        <button type="button" onClick={() => setZoom((current) => Math.max(0.25, current / 2))}>Zoom out</button>
      </div>
      <div className="relative min-h-0 flex-1" data-customizer-canvas="admin">
        <AdminCanvas
          template={template}
          pageId="front"
          values={{}}
          selectedLayerIds={selectedLayerIds}
          selectedLayerId={selectedLayerIds[selectedLayerIds.length - 1] || null}
          onSelectionChange={setSelectedLayerIds}
          onLayersChange={(patches: Record<string, any>) =>
            commit(applyCanvasLayerPatches(templateRef.current, patches), Object.keys(patches).length)
          }
          onLayerChange={(id: string, patch: Record<string, any>) => commit(updateLayer(templateRef.current, id, patch), 1)}
          onBeginChange={() => recordEditorEvent("historyTransaction")}
          zoom={zoom}
          panX={pan.panX}
          panY={pan.panY}
          onPanChange={(next: { panX: number; panY: number }) => setPan(next)}
          showSafeArea={false}
          showBleed={false}
        />
      </div>
    </main>
  );
}
