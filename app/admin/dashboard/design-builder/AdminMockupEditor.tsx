"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";
import {
  calculatePerspectivePoints,
  createFlatMockupTemplate,
  perspectivePointList,
  type MockupArtworkArea,
  type MockupTemplate,
} from "@/lib/customizer/v2/mockups";
import { uploadBuilderImage } from "./builder-utils";

const VIEW_PRESETS = [
  ["front-card", "Front card", ["front"]],
  ["back-card", "Back card", ["back"]],
  ["side-by-side", "Front and back", ["front", "back"]],
  ["stacked", "Stacked cards", ["front", "back"]],
  ["envelope", "Card with envelope", ["front"]],
  ["detail", "Close detail", ["front"]],
] as const;

const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
const selectClass = "h-11 w-full appearance-none rounded-xl border border-[#303839]/12 bg-white px-3 text-sm font-semibold text-[#303839] outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20";

function Stepper({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (value: number) => void }) {
  return (
    <div>
      <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">{label}</span>
      <div className="grid h-11 grid-cols-[42px_1fr_42px] overflow-hidden rounded-xl border border-[#303839]/12 bg-white">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Number((value - step).toFixed(2)))} className="grid min-h-11 place-items-center border-r border-[#303839]/10 text-lg font-bold hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D4AF37]">−</button>
        <output className="grid place-items-center text-xs font-extrabold tabular-nums text-[#303839]">{Number(value || 0).toFixed(step < 1 ? 2 : 0)}</output>
        <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(Number((value + step).toFixed(2)))} className="grid min-h-11 place-items-center border-l border-[#303839]/10 text-lg font-bold hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D4AF37]">+</button>
      </div>
    </div>
  );
}

function MockupOverlayEditor({ overlay, onPatch, onRemove, onMove }: any) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-2 rounded-xl border border-[#303839]/10 bg-[#F8F6F1] p-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onMove(-1)} className="min-h-10 rounded-lg bg-white px-2 text-xs font-bold" aria-label="Move overlay backward">↑</button>
        <button type="button" onClick={() => onMove(1)} className="min-h-10 rounded-lg bg-white px-2 text-xs font-bold" aria-label="Move overlay forward">↓</button>
        <select value={overlay.type} onChange={(event) => onPatch({ type: event.target.value })} className={`${selectClass} min-w-0 flex-1`}>
          {["shadow", "highlight", "texture", "foreground"].map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <button type="button" onClick={onRemove} className="min-h-10 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50">Remove</button>
      </div>
      <input value={overlay.src || ""} placeholder="Overlay image URL" onChange={(event) => onPatch({ src: event.target.value })} className="h-11 rounded-xl border border-[#303839]/12 bg-white px-3 text-xs outline-none focus:border-[#D4AF37]" />
      <div className="grid grid-cols-2 gap-2">
        <Stepper label="Opacity" value={overlay.opacity ?? 1} step={0.05} onChange={(opacity) => onPatch({ opacity: Math.max(0, Math.min(1, opacity)) })} />
        <label><span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">Blend</span><select value={overlay.blendMode || "over"} onChange={(event) => onPatch({ blendMode: event.target.value })} className={selectClass}>{["over", "multiply", "screen", "overlay", "soft-light"].map((blend) => <option key={blend} value={blend}>{blend}</option>)}</select></label>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onPatch({ visible: overlay.visible === false })} className="min-h-10 flex-1 rounded-lg border border-[#303839]/12 bg-white text-xs font-bold">{overlay.visible === false ? "Show" : "Hide"}</button>
        <button type="button" onClick={() => onPatch({ locked: !overlay.locked })} className="min-h-10 flex-1 rounded-lg border border-[#303839]/12 bg-white text-xs font-bold">{overlay.locked ? "Unlock" : "Lock"}</button>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="min-h-10 flex-[1.5] rounded-lg bg-[#303839] px-3 text-xs font-bold text-white disabled:opacity-50">{busy ? "Uploading…" : "Upload"}</button>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/webp" className="sr-only" onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try { const url = await uploadBuilderImage(file); if (url) onPatch({ src: url }); }
        finally { setBusy(false); event.target.value = ""; }
      }} />
    </div>
  );
}

export default function AdminMockupEditor({ template, product, onChange }: any) {
  const mockups: MockupTemplate[] = Array.isArray(template.mockupTemplates) ? template.mockupTemplates : [];
  const active = mockups[0] || createFlatMockupTemplate(product?.id || "", product?.mockups?.[0] || product?.thumbnail || "");
  const [viewId, setViewId] = useState(active.views[0]?.id || "front-card");
  const [areaId, setAreaId] = useState(active.views[0]?.artworkAreas?.[0]?.id || "");
  const [uploading, setUploading] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [syncMessage, setSyncMessage] = useState("");
  const [draggingCorner, setDraggingCorner] = useState<typeof CORNERS[number] | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const loadedProduct = useRef("");
  const view = active.views.find((item) => item.id === viewId) || active.views[0];
  const area = view?.artworkAreas?.find((item) => item.id === areaId) || view?.artworkAreas?.[0];
  const pages = useMemo(() => (template.pages || []).filter((page: any) => page.enabled !== false), [template.pages]);

  const commit = (next: MockupTemplate) => onChange({ ...template, mockupTemplates: [next, ...mockups.slice(1)] });
  const patchView = (patch: any) => commit({ ...active, views: active.views.map((item) => item.id === view.id ? { ...item, ...patch } : item) });
  const patchArea = (patch: Partial<MockupArtworkArea>) => patchView({ artworkAreas: view.artworkAreas.map((item) => item.id === area.id ? { ...item, ...patch } : item) });

  useEffect(() => {
    if (!product?.id || loadedProduct.current === product.id) return;
    loadedProduct.current = product.id;
    setSyncState("loading");
    fetch(`/api/admin/customizer/mockups/${encodeURIComponent(product.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not load saved mockups.");
        if (payload.mockup) {
          onChange({ ...template, mockupTemplates: [payload.mockup, ...mockups.slice(1)] });
          setViewId(payload.mockup.views?.[0]?.id || "");
          setAreaId(payload.mockup.views?.[0]?.artworkAreas?.[0]?.id || "");
        }
        setSyncState("idle");
      })
      .catch((error) => { setSyncState("error"); setSyncMessage(String(error?.message || error)); });
    // Load once for each edited product; parent form state remains authoritative afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  const persist = async (publish: boolean) => {
    if (!product?.id) { setSyncState("error"); setSyncMessage("Save the product before saving its normalized mockup."); return; }
    setSyncState("saving");
    setSyncMessage("");
    try {
      const saveResponse = await fetch(`/api/admin/customizer/mockups/${encodeURIComponent(product.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mockup: active }) });
      const saved = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || saved.ok === false) throw new Error(saved.error || "Could not save the mockup.");
      let next = saved.mockup;
      if (publish) {
        const publishResponse = await fetch(`/api/admin/customizer/mockups/${encodeURIComponent(product.id)}/publish`, { method: "POST" });
        const published = await publishResponse.json().catch(() => ({}));
        if (!publishResponse.ok || published.ok === false) throw new Error(published.error || "Could not publish the mockup.");
        next = published.mockup;
      }
      commit(next);
      setSyncState("saved");
      setSyncMessage(publish ? `Published version ${next.version}.` : "Draft saved to normalized mockup tables.");
    } catch (error: any) {
      setSyncState("error");
      setSyncMessage(String(error?.message || error));
    }
  };

  const importLegacy = async () => {
    if (!product?.id) { setSyncState("error"); setSyncMessage("Save the product before importing legacy mockups."); return; }
    setSyncState("saving");
    setSyncMessage("");
    try {
      const response = await fetch(`/api/admin/customizer/mockups/${encodeURIComponent(product.id)}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mockups: template.mockupTemplates || [] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not import legacy mockups.");
      const next = payload.templates?.[0];
      if (next) commit(next);
      setSyncState("saved");
      setSyncMessage(`Imported ${payload.imported || 0} legacy mockup configuration.`);
    } catch (error: any) {
      setSyncState("error");
      setSyncMessage(String(error?.message || error));
    }
  };

  const addView = (preset: typeof VIEW_PRESETS[number]) => {
    const [baseId, name, sourcePages] = preset;
    const id = active.views.some((item) => item.id === baseId) ? `${baseId}-${active.views.length + 1}` : baseId;
    const gap = sourcePages.length > 1 ? 40 : 0;
    const areaWidth = sourcePages.length > 1 ? Math.round((active.width - 3 * gap) / 2) : Math.round(active.width * 0.45);
    const areas = sourcePages.map((sourcePageId, index) => ({
      id: `${id}-${sourcePageId}-${index}`,
      sourcePageId,
      x: sourcePages.length > 1 ? gap + index * (areaWidth + gap) : Math.round(active.width * 0.275),
      y: Math.round(active.height * 0.14),
      width: areaWidth,
      height: Math.round(active.height * 0.72),
      rotation: 0,
      warpType: "none" as const,
      opacity: 1,
      sortOrder: index,
      visible: true,
    }));
    const nextView = { id, name, baseImageUrl: product?.mockups?.[active.views.length] || product?.mockups?.[0] || product?.thumbnail || "", width: active.width, height: active.height, sortOrder: active.views.length, requiresTransparency: false, artworkAreas: areas, overlays: [] };
    commit({ ...active, views: [...active.views, nextView] });
    setViewId(id);
    setAreaId(areas[0].id);
  };

  const addArea = () => {
    const sourcePageId = pages[0]?.id || "front";
    const next = { id: `area_${Date.now()}`, sourcePageId, x: Math.round(active.width * 0.3), y: Math.round(active.height * 0.2), width: Math.round(active.width * 0.4), height: Math.round(active.height * 0.6), rotation: 0, warpType: "none" as const, opacity: 1, sortOrder: view.artworkAreas.length, visible: true };
    patchView({ artworkAreas: [...view.artworkAreas, next] });
    setAreaId(next.id);
  };

  const moveInList = (items: any[], id: string, direction: number) => {
    const index = items.findIndex((item) => item.id === id);
    const target = Math.max(0, Math.min(items.length - 1, index + direction));
    if (index < 0 || target === index) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next.map((item, sortOrder) => ({ ...item, sortOrder }));
  };

  const setPerspective = (enabled: boolean) => patchArea(enabled
    ? { warpType: "perspective", perspectivePoints: calculatePerspectivePoints({ ...area, perspectivePoints: undefined }) }
    : { warpType: "none", perspectivePoints: undefined });

  const updateCorner = (corner: typeof CORNERS[number], patch: { x?: number; y?: number }) => {
    const points = area.perspectivePoints || calculatePerspectivePoints(area);
    patchArea({ warpType: "perspective", perspectivePoints: { ...points, [corner]: { ...points[corner], ...patch } } });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!draggingCorner || !previewRef.current || area.locked) return;
    const rect = previewRef.current.getBoundingClientRect();
    updateCorner(draggingCorner, {
      x: Math.max(-active.width, Math.min(active.width * 2, ((event.clientX - rect.left) / rect.width) * active.width)),
      y: Math.max(-active.height, Math.min(active.height * 2, ((event.clientY - rect.top) / rect.height) * active.height)),
    });
  };

  if (!view || !area) return <div className="grid min-h-[420px] place-items-center bg-[#F8F6F1]"><button type="button" onClick={addArea} className="min-h-11 rounded-xl bg-[#303839] px-5 text-sm font-bold text-white">Add the first artwork area</button></div>;
  const points = area.perspectivePoints || calculatePerspectivePoints(area);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#F8F6F1] p-3 md:p-5 2xl:p-7">
      <div className="mx-auto grid max-w-[1680px] gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="overflow-hidden rounded-3xl border border-[#303839]/10 bg-white shadow-[0_22px_60px_rgba(48,56,57,0.09)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#303839]/10 px-4 py-3 md:px-5">
            <div><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#D4AF37]">Production mockup scene</p><h2 className="font-display text-2xl text-[#303839]">{view.name}</h2></div>
            <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
              {active.views.map((item) => <button key={item.id} type="button" onClick={() => { setViewId(item.id); setAreaId(item.artworkAreas?.[0]?.id || ""); }} className={`min-h-11 whitespace-nowrap rounded-full px-4 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${item.id === view.id ? "bg-[#303839] text-white" : "border border-[#303839]/12 bg-white"}`}>{item.name}</button>)}
            </div>
          </div>
          <div className="grid min-h-[560px] place-items-center overflow-auto bg-[radial-gradient(circle_at_center,#ffffff_0,#F8F6F1_72%)] p-4 md:p-8">
            <div
              ref={previewRef}
              onPointerMove={handlePointerMove}
              onPointerUp={() => setDraggingCorner(null)}
              onPointerCancel={() => setDraggingCorner(null)}
              className="relative max-h-[680px] w-full max-w-[900px] touch-none overflow-hidden bg-white shadow-[0_28px_80px_rgba(48,56,57,0.18)]"
              style={{ aspectRatio: `${active.width}/${active.height}` }}
            >
              {view.baseImageUrl ? <img src={view.baseImageUrl} alt="Mockup base" className="absolute inset-0 h-full w-full object-fill" /> : <div className="absolute inset-0 grid place-items-center text-sm font-semibold text-[#303839]/45">Upload or select a base image</div>}
              {view.artworkAreas.filter((item) => item.visible !== false).map((item) => (
                <button key={item.id} type="button" onClick={() => setAreaId(item.id)} className={`absolute overflow-hidden bg-white/25 outline ${item.id === area.id ? "z-10 outline-2 outline-[#D4AF37]" : "outline-1 outline-[#303839]/45"}`} style={{ left: `${item.x / active.width * 100}%`, top: `${item.y / active.height * 100}%`, width: `${item.width / active.width * 100}%`, height: `${item.height / active.height * 100}%`, transform: `rotate(${item.rotation || 0}deg)`, opacity: item.opacity ?? 1 }}>
                  <CustomizerPreview template={template} values={{}} page={item.sourcePageId} showSafeArea={false} showBleed={false} />
                </button>
              ))}
              {area.warpType === "perspective" && (
                <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible" viewBox={`0 0 ${active.width} ${active.height}`} preserveAspectRatio="none" aria-hidden>
                  <polygon points={perspectivePointList(points).map((point) => `${point.x},${point.y}`).join(" ")} fill="rgba(212,175,55,.12)" stroke="#D4AF37" strokeWidth={Math.max(2, active.width / 500)} strokeDasharray="10 7" />
                </svg>
              )}
              {area.warpType === "perspective" && CORNERS.map((corner, index) => (
                <button key={corner} type="button" aria-label={`Drag ${corner} perspective corner`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDraggingCorner(corner); }} className="absolute z-30 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-[#D4AF37] text-[9px] font-black text-[#303839] shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]" style={{ left: `${points[corner].x / active.width * 100}%`, top: `${points[corner].y / active.height * 100}%` }}>{index + 1}</button>
              ))}
              {(view.overlays || []).filter((overlay) => overlay.visible !== false && overlay.src).map((overlay) => <img key={overlay.id} src={overlay.src} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" style={{ opacity: overlay.opacity ?? 1, mixBlendMode: (overlay.blendMode as any) || "normal" }} />)}
            </div>
          </div>
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-2xl border border-[#303839]/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-extrabold">Database status</h3><p className="mt-1 text-[11px] text-[#303839]/50">Draft and published versions use normalized tables.</p></div><span className={`h-2.5 w-2.5 rounded-full ${syncState === "error" ? "bg-red-500" : syncState === "saving" || syncState === "loading" ? "animate-pulse bg-[#D4AF37]" : syncState === "saved" ? "bg-emerald-500" : "bg-[#303839]/20"}`} /></div>
            {syncMessage && <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-semibold ${syncState === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{syncMessage}</p>}
            <div className="mt-3 grid grid-cols-3 gap-2"><button type="button" disabled={syncState === "saving"} onClick={importLegacy} className="min-h-11 rounded-xl border border-[#303839]/15 bg-[#F8F6F1] px-2 text-[11px] font-extrabold disabled:opacity-50">Import legacy</button><button type="button" disabled={syncState === "saving"} onClick={() => persist(false)} className="min-h-11 rounded-xl border border-[#303839]/15 bg-white px-2 text-[11px] font-extrabold disabled:opacity-50">Save draft</button><button type="button" disabled={syncState === "saving"} onClick={() => persist(true)} className="min-h-11 rounded-xl bg-[#303839] px-2 text-[11px] font-extrabold text-white disabled:opacity-50">Publish</button></div>
          </section>

          <section className="rounded-2xl border border-[#303839]/10 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-extrabold">View base</h3>
            <input value={view.baseImageUrl || ""} placeholder="Base image URL" onChange={(event) => patchView({ baseImageUrl: event.target.value })} className="mt-3 h-11 w-full rounded-xl border border-[#303839]/12 px-3 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20" />
            <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={uploading} onClick={() => uploadRef.current?.click()} className="min-h-11 rounded-xl bg-[#303839] px-4 text-xs font-bold text-white disabled:opacity-50">{uploading ? "Uploading…" : "Upload base"}</button><button type="button" onClick={() => patchView({ requiresTransparency: !view.requiresTransparency })} className="min-h-11 rounded-xl border border-[#303839]/12 px-3 text-xs font-bold">{view.requiresTransparency ? "PNG transparency" : "WebP output"}</button></div>
            {!!product?.mockups?.length && <div className="mt-3 grid grid-cols-4 gap-2">{product.mockups.map((url: string) => <button key={url} type="button" onClick={() => patchView({ baseImageUrl: url })} className="aspect-square overflow-hidden rounded-lg border border-[#303839]/10"><img src={url} alt="Product mockup option" className="h-full w-full object-cover" /></button>)}</div>}
          </section>

          <section className="rounded-2xl border border-[#303839]/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><div><h3 className="text-sm font-extrabold">Artwork areas</h3><p className="mt-1 text-[11px] text-[#303839]/50">Each area maps an independent page.</p></div><button type="button" onClick={addArea} className="min-h-10 rounded-xl bg-[#303839] px-3 text-xs font-bold text-white">Add area</button></div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{view.artworkAreas.map((item, index) => <button key={item.id} type="button" onClick={() => setAreaId(item.id)} className={`min-h-10 whitespace-nowrap rounded-full px-3 text-xs font-bold ${item.id === area.id ? "bg-[#D4AF37] text-[#303839]" : "bg-[#F8F6F1]"}`}>Area {index + 1} · {item.sourcePageId}</button>)}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="col-span-2"><span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">Source page</span><select value={area.sourcePageId} onChange={(event) => patchArea({ sourcePageId: event.target.value })} className={selectClass}>{pages.map((page: any) => <option key={page.id} value={page.id}>{page.label || page.name || page.id}</option>)}</select></label>
              <Stepper label="X position" value={area.x} onChange={(x) => patchArea({ x })} /><Stepper label="Y position" value={area.y} onChange={(y) => patchArea({ y })} />
              <Stepper label="Width" value={area.width} onChange={(width) => patchArea({ width: Math.max(1, width) })} /><Stepper label="Height" value={area.height} onChange={(height) => patchArea({ height: Math.max(1, height) })} />
              <Stepper label="Rotation" value={area.rotation || 0} step={0.5} onChange={(rotation) => patchArea({ rotation })} /><Stepper label="Opacity" value={area.opacity ?? 1} step={0.05} onChange={(opacity) => patchArea({ opacity: Math.max(0, Math.min(1, opacity)) })} />
            </div>
            <label className="mt-3 flex min-h-11 items-center justify-between rounded-xl border border-[#303839]/12 px-3 text-xs font-extrabold"><span>Four-corner perspective</span><input type="checkbox" checked={area.warpType === "perspective"} onChange={(event) => setPerspective(event.target.checked)} className="h-5 w-5 accent-[#303839]" /></label>
            {area.warpType === "perspective" && <div className="mt-3 grid gap-2 rounded-xl bg-[#F8F6F1] p-3"><p className="text-[11px] font-semibold text-[#303839]/55">Drag the numbered handles on the canvas, or fine-tune each coordinate.</p>{CORNERS.map((corner, index) => <div key={corner} className="grid grid-cols-[52px_1fr_1fr] items-end gap-2"><span className="pb-3 text-xs font-extrabold text-[#303839]">{index + 1}. {corner.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`).split(" ")[0]}</span><Stepper label="X" value={points[corner].x} onChange={(x) => updateCorner(corner, { x })} /><Stepper label="Y" value={points[corner].y} onChange={(y) => updateCorner(corner, { y })} /></div>)}</div>}
            <input value={area.clipPath || ""} placeholder="Optional SVG/CSS clipping path" onChange={(event) => patchArea({ clipPath: event.target.value })} className="mt-3 h-11 w-full rounded-xl border border-[#303839]/12 px-3 text-xs outline-none focus:border-[#D4AF37]" />
            <div className="mt-3 grid grid-cols-4 gap-2"><button type="button" onClick={() => patchView({ artworkAreas: moveInList(view.artworkAreas, area.id, -1) })} className="min-h-10 rounded-lg border text-xs font-bold">Back</button><button type="button" onClick={() => patchView({ artworkAreas: moveInList(view.artworkAreas, area.id, 1) })} className="min-h-10 rounded-lg border text-xs font-bold">Front</button><button type="button" onClick={() => patchArea({ visible: area.visible === false })} className="min-h-10 rounded-lg border text-xs font-bold">{area.visible === false ? "Show" : "Hide"}</button><button type="button" disabled={view.artworkAreas.length <= 1} onClick={() => { const next = view.artworkAreas.filter((item) => item.id !== area.id); patchView({ artworkAreas: next }); setAreaId(next[0]?.id || ""); }} className="min-h-10 rounded-lg border text-xs font-bold text-red-700 disabled:opacity-30">Remove</button></div>
          </section>

          <section className="rounded-2xl border border-[#303839]/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><div><h3 className="text-sm font-extrabold">Lighting overlays</h3><p className="mt-1 text-[11px] text-[#303839]/50">Deterministic saved order.</p></div><button type="button" onClick={() => patchView({ overlays: [...(view.overlays || []), { id: `overlay_${Date.now()}`, type: "shadow", src: "", opacity: 0.5, blendMode: "multiply", visible: true, sortOrder: view.overlays.length }] })} className="min-h-10 rounded-xl bg-[#303839] px-3 text-xs font-bold text-white">Add</button></div>
            <div className="mt-3 grid gap-2">{(view.overlays || []).map((overlay: any) => <MockupOverlayEditor key={overlay.id} overlay={overlay} onPatch={(patch: any) => patchView({ overlays: view.overlays.map((item: any) => item.id === overlay.id ? { ...item, ...patch } : item) })} onMove={(direction: number) => patchView({ overlays: moveInList(view.overlays, overlay.id, direction) })} onRemove={() => patchView({ overlays: view.overlays.filter((item: any) => item.id !== overlay.id) })} />)}{!view.overlays.length && <p className="text-xs text-[#303839]/45">Optional shadows, highlights, textures, or foreground PNGs.</p>}</div>
          </section>

          <section className="rounded-2xl border border-[#303839]/10 bg-white p-4 shadow-sm"><h3 className="text-sm font-extrabold">Add product view</h3><div className="mt-3 grid grid-cols-2 gap-2">{VIEW_PRESETS.map((preset) => <button key={preset[0]} type="button" onClick={() => addView(preset)} className="min-h-11 rounded-xl border border-[#303839]/12 px-2 text-xs font-bold transition hover:border-[#D4AF37] hover:bg-[#F8F6F1]">{preset[1]}</button>)}</div></section>
        </aside>
      </div>
      <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setUploading(true); try { const url = await uploadBuilderImage(file); if (url) patchView({ baseImageUrl: url }); } finally { setUploading(false); event.target.value = ""; } }} />
    </div>
  );
}
