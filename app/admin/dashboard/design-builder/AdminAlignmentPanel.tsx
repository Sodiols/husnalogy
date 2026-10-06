"use client";

import { useEffect, useState } from "react";
import {
  ROTATE_STEP,
  SCALE_STEP,
  alignmentPanelAvailability,
  type AlignmentTarget,
  type PanelAction,
} from "@/lib/customizer/v2/admin-toolbar-state";
import type { AlignMode } from "./builder-utils";

type Props = {
  selectionCount: number;
  canTransform: boolean;
  /** The rotation shown in the Rotate field: the objects' shared angle, or mixed. */
  rotation: { value: number; mixed: boolean };
  onClose: () => void;
  onAlign: (mode: AlignMode, target: AlignmentTarget) => void;
  onDistribute: (axis: "horizontal" | "vertical", target: AlignmentTarget) => void;
  onFlip: (axis: "horizontal" | "vertical") => void;
  onScale: (factor: number) => void;
  /** Turn the selection by this many degrees (rigidly, about its centre). */
  onRotateBy: (degrees: number) => void;
};

function Icon({ path, size = 20 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  close: "M6 6l12 12M18 6 6 18",
  chevron: "m6 9 6 6 6-6",
  left: "M4 3v18M8 7h12v4H8zM8 14h7v4H8z",
  centerH: "M12 3v18M5 7h14v4H5zM8 14h8v4H8z",
  right: "M20 3v18M4 7h12v4H4zM9 14h7v4H9z",
  top: "M3 4h18M7 8h4v12H7zM14 8h4v7h-4z",
  middle: "M3 12h18M7 5h4v14H7zM14 8h4v8h-4z",
  bottom: "M3 20h18M7 4h4v12H7zM14 9h4v7h-4z",
  distributeH: "M3 4v16M21 4v16M8 8h3v8H8zM13 8h3v8h-3z",
  distributeV: "M4 3h16M4 21h16M8 8h8v3H8zM8 13h8v3H8z",
  flipH: "M12 3v18M9 7 4 17h5zM15 7l5 10h-5z",
  flipV: "M3 12h18M7 9 17 4v5zM7 15l10 5v-5z",
  smaller: "M5 12h14",
  larger: "M12 5v14M5 12h14",
  rotateLeft: "M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5",
  rotateRight: "M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5",
} as const;

const ALIGN_BUTTONS: Array<{ mode: AlignMode; label: string; path: string }> = [
  { mode: "left", label: "Align left", path: ICONS.left },
  { mode: "center", label: "Align horizontal centre", path: ICONS.centerH },
  { mode: "right", label: "Align right", path: ICONS.right },
  { mode: "top", label: "Align top", path: ICONS.top },
  { mode: "middle", label: "Align vertical centre", path: ICONS.middle },
  { mode: "bottom", label: "Align bottom", path: ICONS.bottom },
];

const TILE =
  "flex flex-col items-center justify-center gap-1 rounded-xl border border-[#303839]/10 bg-white py-2.5 text-[12px] font-medium text-[#303839] transition-colors hover:border-[#303839]/25 hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] disabled:cursor-not-allowed disabled:border-[#303839]/6 disabled:bg-[#303839]/[0.02] disabled:text-[#303839]/30 disabled:hover:bg-[#303839]/[0.02]";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-[#303839]/8 last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`alignment-${id}`}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-[14px] font-semibold text-[#303839] hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#303839]"
        >
          {title}
          <span className={`text-[#303839]/60 transition-transform ${open ? "rotate-180" : ""}`}>
            <Icon path={ICONS.chevron} size={16} />
          </span>
        </button>
      </h3>
      {open && (
        <div id={`alignment-${id}`} className="grid gap-3 px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}

function ActionTile({ label, name, path, action, onClick, showLabel = false, className = "" }: { label: string; name?: string; path: string; action: PanelAction; onClick: () => void; showLabel?: boolean; className?: string }) {
  const accessibleName = name || label;
  return (
    <button
      type="button"
      aria-label={accessibleName}
      title={action.enabled ? accessibleName : `${accessibleName} — ${action.reason}`}
      disabled={!action.enabled}
      onClick={onClick}
      className={`${TILE} ${className}`}
    >
      <Icon path={path} />
      {showLabel && <span>{label}</span>}
    </button>
  );
}

function TargetRadios({
  name,
  value,
  selectionAllowed,
  selectionReason,
  onChange,
}: {
  name: string;
  value: AlignmentTarget;
  selectionAllowed: boolean;
  selectionReason: string;
  onChange: (value: AlignmentTarget) => void;
}) {
  const options: Array<{ value: AlignmentTarget; label: string; disabled: boolean }> = [
    { value: "selection", label: "Selection", disabled: !selectionAllowed },
    { value: "artboard", label: "Artboard", disabled: false },
  ];
  return (
    <div role="radiogroup" aria-label={`${name} relative to`} className="flex items-center gap-5">
      {options.map((option) => (
        <label
          key={option.value}
          title={option.disabled ? selectionReason : undefined}
          className={`flex items-center gap-2 text-[13px] ${option.disabled ? "cursor-not-allowed text-[#303839]/35" : "cursor-pointer text-[#303839]"}`}
        >
          <input
            type="radio"
            name={`alignment-${name}-target`}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
            className="h-4 w-4 accent-[#2B7BD8]"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

function RotateField({ rotation, action, onRotateBy }: { rotation: Props["rotation"]; action: PanelAction; onRotateBy: (degrees: number) => void }) {
  const shown = rotation.mixed ? "" : String(Math.round(rotation.value * 100) / 100);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const typed = Number(String(draft).replace(/°/g, "").trim());
    if (String(draft).trim() === "" || !Number.isFinite(typed)) {
      setDraft(shown);
      return;
    }
    // The field is the angle the objects should END at: turn by the difference.
    // With mixed angles there is no common starting angle, so the value turns
    // the selection by that many degrees.
    const delta = rotation.mixed ? typed : typed - rotation.value;
    if (delta % 360 !== 0) onRotateBy(delta);
    else setDraft(shown);
  };
  return (
    <div className="flex items-center gap-2">
      <ActionTile label={`Rotate ${ROTATE_STEP}° counter-clockwise`} path={ICONS.rotateLeft} action={action} onClick={() => onRotateBy(-ROTATE_STEP)} className="h-11 w-11 shrink-0 py-0" />
      <label className="relative flex-1">
        <span className="sr-only">Rotation in degrees</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder={rotation.mixed ? "Mixed" : "0"}
          disabled={!action.enabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(shown);
            }
          }}
          onBlur={commit}
          className="h-11 w-full rounded-xl border border-[#303839]/12 bg-white pr-7 text-center text-[14px] font-semibold tabular-nums text-[#303839] outline-none focus:border-[#303839]/50 disabled:bg-[#303839]/[0.02] disabled:text-[#303839]/35"
        />
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-[#303839]/50">°</span>
      </label>
      <ActionTile label={`Rotate ${ROTATE_STEP}° clockwise`} path={ICONS.rotateRight} action={action} onClick={() => onRotateBy(ROTATE_STEP)} className="h-11 w-11 shrink-0 py-0" />
    </div>
  );
}

/**
 * The full Alignment panel (Align, Distribute, Flip, Scale, Rotate). Every
 * button calls one shared selection command in the builder, which commits one
 * history step; nothing here edits the document itself.
 */
export default function AdminAlignmentPanel(props: Props) {
  const multiple = props.selectionCount >= 2;
  const [alignTarget, setAlignTarget] = useState<AlignmentTarget>(multiple ? "selection" : "artboard");
  const [distributeTarget, setDistributeTarget] = useState<AlignmentTarget>(props.selectionCount >= 3 ? "selection" : "artboard");
  // A single object can only align to the artboard; a new multi-selection
  // starts on Selection, the useful default for arranging objects together.
  useEffect(() => {
    setAlignTarget(multiple ? "selection" : "artboard");
  }, [multiple]);
  useEffect(() => {
    setDistributeTarget(props.selectionCount >= 3 ? "selection" : "artboard");
  }, [props.selectionCount]);

  const can = alignmentPanelAvailability({ selectionCount: props.selectionCount, canTransform: props.canTransform, distributeTarget });

  return (
    <div id="admin-alignment-panel" data-admin-alignment-panel className="flex h-full flex-col" role="region" aria-label="Alignment">
      <div className="flex items-center justify-between border-b border-[#303839]/8 px-4 py-3.5">
        <h2 className="font-display text-[19px] leading-tight text-[#303839]">Alignment</h2>
        <button
          type="button"
          aria-label="Close alignment"
          onClick={props.onClose}
          className="grid h-9 w-9 place-items-center rounded-full text-[#303839] hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]"
        >
          <Icon path={ICONS.close} size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section id="align" title="Align">
          <div className="grid grid-cols-3 gap-2">
            {ALIGN_BUTTONS.map((button) => (
              <ActionTile key={button.mode} label={button.label} path={button.path} action={can.align} onClick={() => props.onAlign(button.mode, multiple ? alignTarget : "artboard")} />
            ))}
          </div>
          <TargetRadios
            name="Align"
            value={multiple ? alignTarget : "artboard"}
            selectionAllowed={can.selectionTarget.enabled}
            selectionReason={can.selectionTarget.reason}
            onChange={setAlignTarget}
          />
        </Section>
        <Section id="distribute" title="Distribute">
          <div className="grid grid-cols-2 gap-2">
            <ActionTile label="Horizontal" name="Distribute horizontally" path={ICONS.distributeH} action={can.distribute} showLabel onClick={() => props.onDistribute("horizontal", distributeTarget)} />
            <ActionTile label="Vertical" name="Distribute vertically" path={ICONS.distributeV} action={can.distribute} showLabel onClick={() => props.onDistribute("vertical", distributeTarget)} />
          </div>
          <TargetRadios
            name="Distribute"
            value={distributeTarget}
            selectionAllowed={props.selectionCount >= 3}
            selectionReason="Distributing within the selection needs at least three objects."
            onChange={setDistributeTarget}
          />
        </Section>
        <Section id="flip" title="Flip">
          <div className="grid grid-cols-2 gap-2">
            <ActionTile label="Horizontal" name="Flip horizontally" path={ICONS.flipH} action={can.flip} showLabel onClick={() => props.onFlip("horizontal")} />
            <ActionTile label="Vertical" name="Flip vertically" path={ICONS.flipV} action={can.flip} showLabel onClick={() => props.onFlip("vertical")} />
          </div>
        </Section>
        <Section id="scale" title="Scale">
          <div className="grid grid-cols-2 gap-2">
            <ActionTile label="Smaller" name="Scale smaller" path={ICONS.smaller} action={can.scale} showLabel onClick={() => props.onScale(1 / SCALE_STEP)} />
            <ActionTile label="Larger" name="Scale larger" path={ICONS.larger} action={can.scale} showLabel onClick={() => props.onScale(SCALE_STEP)} />
          </div>
        </Section>
        <Section id="rotate" title="Rotate">
          <RotateField rotation={props.rotation} action={can.rotate} onRotateBy={props.onRotateBy} />
        </Section>
      </div>
    </div>
  );
}
