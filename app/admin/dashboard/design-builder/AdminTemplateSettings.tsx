"use client";

import { useEffect, useRef, useState } from "react";
import GoogleFontMultiSelect from "@/app/components/customizer/GoogleFontMultiSelect";
import { CUSTOMIZER_FEATURE_FLAGS } from "@/lib/customizer/v2/feature-flags";
import { PRODUCTION_RENDER_LIMITS } from "@/lib/customizer/production-limits";
import { GRID_PRESETS } from "@/lib/customizer/v2/grids";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import {
  CARD_SIZE_PRESETS,
  artboardOf,
  changeTemplateOrientation,
  orientationOf,
  canvasPixelsFor,
  isArtboardConsistent,
  matchCardSizePreset,
  resizeTemplateArtboard,
} from "@/lib/customizer/v2/artboard";

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

function MultiChoice({ value, options, onChange, emptyLabel = "All available options" }: any) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (item: string) => onChange(selected.includes(item) ? selected.filter((entry: string) => entry !== item) : [...selected, item]);
  return (
    <div>
      <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-[#303839]/12 bg-[#F8F6F1] p-2">
        {options.map((option: any) => {
          const item = String(option.value);
          const active = selected.includes(item);
          return <button key={item} type="button" aria-pressed={active} onClick={() => toggle(item)} className={`min-h-9 rounded-lg border px-2.5 text-left text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${active ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/10 bg-white text-[#303839] hover:border-[#303839]/40"}`}>{option.label}</button>;
        })}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[#303839]/45"><span>{selected.length ? `${selected.length} allowed` : emptyLabel}</span>{selected.length > 0 && <button type="button" onClick={() => onChange([])} className="rounded px-0.5 font-bold text-[#303839] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white">Allow all</button>}</div>
    </div>
  );
}

const inputCls = "h-10 w-full rounded-lg border border-[#303839]/15 bg-white px-3 text-sm text-[#303839] shadow-sm outline-none transition focus:border-[#303839]/60 focus:ring-2 focus:ring-[#303839]/15";

function SettingStepper({ label, value, onCommit, minimum, maximum, step = 1 }: any) {
  return <EditableNumericStepper label={label} value={Number(value) || 0} minimum={minimum} maximum={maximum} step={step} largeStep={step < 1 ? step * 10 : 10} allowNegative={minimum === undefined || minimum < 0} allowDecimal={step < 1} onCommit={onCommit} />;
}

export default function AdminTemplateSettings({ template, onChange, productName, productId, productType, templateVersion }: any) {
  const t = template || {};
  const safe = t.safeArea || {};
  const bleed = t.bleed || {};
  const settings = t.settings || {};
  const enabledPages = (t.pages || []).filter((p: any) => p.enabled !== false);
  const [dbFlags, setDbFlags] = useState<Record<string, boolean> | null>(null);
  const [flagStatus, setFlagStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [flagError, setFlagError] = useState("");
  // Feature flags save to their own database table, separately from the
  // template draft. Responses can arrive out of order, so:
  //  - each flag's requests are numbered and only the NEWEST may change what
  //    the toggle shows (a slow earlier response can never overwrite it);
  //  - the last value the database CONFIRMED is remembered, and a failed save
  //    reverts the toggle to it instead of leaving an unsaved "on";
  //  - template writes use the latest template, never the render that started
  //    the request.
  const templateRef = useRef(t);
  templateRef.current = t;
  const confirmedFlagsRef = useRef<Record<string, boolean>>({});
  const flagRequestSeqRef = useRef<Record<string, number>>({});
  const pendingFlagSavesRef = useRef(0);
  const failedFlagsRef = useRef<Set<string>>(new Set());

  const patch = (updates: any) => onChange({ ...t, ...updates });
  // Size changes never go field by field: inches, DPI and pixels move together
  // and the design is carried across in ONE change (one undo step).
  const board = artboardOf(t);
  const sizePreset = matchCardSizePreset(board);
  const artboardConsistent = isArtboardConsistent(t);
  const orientation = orientationOf(board);
  const resize = (target: Partial<{ widthIn: number; heightIn: number; dpi: number }>) =>
    onChange(
      resizeTemplateArtboard(t, {
        widthIn: target.widthIn ?? board.widthIn,
        heightIn: target.heightIn ?? board.heightIn,
        dpi: target.dpi ?? board.dpi,
      }).template,
    );
  const patchSettings = (updates: any) => patch({ settings: { ...settings, ...updates } });

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
        confirmedFlagsRef.current = { ...next };
        setDbFlags(next);
        setFlagStatus("idle");
      })
      .catch(() => {
        setFlagStatus("error");
        setFlagError("Database flags could not be loaded. Toggles show the template copy only.");
      });
  }, [productId]);

  const setTemplateFlag = (flag: string, enabled: boolean | undefined) => {
    const latest = templateRef.current || {};
    const latestSettings = latest.settings || {};
    const featureFlags = { ...(latestSettings.featureFlags || {}) };
    if (enabled === undefined) delete featureFlags[flag];
    else featureFlags[flag] = enabled;
    onChange({ ...latest, settings: { ...latestSettings, featureFlags } });
  };

  const updateFlag = async (flag: string, enabled: boolean) => {
    const previousTemplateValue = templateRef.current?.settings?.featureFlags?.[flag];
    setTemplateFlag(flag, enabled);
    setDbFlags((current) => ({ ...(current || templateRef.current?.settings?.featureFlags || {}), [flag]: enabled }));
    if (!productId) return;

    const seq = (flagRequestSeqRef.current[flag] || 0) + 1;
    flagRequestSeqRef.current[flag] = seq;
    pendingFlagSavesRef.current += 1;
    setFlagStatus("saving");
    setFlagError("");
    let ok = false;
    let reason = "";
    try {
      const response = await fetch(`/api/admin/customizer/feature-flags/${encodeURIComponent(productId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ flag, enabled, scope: "product", productType, rolloutPercentage: 100 }] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not save flag.");
      ok = true;
    } catch (error: any) {
      reason = String(error?.message || "Could not save flag.");
    } finally {
      pendingFlagSavesRef.current -= 1;
    }

    const newest = flagRequestSeqRef.current[flag] === seq;
    if (ok) {
      // The database confirmed THIS value; only the newest request decides
      // what the toggle shows.
      if (newest) {
        confirmedFlagsRef.current = { ...confirmedFlagsRef.current, [flag]: enabled };
        failedFlagsRef.current.delete(flag);
      }
    } else if (newest) {
      failedFlagsRef.current.add(flag);
      // Revert to what the database last confirmed — never leave a toggle on
      // that was not saved.
      const confirmed = confirmedFlagsRef.current[flag];
      setDbFlags((current) => ({ ...(current || {}), [flag]: Boolean(confirmed) }));
      if (templateRef.current?.settings?.featureFlags?.[flag] === enabled) setTemplateFlag(flag, previousTemplateValue);
      setFlagError(`"${flag}" was not saved: ${reason}`);
    }
    if (pendingFlagSavesRef.current === 0) {
      const failed = failedFlagsRef.current.size > 0;
      setFlagStatus(failed ? "error" : "saved");
      if (!failed) setFlagError("");
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
            className="min-h-20 w-full rounded-lg border border-[#303839]/15 bg-white p-3 text-sm outline-none transition focus:border-[#303839]/60 focus:ring-2 focus:ring-[#303839]/15"
            value={settings.templateDescription || ""}
            onChange={(e) => patchSettings({ templateDescription: e.target.value })}
          />
        </Field>
        <Field label="Notes for administrators" hint="Never shown to customers.">
          <textarea
            className="min-h-20 w-full rounded-lg border border-[#303839]/15 bg-white p-3 text-sm outline-none transition focus:border-[#303839]/60 focus:ring-2 focus:ring-[#303839]/15"
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
          {flagStatus === "saving" && <p className="mt-2 text-xs font-semibold text-[#303839]/60" role="status">Saving feature flags…</p>}
          {flagError && <p className="mt-2 text-xs font-bold text-red-700" role="alert">{flagError}</p>}
        </div>
        {[
          ["customizer_v2", "Customizer V2"],
          ["customizer_v2_grids", "Photo grids"],
          ["customizer_v2_groups", "Persistent groups"],
          ["customizer_v2_mockups", "Product mockups"],
          ["customizer_v2_perspective_mockups", "Four-corner perspective"],
          ["customizer_v2_server_rendering", "Server rendering"],
          ["customizer_v2_print_pdf", "Print PDF"],
          ["customizer_v2_customer_layers", "Customer layers panel"],
          ["customizer_v2_customer_multiselect", "Customer multiselect"],
          ["customizer_v2_customer_grouping", "Customer grouping"],
          ["customizer_v2_qr_codes", "QR codes"],
          ["customizer_v2_customer_shapes", "Customer shapes"],
          ["customizer_v2_customer_lines", "Customer lines"],
          ["customizer_v2_customer_frames", "Customer frames"],
          ["customizer_v2_customer_grids", "Customer grids"],
          ["customizer_v2_image_filters", "Image filters"],
          ["customizer_v2_product_preview_editing", "Product preview editing"],
          ["customizer_v2_split_view", "Split view"],
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
        {!artboardConsistent && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            <span>
              The canvas ({board.widthPx} × {board.heightPx} px) does not match the printed size ({board.widthIn} × {board.heightIn} in at {board.dpi} DPI), so print output would be scaled.
            </span>
            <button type="button" onClick={() => resize({})} className="rounded-full bg-amber-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-800">
              Match canvas to printed size
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Card size" hint="Changing the size scales the design to fit — it is never stretched.">
            <span className="relative block min-w-0">
              <select
                aria-label="Card size"
                className={`${inputCls} appearance-none pr-10`}
                value={sizePreset?.id || "custom"}
                onChange={(e) => {
                  const preset = CARD_SIZE_PRESETS.find((item) => item.id === e.target.value);
                  if (!preset) return;
                  // A preset keeps the card's current orientation.
                  const landscape = board.widthIn > board.heightIn;
                  resize({
                    widthIn: landscape ? preset.heightIn : preset.widthIn,
                    heightIn: landscape ? preset.widthIn : preset.heightIn,
                  });
                }}
              >
                {CARD_SIZE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} ({canvasPixelsFor(preset.widthIn, board.dpi)} × {canvasPixelsFor(preset.heightIn, board.dpi)} px at {board.dpi} DPI)
                  </option>
                ))}
                <option value="custom" disabled={Boolean(sizePreset)}>Custom size</option>
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#303839]/50" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </Field>
          <Field label="Card width (in)"><SettingStepper label="Card width in inches" value={board.widthIn} minimum={0.25} maximum={100} step={0.01} onCommit={(widthIn: number) => resize({ widthIn })} /></Field>
          <Field label="Card height (in)"><SettingStepper label="Card height in inches" value={board.heightIn} minimum={0.25} maximum={100} step={0.01} onCommit={(heightIn: number) => resize({ heightIn })} /></Field>
          <Field label="DPI"><SettingStepper label="Print DPI" value={board.dpi} minimum={PRODUCTION_RENDER_LIMITS.minDpi} maximum={PRODUCTION_RENDER_LIMITS.maxDpi} onCommit={(dpi: number) => resize({ dpi })} /></Field>
          <Field label="Canvas (px)" hint="The printed size at its DPI.">
            <span data-artboard-pixels className="flex h-10 items-center rounded-lg border border-[#303839]/10 bg-[#F8F6F1] px-3 text-sm font-semibold tabular-nums text-[#303839]">
              {board.widthPx} × {board.heightPx}
            </span>
          </Field>
          <Field label="Orientation">
            <span className="relative block min-w-0">
              {/* Orientation is a real change of the artboard, not a label: the
                  card's dimensions swap and the design is carried across in ONE
                  change (one undo step). The value shown is read from the
                  dimensions, so it can never disagree with them. */}
              <select
                aria-label="Orientation"
                className={`${inputCls} appearance-none pr-10`}
                value={orientation}
                disabled={orientation === "square"}
                onChange={(e) => {
                  const next = e.target.value === "landscape" ? "landscape" : "portrait";
                  onChange(changeTemplateOrientation(t, next).template);
                }}
              >
                <option value="portrait">Vertical (Portrait)</option>
                <option value="landscape">Horizontal (Landscape)</option>
                {orientation === "square" && <option value="square">Square</option>}
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
              <SettingStepper
                key={side}
                label={`Safe area ${side}`}
                value={safe[side] ?? 0}
                minimum={0}
                maximum={5000}
                onCommit={(value: number) => patch({ safeArea: { ...safe, [side]: value } })}
              />
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Bleed (px)</span>
          <div className="grid grid-cols-4 gap-2">
            {["top", "right", "bottom", "left"].map((side) => (
              <SettingStepper
                key={side}
                label={`Bleed ${side}`}
                value={bleed[side] ?? 0}
                minimum={0}
                maximum={5000}
                onCommit={(value: number) => patch({ bleed: { ...bleed, [side]: value } })}
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
        {[
          ["allowCustomerShapes", "Allow customers to add shapes"],
          ["allowCustomerLines", "Allow customers to add lines"],
          ["allowCustomerFrames", "Allow customers to add photo frames"],
          ["allowCustomerGrids", "Allow customers to add photo grids"],
          ["allowCustomerQRCodes", "Allow customers to add QR codes"],
          ["allowCustomerBackground", "Allow customers to edit page backgrounds"],
          ["allowCustomerGrouping", "Allow customers to group permitted objects"],
          ["showCustomerLayers", "Show the customer Layers panel"],
        ].map(([key, label]) => (
          <Toggle key={key} checked={Boolean(settings[key])} onChange={(value: boolean) => patchSettings({ [key]: value })} label={label} />
        ))}
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

      <section className="grid gap-4 rounded-xl border border-[#303839]/12 bg-white p-4 shadow-[0_12px_30px_rgba(48,56,57,0.04)] md:p-5 xl:col-span-2">
        <div>
          <h4 className="font-display text-xl text-[#303839]">Customer content limits</h4>
          <p className="mt-1 text-xs leading-5 text-[#303839]/50">Optional allowlists and hard page bounds. An empty allowlist keeps every available option enabled; saved customizations are checked against these rules on the server.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Fonts" hint="Leave empty to allow the complete Google Fonts catalog."><GoogleFontMultiSelect value={settings.allowedCustomerFonts} onChange={(value: string[]) => patchSettings({ allowedCustomerFonts: value })} /></Field>
          <Field label="Customer-created content pages"><MultiChoice value={settings.allowedCustomerPages} options={(t.pages || []).filter((page: any) => page.enabled !== false).map((page: any) => ({ value: page.id, label: page.label || page.name || page.id }))} onChange={(value: string[]) => patchSettings({ allowedCustomerPages: value })} /></Field>
          <Field label="Shapes"><MultiChoice value={settings.allowedCustomerShapes} options={["rectangle", "rounded-rectangle", "circle", "oval", "triangle", "polygon", "arch"].map((value) => ({ value, label: value.replaceAll("-", " ") }))} onChange={(value: string[]) => patchSettings({ allowedCustomerShapes: value })} /></Field>
          <Field label="Frame masks"><MultiChoice value={settings.allowedCustomerFrameMasks} options={["rectangle", "rounded", "circle", "oval", "arch", "arch-top", "arch-bottom"].map((value) => ({ value, label: value.replaceAll("-", " ") }))} onChange={(value: string[]) => patchSettings({ allowedCustomerFrameMasks: value })} /></Field>
          <Field label="Grid layouts"><MultiChoice value={settings.allowedCustomerGridPresets} options={GRID_PRESETS.map((preset) => ({ value: preset.id, label: `${preset.label} · ${preset.photoCount}` }))} onChange={(value: string[]) => patchSettings({ allowedCustomerGridPresets: value })} /></Field>
          <Field label="Image filters"><MultiChoice value={settings.allowedCustomerImageFilters} options={["brightness", "contrast", "saturation", "grayscale", "sepia", "tint"].map((value) => ({ value, label: value }))} onChange={(value: string[]) => patchSettings({ allowedCustomerImageFilters: value })} /></Field>
          <Field label="Allowed colours" hint="Comma-separated hex colours, for example #303839, #D4AF37. Leave blank for the full colour picker."><input className={inputCls} value={(settings.allowedCustomerColors || []).join(", ")} onChange={(event) => patchSettings({ allowedCustomerColors: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="#303839, #D4AF37" /></Field>
          <Field label="Allowed element IDs" hint="Optional comma-separated IDs from the Elements library."><input className={inputCls} value={(settings.allowedCustomerElementIds || []).join(", ")} onChange={(event) => patchSettings({ allowedCustomerElementIds: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="Leave blank to allow the full library" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Field label="Objects / page" hint="0 means unlimited"><SettingStepper label="Maximum customer objects per page" value={settings.maxCustomerObjectsPerPage ?? 0} minimum={0} maximum={500} onCommit={(maxCustomerObjectsPerPage: number) => patchSettings({ maxCustomerObjectsPerPage })} /></Field>
          {[
            ["minWidth", "Min width"], ["maxWidth", "Max width"], ["minHeight", "Min height"], ["maxHeight", "Max height"],
            ["minRotation", "Min rotation"], ["maxRotation", "Max rotation"], ["insetLeft", "Left inset"], ["insetTop", "Top inset"], ["insetRight", "Right inset"], ["insetBottom", "Bottom inset"],
          ].map(([key, label]) => <Field key={key} label={label}><SettingStepper label={label} value={settings.customerObjectLimits?.[key] ?? (key === "minRotation" ? -360 : key === "maxRotation" ? 360 : 0)} minimum={key.includes("Rotation") ? -360 : 0} maximum={key.includes("Rotation") ? 360 : 20000} onCommit={(value: number) => patchSettings({ customerObjectLimits: { ...(settings.customerObjectLimits || {}), [key]: value } })} /></Field>)}
        </div>
      </section>
    </div>
  );
}
