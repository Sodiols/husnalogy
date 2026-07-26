"use client";

import CustomizerWorkspace from "./CustomizerWorkspace";
import CustomizerPreview from "./CustomizerPreview";

export default function CustomerProductEditingPreview({ template, values, editorState, pageId, zoom, onZoomChange, selectedLayerIds, onSelectLayer, onSelectionChange, onLayerTransform, editingGroupId, onEnterGroup, showWatermark = false }: any) {
  const config = template?.mockupTemplates?.[0] || template?.settings?.mockupTemplates?.[0];
  const view = config?.views?.[0];
  if (!config || !view) {
    return <div className="grid h-full place-items-center p-6 text-center text-sm text-[#303839]/55">A published flat product mockup is required for Product Preview editing.</div>;
  }
  const area = (view.artworkAreas || []).find((item: any) => item.visible !== false && item.sourcePageId === pageId) || (view.artworkAreas || []).find((item: any) => item.visible !== false);
  if (!area) return <div className="grid h-full place-items-center p-6 text-center text-sm text-[#303839]/55">This mockup view has no artwork area for the selected page.</div>;
  const perspective = area.warpType === "perspective" || area.warpType === "cylinder" || area.warpType === "custom";

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-[#F8F6F1] p-3 sm:p-6">
      <div className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-[#303839]/10 bg-white shadow-[0_18px_55px_rgba(48,56,57,0.14)]" style={{ aspectRatio: `${config.width || 1600}/${config.height || 1200}` }}>
        {view.baseImageUrl ? <img src={view.baseImageUrl} alt={`${view.name || "Product"} mockup`} className="absolute inset-0 h-full w-full object-fill" /> : null}
        <div className="absolute overflow-hidden" style={{ left: `${area.x / config.width * 100}%`, top: `${area.y / config.height * 100}%`, width: `${area.width / config.width * 100}%`, height: `${area.height / config.height * 100}%`, transform: `rotate(${area.rotation || 0}deg)`, transformOrigin: "center", opacity: area.opacity ?? 1, clipPath: area.clipPath || undefined }}>
          {perspective ? (
            <CustomizerPreview template={template} values={values} editorState={editorState} page={area.sourcePageId} showSafeArea={false} showBleed={false} />
          ) : (
            <CustomizerWorkspace template={template} values={values} editorState={editorState} pageId={area.sourcePageId} zoom={zoom} onZoomChange={onZoomChange} selectedLayerIds={selectedLayerIds} selectedLayerId={selectedLayerIds?.at(-1) || null} onSelectLayer={onSelectLayer} onSelectionChange={onSelectionChange} onLayerTransform={onLayerTransform} editingGroupId={editingGroupId} onEnterGroup={onEnterGroup} showWatermark={showWatermark} showSafeArea={false} showBleed={false} maxCanvasWidth={10000} embedded interactionRotation={Number(area.rotation) || 0} />
          )}
        </div>
        {(view.overlays || []).filter((overlay: any) => overlay.visible !== false && overlay.src).map((overlay: any) => <img key={overlay.id} src={overlay.src} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" style={{ opacity: overlay.opacity ?? 1, mixBlendMode: overlay.blendMode || "normal" }} />)}
        {perspective && <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#303839] px-4 py-2 text-[10px] font-bold text-white">Perspective view is preview only. Use Print Canvas for precise editing.</p>}
      </div>
    </div>
  );
}
