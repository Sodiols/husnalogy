"use client";

/**
 * `<input type="color">` for colours that edit the design.
 *
 * While the user drags inside the browser's colour picker, Chrome delivers
 * BURSTS of `input` events within a single task. Committing each one (a
 * document write, an undo entry, a product-form update, a canvas render)
 * produced dozens of nested synchronous React updates and tripped React's
 * "Maximum update depth exceeded" guard. This input keeps the drag local and
 * reports at most ONE colour per animation frame, plus the final colour the
 * moment the picker closes (the native `change` event) — so the canvas still
 * follows the drag live, and nothing is lost.
 *
 * The element is uncontrolled: React never rewrites its value during a
 * re-render (which would also push the value back into an open picker). It is
 * synced from `value` only when the colour changes from outside — undo, another
 * selection — and never while a picked colour is still waiting to be reported.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "onInput"> & {
  /** The current colour (any hex spelling; invalid values show `fallback`). */
  value: string | null | undefined;
  /** Called with a lower-case #rrggbb at most once per frame while picking, and on close. */
  onChange: (colour: string) => void;
  fallback?: string;
};

/** The #rrggbb an `<input type="color">` can show for a stored colour. */
export function colourInputValue(value: unknown, fallback = "#000000"): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  if (/^#[0-9a-f]{8}$/.test(text)) return text.slice(0, 7);
  return fallback.toLowerCase();
}

/**
 * Keyboard focus must be visible even when the input is an invisible overlay
 * on a colour chip (opacity-0): it then shows itself, outlined. Pointer clicks
 * do not match :focus-visible on a colour input, so nothing changes for them.
 */
const FOCUS_VISIBLE = "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#303839]";

export default function ColourInput({ value, onChange, fallback = "#000000", className = "", ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const pending = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const shown = colourInputValue(value, fallback);
  // The last colour reported and not yet contradicted by an outside change:
  // the close of the picker never reports the same colour twice (one undo step).
  const reported = useRef<string | null>(null);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  const flush = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (next === null || next === reported.current) return;
    reported.current = next;
    onChangeRef.current(next);
  }, []);

  // Outside changes (undo, another selection) reach the element; a colour the
  // user just picked is never overwritten before it has been reported.
  useEffect(() => {
    if (shown !== reported.current) reported.current = null;
    const element = ref.current;
    if (element && pending.current === null && element.value.toLowerCase() !== shown) element.value = shown;
  }, [shown]);

  // The picker closed: report the final colour now, not on the next frame.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.addEventListener("change", flush);
    return () => {
      element.removeEventListener("change", flush);
      flush();
    };
  }, [flush]);

  return (
    <input
      {...rest}
      ref={ref}
      type="color"
      className={`${className} ${FOCUS_VISIBLE}`.trim()}
      defaultValue={shown}
      onChange={(event) => {
        pending.current = event.currentTarget.value.toLowerCase();
        if (frame.current === null) {
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            flush();
          });
        }
      }}
    />
  );
}
