"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { normalizeInlineText } from "@/lib/customizer/v2/text-editing";

type Props = {
  value: string;
  multiline: boolean;
  scale: number;
  textStyle?: Record<string, any>;
  onDraftChange?: (value: string) => void;
  onCommit: (value: string) => void;
  onEscape?: () => void;
  onCancel?: () => void;
};

export default function InlineCanvasTextEditor({
  value,
  multiline,
  scale,
  textStyle = {},
  onDraftChange,
  onCommit,
  onEscape,
}: Props) {
  const initialValueRef = useRef(normalizeInlineText(value, multiline));
  const [draft, setDraft] = useState(initialValueRef.current);
  const draftRef = useRef(draft);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const finishedRef = useRef(false);
  const suppressBlurRef = useRef(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(initialValueRef.current.length, initialValueRef.current.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const next = normalizeInlineText(draftRef.current, multiline);
    onCommit(next);
  };

  const editorStyle: CSSProperties = {
    fontFamily: `"${textStyle.fontFamily || "Cormorant Garamond"}", serif`,
    fontSize: `${(Number(textStyle.fontSize) || 48) * scale}px`,
    fontWeight: textStyle.fontWeight || "400",
    fontStyle: textStyle.fontStyle === "italic" ? "italic" : "normal",
    letterSpacing: `${(Number(textStyle.letterSpacing) || 0) * scale}px`,
    lineHeight: Number(textStyle.lineHeight) || 1.15,
    textAlign: textStyle.textAlign || "center",
    color: textStyle.color || "#303839",
    whiteSpace: multiline ? "pre-wrap" : "nowrap",
    overflowWrap: multiline ? "anywhere" : "normal",
    wordBreak: multiline ? "break-word" : "normal",
    resize: "none",
    overflow: multiline ? "auto" : "hidden",
    touchAction: "manipulation",
  };

  const shared = {
    ref: inputRef as any,
    value: draft,
    "aria-label": "Edit text on canvas",
    placeholder: "Type here",
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = normalizeInlineText(event.target.value, multiline);
      draftRef.current = next;
      setDraft(next);
      onDraftChange?.(next);
    },
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    onPointerMove: (event: React.PointerEvent) => event.stopPropagation(),
    onPointerUp: (event: React.PointerEvent) => event.stopPropagation(),
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
    onDoubleClick: (event: React.MouseEvent) => event.stopPropagation(),
    onBlur: () => {
      if (suppressBlurRef.current) {
        suppressBlurRef.current = false;
        return;
      }
      finish();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        suppressBlurRef.current = true;
        finish();
        onEscape?.();
        event.currentTarget.blur();
      } else if (!multiline && event.key === "Enter") {
        event.preventDefault();
        suppressBlurRef.current = true;
        finish();
        event.currentTarget.blur();
      }
    },
    className:
      "absolute inset-0 z-40 m-0 box-border h-full w-full rounded-[2px] border border-[#D4AF37] bg-white/96 p-0 text-inherit caret-[#303839] outline-none ring-2 ring-[#D4AF37]/15 selection:bg-[#D4AF37]/25",
    style: editorStyle,
  };

  return (
    <>
      {multiline ? <textarea {...shared} /> : <input {...shared} type="text" />}
      <div className="absolute -bottom-14 right-0 z-50 flex h-12 items-center gap-2 rounded-xl border border-[#303839]/10 bg-white px-2 shadow-[0_8px_24px_rgba(48,56,57,0.16)]">
        <span className="hidden whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.1em] text-[#303839]/45 sm:inline">
          Editing text
        </span>
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            suppressBlurRef.current = true;
            finish();
            inputRef.current?.blur();
          }}
          className="min-h-11 cursor-pointer rounded-lg bg-[#303839] px-4 text-[11px] font-bold text-white transition-colors hover:bg-[#414b4c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
        >
          Done
        </button>
      </div>
    </>
  );
}
