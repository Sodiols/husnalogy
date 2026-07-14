"use client";

import { useEffect, useState } from "react";
import { CUSTOMIZER_FEATURE_FLAGS } from "@/lib/customizer/v2/feature-flags";

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

const inputCls = "h-10 w-full rounded-lg border border-[#303839]/15 bg-white px-3 text-sm text-[#303839] shadow-sm outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20";

export default function AdminTemplateSettings({ template, onChange, productName, productId, productType, templateVersion }: any) {
  const t = template || {};
  const safe = t.safeArea || {};
  const bleed = t.bleed || {};
  const settings = t.settings || {};
  const enabledPages = (t.pages || []).filter((p: any) => p.enabled !== false);
  const [dbFlags, setDbFlags] = useState<Record<string, boolean> | null>(null);
  const [flagStatus, setFlagStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");

  const patch = (updates: any) => onChange({ ...t, ...updates });
  const patchSettings = (updates: any) => patch({ settings: { ...settings, ...updates } });
  const num = (v: any) => (v === "" ? "" : Number(v));

  useEffect(() => {
    if (!productId) return;
    setFlagStatus("loading");
    fetch(`/api/admin/customizer/feature-flags/${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not load flags.");
        const next: Record<string, boolean> = {};
        for (const flag of CUSTOMIZER_FEATURE_FLAGS) {
          const productRow = (payload.flags || []).find((row: any) => row.flag === flag && row.scope === "product");
          const globalRow = (payload.flags || []).find((row: any) => row.flag === flag && row.scope === "global");
          next[flag] = Boolean(productRow ? productRow.enabled : globalRow?.enabled);
        }
        setDbFlags(next);
        setFlagStatus("idle");
      })
      .catch(() => setFlagStatus("error"));
  }, [productId]);

  const updateFlag = async (flag: string, enabled: boolean) => {
    patchSettings({ featureFlags: { ...(settings.featureFlags || {}), [flag]: enabled } });
    setDbFlags((current) => ({ ...(current || settings.featureFlags || {}), [flag]: enabled }));
    if (!productId) return;
    setFlagStatus("saving");
    try {
      const response = await fetch(`/api/admin/customizer/feature-flags/${encodeURIComponent(productId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ flag, enabled, scope: "product", productType, rolloutPercentage: 100 }] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not save flag.");
      setFlagStatus("saved");
    } catch {
      setFlagStatus("error");
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 p-4 md:p-6 xl:grid-cols-2 xl:items-start 2xl:p-8">
      <div className="xl:col-span-2">
        <h3 className="font-display text-2xl text-[#303839]">Template settings</h3>
        <p className="mt-1 text-sm text-[#303839]/55">
          Connected product: <span className="font-semibold text-[#303839]">{productName}</span> · Version{" "}
          <span className="font-semibold text-[#303839]">{templateVersion || t.version || 1}</span>
        </p>
      </div>

      <section className="grid gap-3 rounded-xl border border-[#303839]/12 bg-white p-4 shadow-[0_12px_30px_rgba(48,56,57,0.04)] md:p-5">
        <h4 className="font-display text-xl text-[#303839]">Identity</h4>
        <Field label="Template name">
          <input className={inputCls} value={settings.templateName || ""} placeholder={productName} onChange={(e) => patchSettings({ templateName: e.target.value })} />
        </Field>
        <Field label="Template description">
          <textarea
            className="min-h-20 w-full rounded-lg border border-[#303839]/15 bg-white p-3 text-sm outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
            value={settings.templateDescription || ""}
            onChange={(e) => patchSettings({ templateDescription: e.target.value })}
          />
        </Field>
        <Field label="Notes for administrators" hint="Never shown to customers.">
          <textarea
            className="min-h-20 w-full rounded-lg border border-[#303839]/15 bg-white p-3 text-sm outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
            value={settings.adminNotes || ""}
            onChange={(e) => patchSettings({ adminNotes: e.target.value })}
          />
        </Field>
      </section>

      <section className="grid gap-3 rounded-xl border border-[#303839]/12 bg-white p-4 shadow-[0_12px_30px_rgba(48,56,57,0.04)] md:p-5">
        <div>
          <div className="flex items-center justify-between gap-3"><h4 className="font-display text-xl text-[#303839]">Staged V2 features</h4><span className={`h-2.5 w-2.5 rounded-full ${flagStatus === "error" ? "bg-red-500" : flagStatus === "saving" || flagStatus === "loading" ? "animate-pulse bg-[#D4AF37]" : flagStatus === "saved" ? "bg-emerald-500" : "bg-[#303839]/20"}`} aria-label={`Feature flags ${flagStatus}`} /></div>
          <p className="mt-1 text-xs leading-5 text-[#303839]/50">Database-authoritative product overrides. Template JSON is retained only for backward compatibility.</p>
          {!productId && <p className="mt-2 rounded-lg bg-[#F8F6F1] px-3 py-2 text-xs font-semibold text-[#303839]/65">Save this product first to create database feature flags.</p>}
          {flagStatus === "error" && <p className="mt-2 text-xs font-bold text-red-700">Database flags could not be synchronized.</p>}
        </div>
        {[
          ["customizer_v2", "Customizer V2"],
          ["customizer_v2_grids", "Photo grids"],
          ["customizer_v2_groups", "Persistent groups"],
          ["customizer_v2_mockups", "Product mockups"],
          ["customizer_v2_perspective_mockups", "Four-corner perspective"],
          ["customizer_v2_server_rendering", "Server rendering"],
          ["customizer_v2_print_pdf", "Print PDF"],
        ].map(([flag, label]) => (
          <Toggle
            key={flag}
            checked={Boolean((dbFlags || settings.featureFlags || {})[flag])}
            onChange={(enabled: boolean) => updateFlag(flag, enabled)}
            label={label}
          />
        ))}
      </section>

      <section className="grid gap-4 rounded-xl border border-[#303839]/12 bg-white p-4 shadow-[0_12px_30px_rgba(48,56,57,0.04)] md:p-5 xl:row-span-2">
        <h4 className="font-display text-xl text-[#303839]">Canvas</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Card width (in)"><input type="number" className={inputCls} value={t.cardWidthIn ?? ""} onChange={(e) => patch({ cardWidthIn: num(e.target.value) })} /></Field>
          <Field label="Card height (in)"><input type="number" className={inputCls} value={t.cardHeightIn ?? ""} onChange={(e) => patch({ cardHeightIn: num(e.target.value) })} /></Field>
          <Field label="DPI"><input type="number" className={inputCls} value={t.dpi ?? ""} onChange={(e) => patch({ dpi: num(e.target.value) })} /></Field>
          <Field label="Canvas width (px)"><input type="number" className={inputCls} value={t.canvasWidthPx ?? ""} onChange={(e) => patch({ canvasWidthPx: num(e.target.value) })} /></Field>
          <Field label="Canvas height (px)"><input type="number" className={inputCls} value={t.canvasHeightPx ?? ""} onChange={(e) => patch({ canvasHeightPx: num(e.target.value) })} /></Field>
          <Field label="Orientation">
            <span className="relative block min-w-0">
              <select className={`${inputCls} appearance-none pr-10`} value={t.orientation} onChange={(e) => patch({ orientation: e.target.value })}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
                <option value="square">Square</option>
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#303839]/50" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </Field>
          <Field label="Default page">
            <span className="relative block min-w-0">
              <select className={`${inputCls} appearance-none pr-10`} value={t.defaultPage || enabledPages[0]?.id || "front"} onChange={(e) => patch({ defaultPage: e.target.value })}>
                {enabledPages.map((page: any) => (
                  <option key={page.id} value={page.id}>{page.label}</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#303839]/50" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
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

      <section className="grid gap-3 rounded-xl border border-[#303839]/12 bg-white p-4 shadow-[0_12px_30px_rgba(48,56,57,0.04)] md:p-5">
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
          checked={Boolean(settings.allowCustomerElements)}
          onChange={(v: boolean) => patchSettings({ allowCustomerElements: v })}
          label="Allow customers to add elements"
          hint="Customers can insert decorative elements from the Husnalogy elements library."
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
