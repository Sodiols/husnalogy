"use client";

// Template Settings tab (Section 33): identity, canvas, guides, customer
// abilities, protection, and admin-only notes. Everything is stored on the
// template (settings live in its JSONB settings column).

function Field({ label, children, hint }: any) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[#303839]/45">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, label, hint }: any) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-[#303839]">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#303839]" />
      <span>
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-xs text-[#303839]/50">{hint}</span>}
      </span>
    </label>
  );
}

const inputCls = "h-9 w-full rounded-md border border-[#303839]/15 bg-white px-2 text-sm outline-none focus:border-[#303839]/45";

export default function AdminTemplateSettings({ template, onChange, productName, templateVersion }: any) {
  const t = template || {};
  const safe = t.safeArea || {};
  const bleed = t.bleed || {};
  const settings = t.settings || {};
  const enabledPages = (t.pages || []).filter((p: any) => p.enabled !== false);

  const patch = (updates: any) => onChange({ ...t, ...updates });
  const patchSettings = (updates: any) => patch({ settings: { ...settings, ...updates } });
  const num = (v: any) => (v === "" ? "" : Number(v));

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-6">
      <div>
        <h3 className="font-display text-2xl text-[#303839]">Template settings</h3>
        <p className="mt-1 text-sm text-[#303839]/55">
          Connected product: <span className="font-semibold text-[#303839]">{productName}</span> · Version{" "}
          <span className="font-semibold text-[#303839]">{templateVersion || t.version || 1}</span>
        </p>
      </div>

      <section className="grid gap-3 rounded-lg border border-[#303839]/12 bg-white p-4">
        <h4 className="font-display text-xl text-[#303839]">Identity</h4>
        <Field label="Template name">
          <input className={inputCls} value={settings.templateName || ""} placeholder={productName} onChange={(e) => patchSettings({ templateName: e.target.value })} />
        </Field>
        <Field label="Template description">
          <textarea
            className="min-h-16 w-full rounded-md border border-[#303839]/15 bg-white p-2 text-sm outline-none focus:border-[#303839]/45"
            value={settings.templateDescription || ""}
            onChange={(e) => patchSettings({ templateDescription: e.target.value })}
          />
        </Field>
        <Field label="Notes for administrators" hint="Never shown to customers.">
          <textarea
            className="min-h-16 w-full rounded-md border border-[#303839]/15 bg-white p-2 text-sm outline-none focus:border-[#303839]/45"
            value={settings.adminNotes || ""}
            onChange={(e) => patchSettings({ adminNotes: e.target.value })}
          />
        </Field>
      </section>

      <section className="grid gap-3 rounded-lg border border-[#303839]/12 bg-white p-4">
        <h4 className="font-display text-xl text-[#303839]">Canvas</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Card width (in)"><input type="number" className={inputCls} value={t.cardWidthIn ?? ""} onChange={(e) => patch({ cardWidthIn: num(e.target.value) })} /></Field>
          <Field label="Card height (in)"><input type="number" className={inputCls} value={t.cardHeightIn ?? ""} onChange={(e) => patch({ cardHeightIn: num(e.target.value) })} /></Field>
          <Field label="DPI"><input type="number" className={inputCls} value={t.dpi ?? ""} onChange={(e) => patch({ dpi: num(e.target.value) })} /></Field>
          <Field label="Canvas width (px)"><input type="number" className={inputCls} value={t.canvasWidthPx ?? ""} onChange={(e) => patch({ canvasWidthPx: num(e.target.value) })} /></Field>
          <Field label="Canvas height (px)"><input type="number" className={inputCls} value={t.canvasHeightPx ?? ""} onChange={(e) => patch({ canvasHeightPx: num(e.target.value) })} /></Field>
          <Field label="Orientation">
            <select className={inputCls} value={t.orientation} onChange={(e) => patch({ orientation: e.target.value })}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
              <option value="square">Square</option>
            </select>
          </Field>
          <Field label="Default page">
            <select className={inputCls} value={t.defaultPage || enabledPages[0]?.id || "front"} onChange={(e) => patch({ defaultPage: e.target.value })}>
              {enabledPages.map((page: any) => (
                <option key={page.id} value={page.id}>{page.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Safe area (px)</span>
          <div className="grid grid-cols-4 gap-2">
            {["top", "right", "bottom", "left"].map((side) => (
              <input
                key={side}
                type="number"
                aria-label={`Safe area ${side}`}
                placeholder={side}
                className={inputCls}
                value={safe[side] ?? 0}
                onChange={(e) => patch({ safeArea: { ...safe, [side]: Number(e.target.value) || 0 } })}
              />
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Bleed (px)</span>
          <div className="grid grid-cols-4 gap-2">
            {["top", "right", "bottom", "left"].map((side) => (
              <input
                key={side}
                type="number"
                aria-label={`Bleed ${side}`}
                placeholder={side}
                className={inputCls}
                value={bleed[side] ?? 0}
                onChange={(e) => patch({ bleed: { ...bleed, [side]: Number(e.target.value) || 0 } })}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <Toggle checked={settings.showSafeArea} onChange={(v: boolean) => patchSettings({ showSafeArea: v })} label="Show safe area guide" />
          <Toggle checked={settings.showBleed} onChange={(v: boolean) => patchSettings({ showBleed: v })} label="Show bleed guide" />
        </div>
      </section>

      <section className="grid gap-3 rounded-lg border border-[#303839]/12 bg-white p-4">
        <h4 className="font-display text-xl text-[#303839]">Customer experience</h4>
        <Toggle
          checked={settings.allowCustomerText}
          onChange={(v: boolean) => patchSettings({ allowCustomerText: v })}
          label="Allow customers to add their own text"
          hint="Can be overridden per page from the page menu."
        />
        <Toggle
          checked={settings.allowCustomerUploads !== false}
          onChange={(v: boolean) => patchSettings({ allowCustomerUploads: v })}
          label="Allow customer photo uploads"
          hint="Photo areas still require an upload field."
        />
        <Toggle
          checked={settings.requireApprovalCheckbox !== false}
          onChange={(v: boolean) => patchSettings({ requireApprovalCheckbox: v })}
          label="Require design approval before Add to Cart"
        />
        <Toggle
          checked={settings.protectedPreview !== false}
          onChange={(v: boolean) => patchSettings({ protectedPreview: v })}
          label="Protected customer preview"
          hint="Watermark plus copy / print / screenshot deterrence in the customer customizer."
        />
        <Toggle
          checked={settings.autosave !== false}
          onChange={(v: boolean) => patchSettings({ autosave: v })}
          label="Customer autosave"
          hint="Automatically saves customer drafts while they edit."
        />
      </section>
    </div>
  );
}
