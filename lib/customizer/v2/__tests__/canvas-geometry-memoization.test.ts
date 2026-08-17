import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Spec §30: "memoizing expensive geometry calculations… avoiding whole document
// cloning on every pointer movement where unnecessary".
//
// Both canvases derive their interaction geometry in the render body. A drag
// pushes a state update on every pointermove, so without memoization each
// pointer event re-walked the template, re-applied every customer override and
// re-measured EVERY text layer on a canvas 2D context — for a gesture that
// moves one object.
//
// These assertions are deliberately structural. The cost only shows up under a
// real pointer stream, which neither vitest nor the available e2e environment
// can exercise, so the guard is that the memoization is still in place.

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
const workspace = read("app/components/customizer/CustomizerWorkspace.tsx");
const adminCanvas = read("app/admin/dashboard/design-builder/AdminCanvas.tsx");

describe("customer workspace geometry is memoized", () => {
  it("memoizes the page's effective layers", () => {
    expect(workspace).toContain("const layers = useMemo(");
    expect(workspace).toContain("[template, pageId, editorState],");
  });

  it("memoizes the interactive-layer filter chain", () => {
    expect(workspace).toContain("const interactiveLayers = useMemo(");
    expect(workspace).toContain("[layers, previewMode, cropLayer, cropGridLayer, editingGroupId],");
  });

  it("memoizes the text-measuring geometry pass", () => {
    expect(workspace).toContain("const resolvedInteractiveLayers = useMemo(");
    expect(workspace).toContain("[interactiveLayers, template, values, safeBounds, textMetricsRevision]");
  });

  it("tracks the font-load revision so measurements refresh once webfonts land", () => {
    // The revision used to be discarded (`const [, setTextMetricsRevision]`),
    // which would have made the memo hold on to fallback measurements.
    expect(workspace).toContain("const [textMetricsRevision, setTextMetricsRevision] = useState(0);");
    expect(workspace).not.toContain("const [, setTextMetricsRevision] = useState(0);");
  });

  it("memoizes safe bounds so they do not break the geometry memo by identity", () => {
    expect(workspace).toContain("const safeBounds: SafeBounds = useMemo(");
  });
});

describe("admin canvas geometry is memoized", () => {
  it("memoizes the page layers and the selectable set", () => {
    expect(adminCanvas).toContain("const layers = useMemo(() => layersForPage(template, pageId), [template, pageId]);");
    expect(adminCanvas).toContain("const selectableLayers = useMemo(");
  });

  it("memoizes the text-measuring geometry pass", () => {
    expect(adminCanvas).toContain("const resolvedSelectableLayers = useMemo(");
    expect(adminCanvas).toContain("[selectableLayers, template, values],");
  });

  it("does not depend on a font revision it does not have", () => {
    // The admin measurer is created once eagerly, unlike the customer one.
    expect(adminCanvas).toContain("if (!textMeasureRef.current) textMeasureRef.current = createCanvasMeasure();");
    expect(adminCanvas).not.toContain("[selectableLayers, template, values, textMetricsRevision]");
  });
});

describe("both canvases still import useMemo", () => {
  it("customer workspace", () => {
    expect(workspace).toContain('import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";');
  });

  it("admin canvas", () => {
    expect(adminCanvas).toContain('import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";');
  });
});
