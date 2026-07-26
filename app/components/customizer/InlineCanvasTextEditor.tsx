"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Props = {
  value: string;
  multiline: boolean;
  scale: number;
  textStyle?: Record<string, any>;
  onCommit: (value: string) => void;
  onCancel: () => void;
};

export default function InlineCanvasTextEditor({
  value,
  multiline,
  scale,
  textStyle = {},
  onCommit,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const cancelBlur = useRef(false);

  useEffect(() => {
    setDraft(value);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(value.length, value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  const finish = () => {
    const next = multiline ? draft : draft.replace(/[\r\n]+/g, " ");
    if (next !== value) onCommit(next);
    else onCancel();
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
    overflow: "auto",
  };

  const shared = {
    ref: inputRef as any,
    value: draft,
    "aria-label": "Edit text on canvas",
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    onDoubleClick: (event: React.MouseEvent) => event.stopPropagation(),
    onBlur: () => {
      if (cancelBlur.current) {
        cancelBlur.current = false;
        return;
      }
      finish();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        cancelBlur.current = true;
        onCancel();
        event.currentTarget.blur();
      } else if (!multiline && event.key === "Enter") {
        event.preventDefault();
        finish();
      }
    },
    className:
      "absolute inset-0 z-40 m-0 box-border h-full w-full border border-[#D4AF37] bg-white/95 p-0 text-inherit outline-none ring-2 ring-[#D4AF37]/20",
    style: editorStyle,
  };

  return multiline ? <textarea {...shared} /> : <input {...shared} type="text" />;
}
