"use client";

import { createGridSlotsFromPreset, GRID_PRESETS } from "@/lib/customizer/v2/grids";
import { isValidQRValue, qrContrastRatio } from "@/lib/customizer/v2/qr";
import EditableNumericStepper from "./EditableNumericStepper";
import ToolbarDropdown, { type ToolbarDropdownOption } from "./ToolbarDropdown";

const lineStyleOptions: ToolbarDropdownOption[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const strokeCapOptions: ToolbarDropdownOption[] = [
  { value: "butt", label: "Flat stroke" },
  { value: "round", label: "Round stroke" },
  { value: "square", label: "Square stroke" },
];

const endpointOptions: ToolbarDropdownOption[] = [
  { value: "none", label: "None" },
  { value: "circle", label: "Circle" },
  { value: "arrow", label: "Arrow" },
];

const errorCorrectionOptions: ToolbarDropdownOption[] = [
  { value: "L", label: "Low" },
  { value: "M", label: "Medium" },
  { value: "Q", label: "Quartile" },
  { value: "H", label: "High" },
];

const moduleStyleOptions: ToolbarDropdownOption[] = [
  { value: "square", label: "Square modules" },
  { value: "rounded", label: "Rounded modules" },
];

const arrangeActions = [
  {
    action: "bringToFront",
    label: "To front",
    path: "M8 8h10v10H8zM5 5h10v3M5 5v10h3",
  },
  {
    action: "bringForward",
    label: "Forward",
    path: "M8 8h10v10H8zM5 5h10v3M5 5v10h3M12 14V8m0 0-2.5 2.5M12 8l2.5 2.5",
  },
  {
    action: "sendBackward",
    label: "Backward",
    path: "M6 6h10v10H6zM9 9h10v10H9M12 10v6m0 0-2.5-2.5M12 16l2.5-2.5",
  },
  {
    action: "sendToBack",
    label: "To back",
    path: "M6 6h10v10H6zM9 9h10v10H9",
  },
] as const;

const alignActions = [
  { action: "alignLeft", label: "Left" },
  { action: "alignCenter", label: "Centre" },
  { action: "alignRight", label: "Right" },
  { action: "alignTop", label: "Top" },
  { action: "alignMiddle", label: "Middle" },
  { action: "alignBottom", label: "Bottom" },
] as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/52">
      {children}
    </h3>
  );
}

function PanelStepper({
  label,
  value,
  minimum,
  maximum,
  step = 1,
  disabled,
  onCommit,
  percent = false,
}: any) {
  return (
    <EditableNumericStepper
      label={label}
      value={value}
      minimum={minimum}
      maximum={maximum}
      step={step}
      largeStep={step < 1 ? step * 10 : Math.max(5, step * 5)}
      allowNegative={minimum === undefined || minimum < 0}
      allowDecimal={step < 1}
      disabled={disabled}
      formatValue={percent ? (next) => `${Math.round(next)}%` : undefined}
      onCommit={onCommit}
      showLabel
      showStepButtons={false}
      className="h-14 w-full px-1"
      inputClassName="h-9 w-full rounded-xl border border-[#303839]/12 bg-white px-3 text-left text-sm font-bold tabular-nums text-[#303839] outline-none transition-colors hover:border-[#303839]/25 focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:cursor-not-allowed disabled:opacity-45"
    />
  );
}

function ColourControl({ label, value, disabled, onChange }: any) {
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-center justify-between rounded-xl border border-[#303839]/10 bg-white px-3 ${
        disabled ? "cursor-not-allowed opacity-45" : ""
      }`}
    >
      <span className="text-xs font-semibold text-[#303839]">{label}</span>
      <span className="relative grid h-8 w-8 place-items-center rounded-full border border-[#303839]/15 bg-white shadow-sm">
        <span className="h-5 w-5 rounded-full" style={{ backgroundColor: value }} aria-hidden />
        <input
          type="color"
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </span>
    </label>
  );
}

function ActionButton({
  label,
  onClick,
  path,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  path: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[#303839]/10 bg-white px-3 text-left text-[11px] font-bold text-[#303839] transition-colors hover:border-[#303839]/20 hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:bg-white disabled:text-[#303839]/30"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={path} />
      </svg>
      <span>{label}</span>
    </button>
  );
}

export default function CustomerSelectionPanel({
  layers,
  permissions = {},
  isUserLayer = false,
  onOpacity,
  onPatch,
  onArrange,
  onAlign,
  onGroup,
  onUngroup,
  onDuplicate,
  onDelete,
  canDelete = false,
  canArrange = true,
}: any) {
  if (!layers?.length) return null;

  const layer = layers[0];
  const opacity = Math.round((Number(layer?.opacity) || 0) * 100);
  const allow = (permission: string) => isUserLayer || Boolean(permissions[permission]);
  const canOpacity = allow("changeOpacity");
  const canStyle = allow("editStyle");
  const layerLabel =
    layers.length > 1
      ? `${layers.length} items`
      : layer.name || layer.fieldLabel || layer.text || layer.type || "Selected item";
  const qrReadable =
    layer?.type !== "qrCode" ||
    (isValidQRValue(layer.value) &&
      qrContrastRatio(layer.foregroundColor || "#303839", layer.backgroundColor || "#ffffff") >= 4.5 &&
      Number(layer.width) >= 96);

  return (
    <section
      data-customer-selection-panel
      aria-label="Selected item controls"
      className="border-b border-[#303839]/10 bg-white px-4 py-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#D4AF37]">
            Selected item
          </p>
          <p className="mt-0.5 truncate text-sm font-bold text-[#303839]">{layerLabel}</p>
        </div>
        <span className="shrink-0 rounded-full border border-[#303839]/10 bg-white px-2.5 py-1 text-[9px] font-bold capitalize text-[#303839]/55">
          {layers.length === 1 ? layer.type : "Multiple"}
        </span>
      </div>

      {layers.length === 1 && (
        <div className="mt-4">
          <PanelStepper
            label="Opacity"
            value={opacity}
            minimum={0}
            maximum={100}
            step={5}
            disabled={!canOpacity}
            percent
            onCommit={(value: number) => onOpacity(value / 100)}
          />
        </div>
      )}

      {layers.length === 1 && layer.type === "shape" && (
        <div className="mt-5 grid gap-3">
          <SectionTitle>Appearance</SectionTitle>
          <ColourControl
            label={layer.shape === "line" ? "Colour" : "Fill"}
            value={layer.shape === "line" ? layer.stroke || "#303839" : layer.fill || "#F8F6F1"}
            disabled={!canStyle}
            onChange={(value: string) =>
              onPatch(layer.shape === "line" ? { stroke: value } : { fill: value })
            }
          />
          {layer.shape !== "line" && (
            <ColourControl
              label="Border"
              value={layer.stroke || "#303839"}
              disabled={!canStyle}
              onChange={(stroke: string) => onPatch({ stroke })}
            />
          )}
          <PanelStepper
            label={layer.shape === "line" ? "Thickness" : "Border width"}
            value={layer.strokeWidth || 0}
            minimum={0}
            maximum={40}
            disabled={!canStyle}
            onCommit={(strokeWidth: number) => onPatch({ strokeWidth })}
          />
          {layer.shape === "line" && (
            <>
              <ToolbarDropdown
                label="Line style"
                value={layer.lineStyle || "solid"}
                onChange={(lineStyle) => onPatch({ lineStyle })}
                options={lineStyleOptions}
                width="w-full"
                disabled={!canStyle}
              />
              <ToolbarDropdown
                label="Stroke cap"
                value={layer.lineCap || "round"}
                onChange={(lineCap) => onPatch({ lineCap })}
                options={strokeCapOptions}
                width="w-full"
                disabled={!canStyle}
              />
              <div className="grid grid-cols-2 gap-2">
                <ToolbarDropdown
                  label="Start cap"
                  value={layer.lineStartCap || "none"}
                  onChange={(lineStartCap) => onPatch({ lineStartCap })}
                  options={endpointOptions}
                  width="w-full"
                  disabled={!canStyle}
                />
                <ToolbarDropdown
                  label="End cap"
                  value={layer.lineEndCap || "none"}
                  onChange={(lineEndCap) => onPatch({ lineEndCap })}
                  options={endpointOptions}
                  width="w-full"
                  disabled={!canStyle}
                />
              </div>
            </>
          )}
        </div>
      )}

      {layers.length === 1 && layer.type === "frame" && (
        <div className="mt-5 grid gap-3">
          <SectionTitle>Frame</SectionTitle>
          <ColourControl
            label="Border"
            value={layer.borderColor || "#303839"}
            disabled={!canStyle}
            onChange={(borderColor: string) => onPatch({ borderColor })}
          />
          <PanelStepper
            label="Border width"
            value={layer.borderWidth || 0}
            minimum={0}
            maximum={40}
            disabled={!canStyle}
            onCommit={(borderWidth: number) => onPatch({ borderWidth })}
          />
        </div>
      )}

      {layers.length === 1 && layer.type === "grid" && (
        <div className="mt-5 grid gap-3">
          <SectionTitle>Photo grid</SectionTitle>
          {layer.isUserLayer && (
            <label className="grid gap-1.5">
              <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">
                Layout
              </span>
              <span className="relative">
                <select
                  aria-label="Grid layout"
                  defaultValue=""
                  onChange={(event) => {
                    const preset = GRID_PRESETS.find((item) => item.id === event.target.value);
                    if (preset) {
                      onPatch({
                        columns: preset.columns,
                        rows: preset.rows,
                        slots: createGridSlotsFromPreset(preset.id),
                      });
                    }
                    event.currentTarget.value = "";
                  }}
                  className="min-h-11 w-full cursor-pointer appearance-none rounded-xl border border-[#303839]/12 bg-white px-3 pr-10 text-xs font-bold text-[#303839] outline-none focus:ring-2 focus:ring-[#D4AF37]"
                >
                  <option value="" disabled>
                    Change layout
                  </option>
                  {GRID_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <svg
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#303839]/45"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <PanelStepper
              label="Grid gap"
              value={layer.gap || 0}
              minimum={0}
              maximum={80}
              disabled={!canStyle}
              onCommit={(gap: number) => onPatch({ gap })}
            />
            <PanelStepper
              label="Grid padding"
              value={layer.padding || 0}
              minimum={0}
              maximum={100}
              disabled={!canStyle}
              onCommit={(padding: number) => onPatch({ padding })}
            />
          </div>
          <PanelStepper
            label="Corner radius"
            value={layer.cornerRadius || 0}
            minimum={0}
            maximum={120}
            disabled={!canStyle}
            onCommit={(cornerRadius: number) => onPatch({ cornerRadius })}
          />
        </div>
      )}

      {layers.length === 1 && layer.type === "qrCode" && (
        <div className="mt-5 grid gap-3">
          <SectionTitle>QR code</SectionTitle>
          <label className="grid gap-1.5">
            <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">
              Destination URL
            </span>
            <input
              type="url"
              disabled={!canStyle}
              value={layer.value || ""}
              onChange={(event) => onPatch({ value: event.target.value })}
              className="h-11 rounded-xl border border-[#303839]/12 bg-white px-3 text-xs text-[#303839] outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:cursor-not-allowed disabled:opacity-45"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <ColourControl
              label="Code"
              value={layer.foregroundColor || "#303839"}
              disabled={!canStyle}
              onChange={(foregroundColor: string) => onPatch({ foregroundColor })}
            />
            <ColourControl
              label="Background"
              value={layer.backgroundColor || "#ffffff"}
              disabled={!canStyle}
              onChange={(backgroundColor: string) => onPatch({ backgroundColor })}
            />
          </div>
          <PanelStepper
            label="QR margin"
            value={layer.margin ?? 4}
            minimum={0}
            maximum={12}
            disabled={!canStyle}
            onCommit={(margin: number) => onPatch({ margin })}
          />
          <ToolbarDropdown
            label="Error correction"
            value={layer.errorCorrection || "M"}
            onChange={(errorCorrection) => onPatch({ errorCorrection })}
            options={errorCorrectionOptions}
            width="w-full"
            disabled={!canStyle}
          />
          <ToolbarDropdown
            label="Module style"
            value={layer.moduleStyle || "square"}
            onChange={(moduleStyle) => onPatch({ moduleStyle })}
            options={moduleStyleOptions}
            width="w-full"
            disabled={!canStyle}
          />
          <span
            role="status"
            className={`rounded-xl px-3 py-2 text-[10px] font-bold ${
              qrReadable ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            }`}
          >
            {qrReadable ? "QR code is readable" : "Improve QR code readability"}
          </span>
        </div>
      )}

      <div className="mt-5 grid gap-3">
        <SectionTitle>Layer order</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {arrangeActions.map((item) => (
            <ActionButton
              key={item.action}
              label={item.label}
              path={item.path}
              onClick={() => onArrange(item.action)}
              disabled={!canArrange}
            />
          ))}
        </div>
        {!canArrange && (
          <p className="text-[10px] leading-4 text-[#303839]/50">
            Layer order is locked for this item.
          </p>
        )}
      </div>

      {layers.length > 1 && (
        <div className="mt-5 grid gap-3">
          <SectionTitle>Align selection</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            {alignActions.map((item) => (
              <button
                key={item.action}
                type="button"
                onClick={() => onAlign(item.action)}
                className="min-h-11 cursor-pointer rounded-xl border border-[#303839]/10 bg-white px-2 text-[10px] font-bold text-[#303839] transition-colors hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              >
                {item.label}
              </button>
            ))}
          </div>
          {layers.length > 2 && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onAlign("distributeHorizontal")}
                className="min-h-11 cursor-pointer rounded-xl border border-[#303839]/10 bg-white px-2 text-[10px] font-bold text-[#303839] hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              >
                Distribute across
              </button>
              <button
                type="button"
                onClick={() => onAlign("distributeVertical")}
                className="min-h-11 cursor-pointer rounded-xl border border-[#303839]/10 bg-white px-2 text-[10px] font-bold text-[#303839] hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              >
                Distribute down
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-[#303839]/10 pt-4">
        {layers.length > 1 && (
          <button
            type="button"
            onClick={onGroup}
            className="min-h-11 flex-1 cursor-pointer rounded-xl border border-[#303839]/10 bg-white px-3 text-xs font-bold text-[#303839] hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
          >
            Group
          </button>
        )}
        {layers.length === 1 && layer.type === "group" && (
          <button
            type="button"
            onClick={onUngroup}
            className="min-h-11 flex-1 cursor-pointer rounded-xl border border-[#303839]/10 bg-white px-3 text-xs font-bold text-[#303839] hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
          >
            Ungroup
          </button>
        )}
        <button
          type="button"
          onClick={onDuplicate}
          className="min-h-11 flex-1 cursor-pointer rounded-xl border border-[#303839]/10 bg-white px-3 text-xs font-bold text-[#303839] hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
        >
          Duplicate
        </button>
        {canDelete && (
          <button
            type="button"
            title="Delete"
            aria-label={
              layers.length === 1 ? "Delete selected object" : `Delete ${layers.length} selected objects`
            }
            onClick={onDelete}
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-red-200 bg-white text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}
