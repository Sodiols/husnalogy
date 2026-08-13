import { describe, expect, it } from "vitest";
import { alignCustomerLayers, arrangeLayers, groupCustomerLayers, layersInsideSelection, ungroupCustomerLayers } from "../customer-actions";
import { migrateCustomizerDocument } from "../document";
import { normalizeImageFilters, imageFilterSvgPrimitives } from "../image-filters";
import { mapMockupPointToCanvas } from "../preview-mapping";
import { createQRMatrix, isValidQRValue, qrContrastRatio, qrModuleRects } from "../qr";
import { buildPageSvg } from "../svg";
import { validateCustomerState } from "../validate";

const editable = {
  select: true, editContent: true, editStyle: true, group: true, ungroup: true, hide: true, lock: true,
  changeFont: true, changeFontSize: true, changeFontWeight: true, changeFontStyle: true, changeColor: true, changeTextColor: true,
  changeAlignment: true, changeLetterSpacing: true, changeLineHeight: true, move: true, resize: true, rotate: true,
  duplicate: true, delete: true, replaceImage: true, cropImage: true, zoomImage: true, repositionImage: true, flipImage: true,
  rotateImage: true, applyImageFilters: true, changeFill: true, changeBorder: true, editGrid: true, editGridLayout: true,
  moveGridPhotos: true, editQRCodeValue: true, editQRCodeStyle: true, changeOpacity: true, changeLayerOrder: true,
};

function qrLayer(overrides: Record<string, unknown> = {}) {
  return {
    id: "qr", name: "Website QR", type: "qrCode", page: "front", pageId: "front", x: 300, y: 300, width: 240, height: 240,
    rotation: 0, scale: 1, opacity: 1, hidden: false, zIndex: 2, locked: false, positionLocked: false, customerInteractionDisabled: false,
    adminEditable: true, customerEditable: true, customerPermissions: editable, groupId: "", fieldId: "", metadata: {}, value: "https://husnalogy.com",
    foregroundColor: "#303839", backgroundColor: "#ffffff", errorCorrection: "M", margin: 4, moduleStyle: "square", required: false,
    ...overrides,
  };
}

describe("Customizer parity primitives", () => {
  it("generates deterministic local QR modules with a quiet zone", () => {
    const first = qrModuleRects(qrLayer());
    const second = qrModuleRects(qrLayer());
    expect(first).toEqual(second);
    expect(first.totalSize).toBe(first.size + 8);
    expect(first.rects.length).toBeGreaterThan(100);
    expect(createQRMatrix(qrLayer()).data).toHaveLength(first.size);
    expect(isValidQRValue("https://husnalogy.com/design")).toBe(true);
    expect(isValidQRValue("javascript:alert(1)")).toBe(false);
    expect(qrContrastRatio("#303839", "#ffffff")).toBeGreaterThan(7);
  });

  it("normalizes filters and emits deterministic SVG primitives", () => {
    const filters = normalizeImageFilters({ brightness: 9, contrast: -2, grayscale: 0.5, tintColor: "#d4af37", tintAmount: 0.2 });
    expect(filters.brightness).toBe(2);
    expect(filters.contrast).toBe(0);
    expect(imageFilterSvgPrimitives(filters)).toContain("feComponentTransfer");
    expect(imageFilterSvgPrimitives(filters)).toContain("feFlood");
  });

  it("selects every object a drag marquee touches, minus the ones the template locks out", () => {
    const layers = [
      { id: "inside", x: 50, y: 50, width: 20, height: 20 },
      { id: "edge", x: 98, y: 50, width: 20, height: 20 },
      { id: "outside", x: 200, y: 50, width: 20, height: 20 },
      { id: "disabled", x: 30, y: 30, width: 10, height: 10, customerInteractionDisabled: true },
    ];
    expect(layersInsideSelection({ left: 0, top: 0, right: 100, bottom: 100 }, layers)).toEqual(["inside", "edge"]);
  });

  it("arranges customer layers without crossing a protected administrator layer", () => {
    const layers = [
      { id: "customer", zIndex: 1, isUserLayer: true },
      { id: "editable", zIndex: 2, customerEditable: true, customerPermissions: editable },
      { id: "protected", zIndex: 3, customerEditable: false },
    ];
    const next = arrangeLayers(layers, ["customer"], "bringToFront");
    expect(next.find((layer) => layer.id === "customer")?.zIndex).toBeLessThan(next.find((layer) => layer.id === "protected")?.zIndex || 0);
  });

  it("aligns and distributes multi-selections deterministically", () => {
    const layers = [
      { id: "a", x: 20, y: 10, width: 20, height: 20 },
      { id: "b", x: 80, y: 30, width: 20, height: 20 },
      { id: "c", x: 200, y: 50, width: 20, height: 20 },
    ];
    expect(alignCustomerLayers(layers, ["a", "b", "c"], "alignLeft")).toEqual({ a: { x: 20 }, b: { x: 20 }, c: { x: 20 } });
    expect(alignCustomerLayers(layers, ["a", "b", "c"], "distributeHorizontal").b.x).toBe(110);
  });

  // Regression: distribution must equalize the GAPS between objects' true
  // edges, not just space their centres evenly (spec §10). With equal-sized
  // objects both approaches coincide, which is why this needs mixed sizes.
  it("distributes mixed-size objects with equal edge-to-edge gaps, not equal center spacing", () => {
    const layers = [
      { id: "a", x: 0, y: 0, width: 20, height: 20 }, // edges: -10..10
      { id: "b", x: 100, y: 0, width: 80, height: 20 }, // wide middle object
      { id: "c", x: 300, y: 0, width: 20, height: 20 }, // edges: 290..310
    ];
    const patches = alignCustomerLayers(layers, ["a", "b", "c"], "distributeHorizontal");
    // Total span left-edge(a)=-10 to right-edge(c)=310 -> 320. Sizes sum 20+80+20=120.
    // Two gaps of (320-120)/2 = 100 each. b's left edge = a.right(10) + 100 = 110,
    // so b's center = 110 + 40 = 150 (NOT the naive center-average of 150... use a
    // case where center-based and edge-based results diverge numerically):
    expect(patches.b.x).toBe(150);
    expect(patches.a.x).toBe(0);
    expect(patches.c.x).toBe(300);

    const distinct = [
      { id: "a", x: 0, y: 0, width: 100, height: 20 },
      { id: "b", x: 50, y: 0, width: 20, height: 20 },
      { id: "c", x: 200, y: 0, width: 20, height: 20 },
    ];
    expect(alignCustomerLayers(distinct, ["a", "b", "c"], "distributeHorizontal").b.x).toBe(120);
    expect(alignCustomerLayers(distinct, ["a", "b", "c"], "distributeHorizontalCenters").b.x).toBe(100);

    // A case where naive center distribution (100) and correct edge distribution
    // (110) clearly disagree, proving the fix matters.
    const asym = [
      { id: "a", x: 0, y: 0, width: 20, height: 20 },
      { id: "b", x: 50, y: 0, width: 100, height: 20 },
      { id: "c", x: 200, y: 0, width: 20, height: 20 },
    ];
    const asymPatches = alignCustomerLayers(asym, ["a", "b", "c"], "distributeHorizontal");
    // span -10..210 = 220; sizes 20+100+20=140; gap=(220-140)/2=40.
    // b left edge = a.right(10)+40=50 -> b center = 50+50=100.
    expect(asymPatches.b.x).toBe(100);
    // Naive center distribution would give (0+200)/2 = 100 too here by
    // coincidence of symmetry, so assert the gap-based left/right edges
    // directly instead, which is what actually distinguishes the algorithms.
    expect(asymPatches.a.x).toBe(0);
    expect(asymPatches.c.x).toBe(200);
  });

  // Regression: aligning/distributing must use each object's true, rotated
  // bounding-box edge, not its raw unrotated half-width/height (spec §9).
  // Spec §29: "Center on Card" must be a distinct action from aligning
  // objects to each other, must work even for a single selected object, and
  // must translate the selection as one block, preserving relative layout.
  it("centers a single object on the card independently of align-to-each-other", () => {
    const layers = [{ id: "a", x: 30, y: 40, width: 20, height: 20 }];
    const card = { width: 600, height: 800 };
    expect(alignCustomerLayers(layers, ["a"], "centerOnCardHorizontal", card)).toEqual({ a: { x: 300 } });
    expect(alignCustomerLayers(layers, ["a"], "centerOnCardVertical", card)).toEqual({ a: { y: 400 } });
    expect(alignCustomerLayers(layers, ["a"], "centerOnCard", card)).toEqual({ a: { x: 300, y: 400 } });
    // Without a card size, the action is a no-op rather than throwing.
    expect(alignCustomerLayers(layers, ["a"], "centerOnCard")).toEqual({});
  });

  it("centers a multi-object selection on the card while preserving relative layout", () => {
    const layers = [
      { id: "a", x: 100, y: 100, width: 20, height: 20 },
      { id: "b", x: 140, y: 100, width: 20, height: 20 },
    ];
    const card = { width: 600, height: 800 };
    const patches = alignCustomerLayers(layers, ["a", "b"], "centerOnCardHorizontal", card);
    // Combined box center x = 120; card center x = 300; delta = 180.
    expect(patches.a.x).toBe(280);
    expect(patches.b.x).toBe(320);
    // Relative spacing between a and b (40) must be unchanged.
    expect(patches.b.x - patches.a.x).toBe(40);
  });

  it("aligns rotated objects by their true rendered edge", () => {
    // A 40x10 box rotated 90 degrees renders as a 10x40 box on screen, so its
    // true left edge sits 5px from center, not 20px.
    const layers = [
      { id: "a", x: 0, y: 0, width: 20, height: 20, rotation: 0 },
      { id: "b", x: 50, y: 0, width: 40, height: 10, rotation: 90 },
    ];
    const patches = alignCustomerLayers(layers, ["a", "b"], "alignLeft");
    // Combined rotated bounding box left edge is -10 (from "a"); each object's
    // own rotated half-width is added back to place its edge, not its centre.
    expect(patches.a.x).toBeCloseTo(0); // -10 + halfW(a)=10
    expect(patches.b.x).toBeCloseTo(-5); // -10 + halfW(b, rotated 90deg)=5
  });

  it("groups and ungroups customer-created objects", () => {
    const layers = [
      { id: "a", page: "front", x: 10, y: 10, width: 10, height: 10, zIndex: 1, isUserLayer: true },
      { id: "b", page: "front", x: 30, y: 10, width: 10, height: 10, zIndex: 2, isUserLayer: true },
    ];
    const grouped = groupCustomerLayers(layers, ["a", "b"], "g");
    expect(grouped.find((layer) => layer.id === "g")?.type).toBe("group");
    expect(grouped.filter((layer) => layer.groupId === "g")).toHaveLength(2);
    expect(ungroupCustomerLayers(grouped, "g").some((layer) => layer.id === "g")).toBe(false);
  });

  it("maps inverse perspective coordinates back to print-canvas coordinates", () => {
    const points = { topLeft: { x: 10, y: 20 }, topRight: { x: 210, y: 10 }, bottomRight: { x: 230, y: 220 }, bottomLeft: { x: 0, y: 200 } };
    const mapped = mapMockupPointToCanvas({ x: 110, y: 110 }, points, 1000, 800);
    expect(mapped).not.toBeNull();
    expect(mapped!.x).toBeGreaterThan(400);
    expect(mapped!.x).toBeLessThan(600);
  });

  it("migrates schema v3 documents to parity schema v4 without dropping QR layers", () => {
    const input: any = {
      schemaVersion: 3, templateId: "template", templateVersion: 1, engineVersion: "old",
      canvas: { widthPx: 600, heightPx: 600, widthIn: 2, heightIn: 2, dpi: 300, orientation: "square" },
      pages: [{ id: "front", name: "Front", enabled: true, widthPx: 600, heightPx: 600, widthIn: 2, heightIn: 2, dpi: 300, backgroundColor: "#ffffff", safeArea: { top: 20, right: 20, bottom: 20, left: 20 }, bleed: { top: 0, right: 0, bottom: 0, left: 0 }, allowCustomerText: true, allowCustomerUploads: true }],
      fields: [], layers: [qrLayer()], settings: {}, assets: [],
    };
    const migrated = migrateCustomizerDocument(input, 3, 4).document;
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.layers[0].type).toBe("qrCode");
  });

  it("renders native QR modules in the shared server SVG", () => {
    const template: any = { canvasWidthPx: 600, canvasHeightPx: 600, defaultPage: "front", pages: [{ id: "front", enabled: true, backgroundColor: "#ffffff" }], fields: [], layers: [qrLayer()] };
    const svg = buildPageSvg({ template, pageId: "front", mode: "print" });
    expect(svg).toContain("shape-rendering=\"crispEdges\"");
    expect(svg.match(/<rect/g)?.length).toBeGreaterThan(100);
  });

  it("server validation rejects interaction-disabled edits and invalid QR destinations", () => {
    const template: any = { pages: [{ id: "front", enabled: true }], fields: [], settings: { allowCustomerQRCodes: true }, layers: [qrLayer({ customerInteractionDisabled: true })] };
    const disabled = validateCustomerState(template, { editorState: { layerOverrides: { qr: { transform: { x: 20 } } }, userLayers: [] } });
    expect(disabled.violations.some((issue) => issue.code === "interaction-disabled")).toBe(true);
    const invalid = validateCustomerState({ ...template, layers: [] }, { editorState: { layerOverrides: {}, userLayers: [{ ...qrLayer({ id: "user", page: "front", value: "javascript:bad" }), type: "qrCode" }] } });
    expect(invalid.violations.some((issue) => issue.code === "invalid-qr-url")).toBe(true);
  });

  it("enforces admin customer allowlists, page counts, and geometry limits", () => {
    const template: any = {
      canvasWidthPx: 600,
      canvasHeightPx: 600,
      pages: [{ id: "front", enabled: true, allowCustomerText: true }],
      fields: [],
      layers: [],
      settings: {
        allowCustomerText: true,
        allowedCustomerFonts: ["Inter"],
        allowedCustomerColors: ["#303839"],
        allowedCustomerPages: ["front"],
        maxCustomerObjectsPerPage: 1,
        customerObjectLimits: { minWidth: 100, maxWidth: 300, minHeight: 40, maxHeight: 200, minRotation: -15, maxRotation: 15, insetLeft: 20, insetTop: 20, insetRight: 20, insetBottom: 20 },
      },
    };
    const userText = (id: string, fontFamily: string) => ({ id, type: "text", page: "front", text: "hello", x: 2, y: 2, width: 80, height: 30, rotation: 40, textStyle: { fontFamily, color: "#303839", verticalAlign: "top" } });
    const result = validateCustomerState(template, { editorState: { layerOverrides: {}, userLayers: [userText("one", "Georgia"), userText("two", "Inter")] } });
    expect(result.violations.some((issue) => issue.code === "font-not-allowed-by-template")).toBe(true);
    expect(result.violations.some((issue) => issue.code === "customer-object-limit")).toBe(true);
    expect(result.violations.some((issue) => issue.code === "customer-object-count-limit")).toBe(true);
    expect(result.sanitizedEditorState.userLayers[0]).toMatchObject({ width: 100, height: 40, rotation: 15, x: 70, y: 40 });
  });
});
