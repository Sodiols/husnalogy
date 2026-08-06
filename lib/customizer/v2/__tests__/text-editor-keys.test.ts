import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyTextEditLimits,
  insertTextNewline,
  isCommitTextShortcut,
  isTextEditorSafeTarget,
  normalizeInlineText,
  resolveTextEditorKeyAction,
} from "../text-editing";
import { validateCustomerState } from "../validate";
import { fallbackMeasure, layoutText } from "../text-layout";
import { buildPageSvg } from "../svg";
import { normalizeEditorState, normalizeUserLayer } from "@/lib/customizer";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const key = (over: Record<string, unknown> = {}) => ({
  key: "Enter",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("resolveTextEditorKeyAction", () => {
  it("makes plain Enter a real line break in a multiline editor", () => {
    expect(resolveTextEditorKeyAction(key(), true)).toBe("newline");
  });

  it("never lets plain Enter commit or close a multiline editor", () => {
    for (const modifiers of [{}, { shiftKey: true }, { altKey: true }]) {
      expect(resolveTextEditorKeyAction(key(modifiers), true)).not.toBe("commit");
      expect(resolveTextEditorKeyAction(key(modifiers), true)).not.toBe("cancel");
    }
  });

  it("commits on Ctrl+Enter and Cmd+Enter, in both editor modes", () => {
    for (const multiline of [true, false]) {
      expect(resolveTextEditorKeyAction(key({ ctrlKey: true }), multiline)).toBe("commit");
      expect(resolveTextEditorKeyAction(key({ metaKey: true }), multiline)).toBe("commit");
      // Held together with Shift it still commits rather than inserting a line.
      expect(resolveTextEditorKeyAction(key({ ctrlKey: true, shiftKey: true }), multiline)).toBe("commit");
    }
  });

  it("never lets plain Enter save a field that forbids multiline", () => {
    expect(resolveTextEditorKeyAction(key(), false)).toBe("blocked-newline");
  });

  it("cancels on Escape", () => {
    expect(resolveTextEditorKeyAction(key({ key: "Escape" }), true)).toBe("cancel");
    expect(resolveTextEditorKeyAction(key({ key: "Escape" }), false)).toBe("cancel");
  });

  it("ignores keys that are not Enter or Escape", () => {
    expect(resolveTextEditorKeyAction(key({ key: "a" }), true)).toBe("none");
    expect(resolveTextEditorKeyAction(key({ key: "Tab" }), true)).toBe("none");
    expect(resolveTextEditorKeyAction(key({ key: "a", ctrlKey: true }), true)).toBe("none");
  });

  it("never commits mid-IME-composition", () => {
    // Committing while a Bangla/Arabic/CJK candidate window is open would drop
    // half-typed input.
    expect(resolveTextEditorKeyAction(key({ isComposing: true, ctrlKey: true }), true)).toBe("none");
    expect(resolveTextEditorKeyAction(key({ nativeEvent: { isComposing: true } }), false)).toBe("none");
    expect(resolveTextEditorKeyAction(key({ keyCode: 229 }), false)).toBe("none");
    expect(resolveTextEditorKeyAction(key({ nativeEvent: { keyCode: 229 } }), true)).toBe("none");
  });

  it("survives a missing or malformed event", () => {
    expect(resolveTextEditorKeyAction(null as never, true)).toBe("none");
    expect(isCommitTextShortcut(null as never)).toBe(false);
  });
});

describe("isCommitTextShortcut", () => {
  it("matches only Ctrl/Cmd + Enter", () => {
    expect(isCommitTextShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isCommitTextShortcut(key({ metaKey: true }))).toBe(true);
    expect(isCommitTextShortcut(key())).toBe(false);
    expect(isCommitTextShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isCommitTextShortcut(key({ key: "s", ctrlKey: true }))).toBe(false);
  });
});

describe("inline canvas editor wiring (customer + admin)", () => {
  const inline = read("app/components/customizer/InlineCanvasTextEditor.tsx");

  it("routes every keystroke through the shared resolver", () => {
    expect(inline).toContain("resolveTextEditorKeyAction");
    expect(inline).toContain('const action = resolveTextEditorKeyAction(event, allowMultiline)');
    // The old "single-line only" Enter test is gone.
    expect(inline).not.toContain('!multiline && event.key === "Enter"');
  });

  it("preventDefaults on commit so Ctrl+Enter cannot also insert a line break", () => {
    const commitBranch = inline.slice(
      inline.indexOf('if (action === "commit")'),
      inline.indexOf('if (action === "blocked-newline")'),
    );
    expect(commitBranch).toContain("event.preventDefault()");
    expect(commitBranch).toContain("finish()");
  });

  it("inserts a newline explicitly, restores the caret, and does not commit", () => {
    const newlineBranch = inline.slice(
      inline.indexOf('if (action === "newline")'),
      inline.indexOf("className=", inline.indexOf('if (action === "newline")')),
    );
    expect(newlineBranch).toContain("insertTextNewline");
    expect(newlineBranch).toContain("setSelectionRange");
    expect(newlineBranch).not.toContain("finish()");
  });

  it("is the single editor used by both the customer and admin canvases", () => {
    for (const path of [
      "app/components/customizer/CustomizerWorkspace.tsx",
      "app/admin/dashboard/design-builder/AdminCanvas.tsx",
    ]) {
      expect(read(path)).toContain("<InlineCanvasTextEditor");
    }
  });

  it("keeps the Done button and tells the customer about the shortcut", () => {
    expect(inline).toMatch(/>\s*Done\s*<\/button>/);
    expect(inline).toContain('title="Done (Ctrl/Cmd + Enter)"');
    expect(inline).toContain("Enter adds a new line");
  });
});

describe("multiline insertion, limits, and outside-click classification", () => {
  it("inserts one newline at the selection and preserves text on both sides", () => {
    expect(insertTextNewline("hello world", { start: 5, end: 6 })).toEqual({
      value: "hello\nworld",
      caret: 6,
    });
    expect(insertTextNewline("abcd", { start: 1, end: 3 })).toEqual({
      value: "a\nd",
      caret: 2,
    });
  });

  it("repeated Enter creates additional canonical lines without collapsing them", () => {
    const first = insertTextNewline("Salman", { start: 6, end: 6 });
    const second = insertTextNewline(first.value, { start: first.caret, end: first.caret });
    expect(first.value).toBe("Salman\n");
    expect(second.value).toBe("Salman\n\n");
    expect(second.value.split("\n")).toHaveLength(3);
  });

  it("preserves intentional newlines while enforcing configured limits", () => {
    expect(applyTextEditLimits("\nA\nB\n", { maxLines: 3 })).toEqual({
      value: "\nA\nB",
      limitedBy: "lines",
    });
    expect(applyTextEditLimits("AB\nCD", { maxLength: 4 })).toEqual({
      value: "AB\nC",
      limitedBy: "characters",
    });
  });

  it("keeps editor and toolbar regions active but classifies the canvas as outside", () => {
    const target = (match: boolean) => ({ closest: () => match ? {} : null });
    expect(isTextEditorSafeTarget(target(true))).toBe(true);
    expect(isTextEditorSafeTarget(target(false))).toBe(false);
    expect(isTextEditorSafeTarget(null)).toBe(false);
  });

  it("guards outside-click and blur completion with one shared finished flag", () => {
    const inline = read("app/components/customizer/InlineCanvasTextEditor.tsx");
    expect(inline).toContain("if (finishedRef.current) return");
    expect(inline).toContain('document.addEventListener("pointerdown", onPointerDown, true)');
    expect(inline).toContain("finish();");
  });
});

describe("canonical live update and history wiring", () => {
  it("updates multiline mode and the exact draft in the canonical owners", () => {
    const admin = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
    const customer = read("app/products/[slug]/personalize/personalize-client.tsx");
    const preview = read("app/admin/dashboard/design-builder/AdminCustomerPreview.tsx");
    expect(admin).toContain("canonicalTextLayerUpdate(text, current.textStyle)");
    expect(admin).toContain("tRef.current = next");
    expect(customer).toContain("canonicalTextLayerUpdate(rawText, layer.textStyle)");
    expect(preview).toContain("canonicalTextLayerUpdate(rawText, layer.textStyle)");
  });

  it("keeps the original and promoted snapshots distinct for undo and redo", () => {
    const original = {
      values: { names: "Salman" },
      editorState: { layerOverrides: {}, userLayers: [] },
    };
    const promoted = {
      values: { names: "Salman\nadfasdf" },
      editorState: { layerOverrides: {}, userLayers: [] },
    };
    const past = [structuredClone(original)];
    const future: typeof past = [];
    const undone = past.pop()!;
    future.push(structuredClone(promoted));
    expect(undone.values.names).toBe("Salman");
    const redone = future.pop()!;
    past.push(structuredClone(undone));
    expect(redone.values.names).toBe("Salman\nadfasdf");

    const customer = read("app/products/[slug]/personalize/personalize-client.tsx");
    expect(customer).toContain("recordHistory();");
    expect(customer).toContain("history.undo(snapshot())");
    expect(customer).toContain("history.redo(snapshot())");
  });
});

describe("customizer text panels share the same shortcut", () => {
  it.each([
    ["app/components/customizer/CustomerEditPanel.tsx"],
    ["app/components/customizer/CustomerAddTextPanel.tsx"],
    ["app/admin/dashboard/design-builder/AdminPropertiesPanel.tsx"],
  ])("%s commits on Ctrl+Enter without inserting a break", (path) => {
    const source = read(path);
    expect(source).toContain("resolveTextEditorKeyAction");
    expect(source).toContain("event.preventDefault()");
  });
});

describe("global shortcuts never steal a keystroke while typing", () => {
  it.each([
    ["app/products/[slug]/personalize/personalize-client.tsx"],
    ["app/admin/dashboard/design-builder/AdminDesignBuilder.tsx"],
  ])("%s bails out of its window keydown handler for INPUT/TEXTAREA", (path) => {
    const source = read(path);
    expect(source).toMatch(/tagName === "INPUT" \|\| \w+\.tagName === "TEXTAREA"/);
    expect(source).toMatch(/if \(typing(?: \|\| tab !== "design")?\) return;/);
  });
});

describe("an Enter-typed line break survives the whole pipeline", () => {
  // One value, followed from the keystroke to the print file.
  const template = {
    id: "tpl_multiline",
    version: 3,
    canvasWidthPx: 1500,
    canvasHeightPx: 2100,
    safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
    settings: {},
    pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
    fields: [{ id: "names", label: "Names", type: "text", customerVisible: true }],
    layers: [
      {
        id: "names_layer",
        name: "Names",
        page: "front",
        type: "text",
        fieldId: "names",
        customerEditable: true,
        x: 750,
        y: 700,
        width: 900,
        height: 300,
        zIndex: 1,
        opacity: 1,
        text: "",
        textStyle: {
          fontFamily: "Cormorant Garamond",
          fontSize: 72,
          lineHeight: 1.2,
          textAlign: "center",
          multiline: true,
        },
      },
    ],
  };

  // 1. The customer pressed Enter between the two names. The browser may hand
  //    us \n or \r\n depending on platform and paste source.
  const typed = "MADISON\r\n&\nKENNEDY";

  it("1. the editor normalizes the keystroke to a canonical \\n", () => {
    expect(normalizeInlineText(typed, true)).toBe("MADISON\n&\nKENNEDY");
  });

  it("2. the server accepts and preserves it on save", () => {
    const result = validateCustomerState(template, { values: { names: normalizeInlineText(typed, true) } });
    expect(result.violations.some((v) => v.code === "multiline-not-allowed")).toBe(false);
    expect(result.sanitizedValues.names).toBe("MADISON\n&\nKENNEDY");
  });

  it("3. it round-trips through JSON storage (autosave, refresh, cart, order)", () => {
    const saved = validateCustomerState(template, { values: { names: normalizeInlineText(typed, true) } })
      .sanitizedValues;
    const reloaded = JSON.parse(JSON.stringify(saved)) as Record<string, string>;
    expect(reloaded.names).toBe("MADISON\n&\nKENNEDY");
    expect(reloaded.names.split("\n")).toHaveLength(3);
  });

  it("4. reopening a saved design keeps the break in editor state", () => {
    const state = normalizeEditorState({
      layerOverrides: { names_layer: { properties: { text: "MADISON\r\n&\nKENNEDY" } } },
    });
    expect(state.layerOverrides.names_layer.properties.text).toBe("MADISON\n&\nKENNEDY");

    const userLayer = normalizeUserLayer({
      type: "text",
      page: "front",
      text: "MADISON\r\n&\nKENNEDY",
      textStyle: { multiline: true },
    });
    expect(userLayer.text).toBe("MADISON\n&\nKENNEDY");
  });

  it("5. the preview lays it out as three lines", () => {
    const laid = layoutText(
      {
        text: "MADISON\n&\nKENNEDY",
        width: 900,
        height: 300,
        fontFamily: "Cormorant Garamond",
        fontSize: 72,
        lineHeight: 1.2,
        multiline: true,
      },
      fallbackMeasure,
    );
    expect(laid.lines.map((line) => line.text)).toEqual(["MADISON", "&", "KENNEDY"]);
  });

  it("6. the print file emits one tspan per line", () => {
    const svg = buildPageSvg({
      template,
      values: { names: "MADISON\n&\nKENNEDY" },
      pageId: "front",
      mode: "print",
      measure: fallbackMeasure,
    });
    expect(svg.match(/<tspan /g)).toHaveLength(3);
    expect(svg).toContain(">MADISON</tspan>");
    expect(svg).toContain(">&amp;</tspan>");
    expect(svg).toContain(">KENNEDY</tspan>");
  });

  it("7. Ctrl+Enter contributes no extra line to any of the above", () => {
    // The commit shortcut is resolved before the textarea can insert anything,
    // so the committed value is exactly what was on screen.
    expect(resolveTextEditorKeyAction(key({ ctrlKey: true }), true)).toBe("commit");
    const committed = normalizeInlineText("MADISON\n&\nKENNEDY", true);
    expect(committed.split("\n")).toHaveLength(3);
    expect(committed.endsWith("\n")).toBe(false);
  });
});
