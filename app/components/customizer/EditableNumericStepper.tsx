"use client";

import { useEffect, useRef, useState } from "react";
import {
  defaultNumericFormat,
  parseNumericDraft,
  sanitizeNumericDraft,
  stepNumericValue,
  type NumericStepperRules,
} from "@/lib/customizer/numeric-stepper";

export type EditableNumericStepperProps = {
  label: string;
  value: number;
  minimum?: number;
  maximum?: number;
  step?: number;
  largeStep?: number;
  allowNegative?: boolean;
  allowDecimal?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  onPreviewChange?: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel?: (value: number) => void;
  formatValue?: (value: number) => string;
  className?: string;
  buttonClassName?: string;
  inputClassName?: string;
  /** Inline styles for the value input. Needed because globals.css sets a
   *  padding shorthand on every `input` outside Tailwind's layers, which wins
   *  over `px-*` utilities and would otherwise eat the value column. */
  inputStyle?: React.CSSProperties;
  showLabel?: boolean;
  labelClassName?: string;
  compact?: boolean;
  showStepButtons?: boolean;
  mixed?: boolean;
  /** Exact pixel width for each arrow button. Overrides `compact`, so a
   *  toolbar can guarantee the value column keeps a known readable width. */
  stepButtonWidth?: number;
};

export default function EditableNumericStepper({
  label,
  value,
  minimum,
  maximum,
  step = 1,
  largeStep,
  allowNegative = minimum === undefined || minimum < 0,
  allowDecimal = !Number.isInteger(step),
  disabled = false,
  readOnly = false,
  onPreviewChange,
  onCommit,
  onCancel,
  formatValue,
  className = "h-10 w-full rounded-lg border border-[#303839]/15 bg-white shadow-sm",
  buttonClassName = "grid h-full min-h-10 place-items-center text-[#303839]/55 transition hover:bg-[#F8F6F1] hover:text-[#303839] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-25",
  inputClassName = "h-full min-w-0 w-full bg-transparent px-1 text-center text-xs font-extrabold tabular-nums text-[#303839] outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-40",
  inputStyle,
  showLabel = false,
  labelClassName = "col-span-3 text-center text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45",
  compact = false,
  showStepButtons = true,
  mixed = false,
  stepButtonWidth,
}: EditableNumericStepperProps) {
  const rules: NumericStepperRules = { minimum, maximum, step, largeStep, allowNegative, allowDecimal };
  const format = (next: number) => formatValue ? formatValue(next) : defaultNumericFormat(next, step);
  const [draft, setDraft] = useState(() => mixed ? "" : format(value));
  const [editing, setEditing] = useState(false);
  const originalValue = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommit = useRef(false);
  const draftDirty = useRef(false);

  useEffect(() => {
    const hasFocus = document.activeElement === inputRef.current;
    setDraft(mixed ? "" : format(value));
    originalValue.current = value;
    if (!hasFocus) {
      draftDirty.current = false;
      setEditing(false);
    }
    // formatValue is intentionally caller-owned; value/step changes are the
    // synchronization contract for canvas movement and selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, step, mixed]);

  const commitDraft = () => {
    const hasNumber = !["", "-", ".", "-."].includes(draft);
    const next = parseNumericDraft(draft, originalValue.current, rules);
    setDraft(mixed && !hasNumber ? "" : format(next));
    setEditing(false);
    // With a preview channel the value has already moved on the canvas, so
    // `next === value` is the normal case: commit still has to fire to close
    // the interaction and seal its single history entry.
    const shouldCommit = draftDirty.current && hasNumber && (mixed || next !== value || Boolean(onPreviewChange));
    draftDirty.current = false;
    if (shouldCommit) onCommit(next);
  };

  const applyStep = (direction: -1 | 1, large = false) => {
    if (disabled || readOnly) return;
    const base = editing ? parseNumericDraft(draft, value, rules) : value;
    const next = stepNumericValue(base, direction, rules, large);
    setDraft(format(next));
    originalValue.current = next;
    draftDirty.current = false;
    onCommit(next);
  };

  const explicitColumns = showStepButtons && stepButtonWidth
    ? `${stepButtonWidth}px minmax(0,1fr) ${stepButtonWidth}px`
    : undefined;
  const columns = explicitColumns
    ? ""
    : showStepButtons
      ? compact
        ? "grid-cols-[26px_minmax(0,1fr)_26px]"
        : "grid-cols-[34px_minmax(0,1fr)_34px]"
      : "grid-cols-1";
  const rowClass = showLabel ? `grid ${columns} grid-rows-[13px_1fr] items-center overflow-hidden` : `grid ${columns} items-center overflow-hidden`;
  const resolvedLabelClassName = showStepButtons ? labelClassName : labelClassName.replace("col-span-3", "");

  return (
    <div
      role="group"
      aria-label={label}
      style={explicitColumns ? { gridTemplateColumns: explicitColumns } : undefined}
      className={`${rowClass} ${className}`}
    >
      {showLabel && <span className={resolvedLabelClassName}>{label}</span>}
      {showStepButtons && (
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => applyStep(-1)} disabled={disabled || readOnly || value <= (minimum ?? -Infinity)} className={`${buttonClassName} border-r border-[#303839]/10`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode={allowDecimal || allowNegative ? "decimal" : "numeric"}
        aria-label={label}
        value={draft}
        placeholder={mixed ? "Mixed" : undefined}
        disabled={disabled}
        readOnly={readOnly}
        onFocus={(event) => {
          const input = event.currentTarget;
          originalValue.current = value;
          setEditing(true);
          window.requestAnimationFrame(() => input.select());
        }}
        onClick={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const sanitized = sanitizeNumericDraft(event.target.value, rules);
          if (sanitized === null) return;
          setDraft(sanitized);
          draftDirty.current = true;
          const preview = Number(sanitized);
          if (onPreviewChange && Number.isFinite(preview)) onPreviewChange(parseNumericDraft(sanitized, value, rules));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
            skipBlurCommit.current = true;
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(mixed ? "" : format(originalValue.current));
            setEditing(false);
            draftDirty.current = false;
            onCancel?.(originalValue.current);
            event.currentTarget.select();
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            applyStep(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
            window.requestAnimationFrame(() => inputRef.current?.select());
          }
        }}
        onBlur={() => {
          if (skipBlurCommit.current) {
            skipBlurCommit.current = false;
            return;
          }
          commitDraft();
        }}
        className={inputClassName}
        style={inputStyle}
      />
      {showStepButtons && (
        <button type="button" aria-label={`Increase ${label}`} onClick={() => applyStep(1)} disabled={disabled || readOnly || value >= (maximum ?? Infinity)} className={`${buttonClassName} border-l border-[#303839]/10`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
        </button>
      )}
    </div>
  );
}
