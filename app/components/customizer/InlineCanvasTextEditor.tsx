"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import {
  applyTextEditLimits,
  insertTextNewline,
  isTextEditorSafeTarget,
  normalizeInlineText,
  resolveTextEditorKeyAction,
} from "@/lib/customizer/v2/text-editing";

type Props = {
  value: string;
  /** Whether the persisted layer is already multiline. */
  multiline: boolean;
  /** Whether this editing surface may convert the layer to multiline. */
  allowMultiline?: boolean;
  maxLines?: number;
  maxLength?: number;
  scale: number;
  textStyle?: Record<string, any>;
  onDraftChange?: (value: string) => void;
  onMultilineActivate?: () => void;
  onCommit: (value: string) => void;
  onCancel?: () => void;
  onEscape?: () => void;
};

type EditorPosition = {
  top: number;
  left: number;
  width: number;
  mobile: boolean;
  maxTextHeight: number;
};

const VIEWPORT_MARGIN = 12;
const DESKTOP_TOP_INSET = 72;
const EDITOR_GAP = 12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function visualViewportBox() {
  const viewport = window.visualViewport;
  return {
    top: viewport?.offsetTop || 0,
    left: viewport?.offsetLeft || 0,
    width: viewport?.width || window.innerWidth,
    height: viewport?.height || window.innerHeight,
  };
}

export default function InlineCanvasTextEditor({
  value,
  multiline,
  allowMultiline = multiline,
  maxLines = 0,
  maxLength = 0,
  scale,
  textStyle = {},
  onDraftChange,
  onMultilineActivate,
  onCommit,
  onCancel,
  onEscape,
}: Props) {
  const initialValueRef = useRef(normalizeInlineText(value, multiline));
  const [draft, setDraft] = useState(initialValueRef.current);
  const [message, setMessage] = useState("");
  const [mounted, setMounted] = useState(false);
  const [textHeight, setTextHeight] = useState(44);
  const [position, setPosition] = useState<EditorPosition>({
    top: VIEWPORT_MARGIN,
    left: VIEWPORT_MARGIN,
    width: 320,
    mobile: false,
    maxTextHeight: 320,
  });
  const draftRef = useRef(draft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const finishedRef = useRef(false);
  const multilineRef = useRef(multiline);
  const layoutFrameRef = useRef<number | null>(null);

  const restoreCanvasFocus = useCallback(() => {
    const canvasLayer = anchorRef.current?.parentElement;
    if (canvasLayer instanceof HTMLElement) canvasLayer.focus({ preventScroll: true });
  }, []);

  const publishDraft = useCallback(
    (rawValue: string) => {
      let next = normalizeInlineText(rawValue, multilineRef.current);
      const limited = applyTextEditLimits(next, { maxLines, maxLength });
      next = limited.value;
      draftRef.current = next;
      setDraft(next);
      onDraftChange?.(next);
      if (limited.limitedBy === "lines") {
        setMessage(`This field supports up to ${maxLines} ${maxLines === 1 ? "line" : "lines"}.`);
      } else if (limited.limitedBy === "characters") {
        setMessage(`This field supports up to ${maxLength} characters.`);
      } else {
        setMessage("");
      }
      return next;
    },
    [maxLength, maxLines, onDraftChange],
  );

  const activateMultiline = useCallback(() => {
    if (multilineRef.current) return;
    multilineRef.current = true;
    onMultilineActivate?.();
  }, [onMultilineActivate]);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const next = normalizeInlineText(draftRef.current, multilineRef.current);
    onCommit(next);
    restoreCanvasFocus();
  }, [onCommit, restoreCanvasFocus]);

  const cancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel?.();
    onEscape?.();
    restoreCanvasFocus();
  }, [onCancel, onEscape, restoreCanvasFocus]);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current?.parentElement;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const viewport = visualViewportBox();
    const viewportRight = viewport.left + viewport.width;
    const viewportBottom = viewport.top + viewport.height;
    const anchorRect = anchor.getBoundingClientRect();
    const mobile = viewport.width < 640;
    const width = mobile
      ? Math.max(240, viewport.width - VIEWPORT_MARGIN * 2)
      : clamp(Math.max(anchorRect.width, 280), 280, Math.min(420, viewport.width - VIEWPORT_MARGIN * 2));
    const panelHeight = panel.offsetHeight || 150;
    const maxTextHeight = Math.max(88, Math.min(320, viewport.height * (mobile ? 0.38 : 0.46)));
    let left = clamp(
      anchorRect.left + anchorRect.width / 2 - width / 2,
      viewport.left + VIEWPORT_MARGIN,
      viewportRight - width - VIEWPORT_MARGIN,
    );
    let top: number;

    if (mobile) {
      top = Math.max(
        viewport.top + VIEWPORT_MARGIN,
        viewportBottom - panelHeight - VIEWPORT_MARGIN,
      );
    } else {
      const topLimit = viewport.top + DESKTOP_TOP_INSET;
      const bottomLimit = viewportBottom - VIEWPORT_MARGIN;
      const fitsAbove = anchorRect.top - EDITOR_GAP - panelHeight >= topLimit;
      const fitsBelow = anchorRect.bottom + EDITOR_GAP + panelHeight <= bottomLimit;

      if (fitsAbove) {
        top = anchorRect.top - EDITOR_GAP - panelHeight;
      } else if (fitsBelow) {
        top = anchorRect.bottom + EDITOR_GAP;
      } else if (anchorRect.right + EDITOR_GAP + width <= viewportRight - VIEWPORT_MARGIN) {
        left = anchorRect.right + EDITOR_GAP;
        top = clamp(anchorRect.top, topLimit, bottomLimit - panelHeight);
      } else if (anchorRect.left - EDITOR_GAP - width >= viewport.left + VIEWPORT_MARGIN) {
        left = anchorRect.left - EDITOR_GAP - width;
        top = clamp(anchorRect.top, topLimit, bottomLimit - panelHeight);
      } else {
        const roomAbove = anchorRect.top - topLimit;
        const roomBelow = bottomLimit - anchorRect.bottom;
        top = roomAbove >= roomBelow
          ? clamp(anchorRect.top - EDITOR_GAP - panelHeight, topLimit, bottomLimit - panelHeight)
          : clamp(anchorRect.bottom + EDITOR_GAP, topLimit, bottomLimit - panelHeight);
      }
    }

    setPosition((current) => {
      const next = { top, left, width, mobile, maxTextHeight };
      return current.top === next.top &&
        current.left === next.left &&
        current.width === next.width &&
        current.mobile === next.mobile &&
        current.maxTextHeight === next.maxTextHeight
        ? current
        : next;
    });
  }, []);

  const requestPositionUpdate = useCallback(() => {
    if (layoutFrameRef.current !== null) return;
    layoutFrameRef.current = window.requestAnimationFrame(() => {
      layoutFrameRef.current = null;
      updatePosition();
    });
  }, [updatePosition]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    multilineRef.current = multilineRef.current || multiline;
  }, [multiline]);

  useLayoutEffect(() => {
    if (!mounted) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(position.maxTextHeight, Math.max(44, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > position.maxTextHeight ? "auto" : "hidden";
    setTextHeight(nextHeight);
    requestPositionUpdate();
  }, [draft, mounted, position.maxTextHeight, requestPositionUpdate, textStyle]);

  useEffect(() => {
    if (!mounted) return;
    const frame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(initialValueRef.current.length, initialValueRef.current.length);
      updatePosition();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mounted, updatePosition]);

  useEffect(() => {
    if (!mounted) return;
    const anchor = anchorRef.current?.parentElement;
    const panel = panelRef.current;
    const observer = new ResizeObserver(requestPositionUpdate);
    if (anchor) observer.observe(anchor);
    if (panel) observer.observe(panel);

    const viewport = window.visualViewport;
    window.addEventListener("resize", requestPositionUpdate);
    window.addEventListener("orientationchange", requestPositionUpdate);
    window.addEventListener("scroll", requestPositionUpdate, true);
    viewport?.addEventListener("resize", requestPositionUpdate);
    viewport?.addEventListener("scroll", requestPositionUpdate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", requestPositionUpdate);
      window.removeEventListener("orientationchange", requestPositionUpdate);
      window.removeEventListener("scroll", requestPositionUpdate, true);
      viewport?.removeEventListener("resize", requestPositionUpdate);
      viewport?.removeEventListener("scroll", requestPositionUpdate);
      if (layoutFrameRef.current !== null) window.cancelAnimationFrame(layoutFrameRef.current);
    };
  }, [mounted, requestPositionUpdate]);

  useEffect(() => {
    if (!mounted) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const canvasLayer = anchorRef.current?.parentElement;
      if (isTextEditorSafeTarget(target)) return;
      if (target instanceof Node && canvasLayer?.contains(target)) return;
      finish();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [finish, mounted]);

  const editorStyle: CSSProperties = {
    fontFamily: `"${textStyle.fontFamily || "Cormorant Garamond"}", serif`,
    fontSize: `${clamp((Number(textStyle.fontSize) || 48) * Math.max(scale, 0.01), 16, 28)}px`,
    fontWeight: textStyle.fontWeight || "400",
    fontStyle: textStyle.fontStyle === "italic" ? "italic" : "normal",
    letterSpacing: `${clamp((Number(textStyle.letterSpacing) || 0) * Math.max(scale, 0.01), -2, 8)}px`,
    lineHeight: Number(textStyle.lineHeight) || 1.25,
    textAlign: textStyle.textAlign || "left",
    color: textStyle.color || "#303839",
    height: textHeight,
    maxHeight: position.maxTextHeight,
  };

  const editor = mounted ? createPortal(
    <div
      ref={panelRef}
      data-customizer-text-editor
      role={position.mobile ? "dialog" : "group"}
      aria-label="Edit your text"
      className="fixed z-[260] rounded-2xl border border-[#303839]/12 bg-white p-3 shadow-[0_18px_48px_rgba(48,56,57,0.22)] sm:p-3.5"
      style={{ top: position.top, left: position.left, width: position.width }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!nextTarget) return;
        if (nextTarget instanceof Node && panelRef.current?.contains(nextTarget)) return;
        if (isTextEditorSafeTarget(nextTarget)) return;
        finish();
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <label
          htmlFor="customizer-inline-text-editor"
          className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/65"
        >
          Edit your text
        </label>
        <span className="hidden text-[10px] font-semibold text-[#303839]/42 sm:inline">
          Ctrl/Cmd + Enter to save
        </span>
      </div>
      <textarea
        ref={textareaRef}
        id="customizer-inline-text-editor"
        value={draft}
        rows={1}
        aria-label="Edit text on canvas"
        aria-describedby="customizer-inline-text-help customizer-inline-text-status"
        placeholder="Type here"
        onChange={(event) => {
          const raw = event.target.value;
          if (/[\r\n]/.test(raw)) {
            if (!allowMultiline) {
              setMessage("This field supports one line only.");
              publishDraft(normalizeInlineText(raw, false));
              return;
            }
            activateMultiline();
          }
          publishDraft(raw);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          const action = resolveTextEditorKeyAction(event, allowMultiline);

          if (action === "cancel") {
            event.preventDefault();
            cancel();
            return;
          }
          if (action === "commit") {
            event.preventDefault();
            finish();
            return;
          }
          if (action === "blocked-newline") {
            event.preventDefault();
            setMessage("This field supports one line only.");
            return;
          }
          if (action === "newline") {
            event.preventDefault();
            activateMultiline();
            const inserted = insertTextNewline(draftRef.current, {
              start: event.currentTarget.selectionStart ?? draftRef.current.length,
              end: event.currentTarget.selectionEnd ?? draftRef.current.length,
            });
            const next = publishDraft(inserted.value);
            const caret = Math.min(inserted.caret, next.length);
            window.requestAnimationFrame(() => {
              textareaRef.current?.focus();
              textareaRef.current?.setSelectionRange(caret, caret);
            });
          }
        }}
        className="block min-h-11 w-full resize-none rounded-xl border border-[#303839]/16 bg-white px-3 py-2 text-[#303839] caret-[#303839] outline-none transition-[border-color,box-shadow] selection:bg-[#D4AF37]/25 focus:border-[#D4AF37] focus:ring-4 focus:ring-[#D4AF37]/15"
        style={editorStyle}
      />
      <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
        <div className="min-w-0">
          <p id="customizer-inline-text-help" className="text-[10px] font-semibold text-[#303839]/48">
            {allowMultiline ? "Enter adds a new line" : "Single-line field"}
          </p>
          <p
            id="customizer-inline-text-status"
            role="status"
            aria-live="polite"
            className={`mt-0.5 text-[10px] font-bold ${message ? "text-[#8a701d]" : "sr-only"}`}
          >
            {message || "Editing text"}
          </p>
        </div>
        <button
          type="button"
          title="Done (Ctrl/Cmd + Enter)"
          onPointerDown={(event) => event.preventDefault()}
          onClick={finish}
          className="min-h-11 min-w-20 cursor-pointer rounded-xl bg-[#303839] px-4 text-[11px] font-bold text-white transition-colors hover:bg-[#414b4c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2"
        >
          Done
        </button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <span ref={anchorRef} aria-hidden className="pointer-events-none absolute inset-0" />
      {editor}
    </>
  );
}
