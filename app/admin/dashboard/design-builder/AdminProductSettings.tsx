"use client";

// Customizer settings sheet: card/canvas size, DPI, safe area, bleed, pages,
// and the approval requirement. Opened from the builder toolbar.

function Field({ label, children }: any) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#111111]/55">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "h-9 w-full border border-[#111111]/15 bg-white px-2 text-sm outline-none focus:border-[#111111]/45";

export default function AdminProductSettings({ template, onChange, onClose }: any) {
  const t = template || {};
  const safe = t.safeArea || {};
  const bleed = t.bleed || {};
  const settings = t.settings || {};
  const back = (t.pages || []).find((p: any) => p.id === "back");

  const patch = (updates: any) => onChange({ ...t, ...updates });
  const num = (v: any) => (v === "" ? "" : Number(v));

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-[#111111]/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-body text-2xl text-[#111111]">Customizer settings</h3>
          <button type="button" onClick={onClose} className="text-xl text-[#111111]/60 hover:text-[#111111]">✕</button>
        </div>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Card width (in)"><input type="number" className={inputCls} value={t.cardWidthIn ?? ""} onChange={(e) => patch({ cardWidthIn: num(e.target.value) })} /></Field>
            <Field label="Card height (in)"><input type="number" className={inputCls} value={t.cardHeightIn ?? ""} onChange={(e) => patch({ cardHeightIn: num(e.target.value) })} /></Field>
            <Field label="Canvas width (px)"><input type="number" className={inputCls} value={t.canvasWidthPx ?? ""} onChange={(e) => patch({ canvasWidthPx: num(e.target.value) })} /></Field>
            <Field label="Canvas height (px)"><input type="number" className={inputCls} value={t.canvasHeightPx ?? ""} onChange={(e) => patch({ canvasHeightPx: num(e.target.value) })} /></Field>
            <Field label="DPI"><input type="number" className={inputCls} value={t.dpi ?? ""} onChange={(e) => patch({ dpi: num(e.target.value) })} /></Field>
            <Field label="Orientation">
              <select className={inputCls} value={t.orientation} onChange={(e) => patch({ orientation: e.target.value })}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
                <option value="square">Square</option>
              </select>
            </Field>
          </div>

          <div>
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#111111]/55">Safe area (px)</span>
            <div className="grid grid-cols-4 gap-2">
              {["top", "right", "bottom", "left"].map((s) => (
                <input key={s} type="number" placeholder={s[0].toUpperCase()} className={inputCls} value={safe[s] ?? 0} onChange={(e) => patch({ safeArea: { ...safe, [s]: Number(e.target.value) || 0 } })} />
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#111111]/55">Bleed (px)</span>
            <div className="grid grid-cols-4 gap-2">
              {["top", "right", "bottom", "left"].map((s) => (
                <input key={s} type="number" placeholder={s[0].toUpperCase()} className={inputCls} value={bleed[s] ?? 0} onChange={(e) => patch({ bleed: { ...bleed, [s]: Number(e.target.value) || 0 } })} />
              ))}
            </div>
          </div>

          <div className="grid gap-2 border-t border-[#111111]/10 pt-3">
            <label className="flex items-center gap-2 text-xs font-bold text-[#111111]/75">
              <input type="checkbox" checked={Boolean(settings.showSafeArea)} onChange={(e) => patch({ settings: { ...settings, showSafeArea: e.target.checked } })} className="h-4 w-4 accent-[#111111]" />
              Show safe area guide
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-[#111111]/75">
              <input type="checkbox" checked={Boolean(settings.showBleed)} onChange={(e) => patch({ settings: { ...settings, showBleed: e.target.checked } })} className="h-4 w-4 accent-[#111111]" />
              Show bleed guide
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-[#111111]/75">
              <input type="checkbox" checked={settings.requireApprovalCheckbox !== false} onChange={(e) => patch({ settings: { ...settings, requireApprovalCheckbox: e.target.checked } })} className="h-4 w-4 accent-[#111111]" />
              Require approval checkbox before add to cart
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-[#111111]/75">
              <input
                type="checkbox"
                checked={back?.enabled !== false && Boolean(back)}
                onChange={(e) => patch({ pages: (t.pages || []).map((p: any) => (p.id === "back" ? { ...p, enabled: e.target.checked } : p)) })}
                className="h-4 w-4 accent-[#111111]"
              />
              Allow back side
            </label>
          </div>
        </div>

        <button type="button" onClick={onClose} className="mt-5 w-full rounded-full bg-[#111111] px-5 py-2.5 text-sm font-bold text-white">Done</button>
      </div>
    </div>
  );
}
