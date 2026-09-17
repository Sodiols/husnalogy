/**
 * Deterministic customizer fixture for browser tests (spec §18 of the editor
 * upgrade brief).
 *
 * Why this exists: every customizer Playwright spec used to depend on
 * `npm run seed:customizer:test` having written a product, a template, assets
 * and feature flags into whichever Supabase project the run happened to point
 * at. That made the editor's own interaction tests depend on database state,
 * on a logged-in customer, and on network-reachable asset URLs — so a failure
 * could mean a real editor regression, or simply an unseeded database.
 *
 * This module builds the same SHAPE the personalize page hands to the client —
 * a product plus a resolved template — entirely in memory, with no Supabase
 * read, no auth and no remote asset. It is deliberately data-only so it can be
 * imported by a route, by unit tests, or by a future admin-builder fixture.
 *
 * Everything here is constant: no `Date.now()`, no random ids, no environment
 * lookups. Two runs produce byte-identical documents, which is what lets a test
 * assert on exact geometry.
 *
 * It intentionally exercises the combinations the editor has to get right:
 * both pages, every layer type, a group, a locked layer, a hidden layer, a
 * crop-enabled photo, a photo that may be replaced but NOT cropped, and
 * customer-editable vs template-only objects.
 */

export const E2E_FIXTURE_SLUG = "__e2e-customizer-fixture";

/** Every permission key the customizer understands, all granted. */
const ALL_PERMISSIONS = {
  select: true,
  editContent: true,
  editStyle: true,
  group: true,
  ungroup: true,
  hide: true,
  lock: true,
  changeFont: true,
  changeFontSize: true,
  changeFontWeight: true,
  changeFontStyle: true,
  changeColor: true,
  changeTextColor: true,
  changeAlignment: true,
  changeLetterSpacing: true,
  changeLineHeight: true,
  move: true,
  resize: true,
  rotate: true,
  duplicate: true,
  delete: true,
  changeOpacity: true,
  changeLayerOrder: true,
  replaceImage: true,
  cropImage: true,
  zoomImage: true,
  repositionImage: true,
  flipImage: true,
  rotateImage: true,
  applyImageFilters: true,
  changeFill: true,
  changeBorder: true,
  editGrid: true,
  editGridLayout: true,
  moveGridPhotos: true,
  editQRCodeValue: true,
  editQRCodeStyle: true,
} as const;

type PermissionKey = keyof typeof ALL_PERMISSIONS;

/** All permissions, minus the ones named. Keeps each variant one readable line. */
function permissionsWithout(...denied: PermissionKey[]): Record<string, boolean> {
  const result: Record<string, boolean> = { ...ALL_PERMISSIONS };
  for (const key of denied) result[key] = false;
  return result;
}

const NO_PERMISSIONS: Record<string, boolean> = Object.fromEntries(
  Object.keys(ALL_PERMISSIONS).map((key) => [key, false]),
);

/**
 * Inline artwork. A data URI keeps the fixture offline and deterministic — a
 * remote URL would make an interaction test fail on a slow network, which is
 * exactly the kind of false negative this fixture exists to remove.
 */
function swatch(fill: string, label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">` +
    `<rect width="600" height="600" fill="${fill}"/>` +
    `<circle cx="300" cy="240" r="120" fill="rgba(255,255,255,0.55)"/>` +
    `<text x="300" y="470" font-family="serif" font-size="64" text-anchor="middle" fill="#303839">${label}</text>` +
    `</svg>`;
  // encodeURIComponent (not base64) so the payload stays readable in a trace.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const PHOTO_A = swatch("#D9CFC2", "A");
const PHOTO_B = swatch("#C2D3D9", "B");
const PHOTO_C = swatch("#D9C2CF", "C");

const IMAGE_TRANSFORM = {
  assetId: "",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  fitMode: "cover" as const,
};

function gridSlots() {
  return [
    { id: "slot_1_1", row: 0, column: 0, src: PHOTO_A, transform: { ...IMAGE_TRANSFORM } },
    { id: "slot_1_2", row: 0, column: 1, src: PHOTO_B, transform: { ...IMAGE_TRANSFORM } },
    { id: "slot_2_1", row: 1, column: 0, src: PHOTO_C, transform: { ...IMAGE_TRANSFORM } },
    { id: "slot_2_2", row: 1, column: 1, src: "", transform: { ...IMAGE_TRANSFORM } },
  ];
}

const PAGES = [
  { id: "front", label: "Front", enabled: true, backgroundColor: "#F8F6F1", allowCustomerText: true, allowCustomerUploads: true },
  { id: "back", label: "Back", enabled: true, backgroundColor: "#FFFFFF", allowCustomerText: true, allowCustomerUploads: true },
];

const FIELDS = [
  { id: "guest_name", label: "Guest name", type: "text", required: true, defaultValue: "Alex & Jordan", placeholder: "Names", customerVisible: true },
  { id: "feature_photo", label: "Feature photo", type: "image", required: false, defaultValue: "", customerVisible: true },
];

const TEXT_STYLE = {
  fontFamily: "Cormorant Garamond",
  fontSize: 72,
  fontWeight: 600,
  fontStyle: "normal",
  color: "#303839",
  textAlign: "center",
  lineHeight: 1.15,
  letterSpacing: 0,
};

/**
 * Layer ids are stable and descriptive so a spec can address any object by id
 * (`[data-layer-id="fx_photo_crop"]`) instead of by index or by clicking blind.
 */
function layers() {
  return [
    /* ---- front page ---- */
    {
      id: "fx_title",
      name: "Editable title",
      page: "front",
      type: "text",
      fieldId: "guest_name",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      text: "Alex & Jordan",
      x: 750, y: 260, width: 1100, height: 130,
      rotation: 0, zIndex: 10, opacity: 1, hidden: false, locked: false, groupId: "",
      textStyle: { ...TEXT_STYLE },
    },
    {
      // Free text with NO fieldId: edited directly on the canvas, unlike
      // fx_title which is bound to a customer field and edited in the panel.
      id: "fx_free_text",
      name: "Free text",
      page: "front",
      type: "text",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      text: "Edit me",
      x: 750, y: 330, width: 700, height: 90,
      rotation: 0, zIndex: 20, opacity: 1, hidden: false, locked: false, groupId: "",
      textStyle: { ...TEXT_STYLE, fontSize: 44, fontWeight: 400 },
    },
    {
      id: "fx_locked_caption",
      name: "Locked caption",
      page: "front",
      type: "text",
      customerEditable: false,
      locked: true,
      positionLocked: true,
      customerPermissions: { ...NO_PERMISSIONS, select: true },
      text: "Locked — cannot be moved",
      x: 750, y: 400, width: 900, height: 80,
      rotation: 0, zIndex: 11, opacity: 1, hidden: false, groupId: "",
      textStyle: { ...TEXT_STYLE, fontSize: 40, fontWeight: 400 },
    },
    {
      // The crop target: repositioning and zooming inside the frame are allowed.
      id: "fx_photo_crop",
      name: "Croppable photo",
      page: "front",
      type: "image",
      fieldId: "feature_photo",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      src: PHOTO_A,
      imageTransform: { ...IMAGE_TRANSFORM },
      x: 480, y: 760, width: 560, height: 560,
      rotation: 0, zIndex: 12, opacity: 1, hidden: false, locked: false, groupId: "",
    },
    {
      // Same type, deliberately different rules: replaceable but NOT croppable,
      // so a spec can prove the capability resolver actually gates crop.
      id: "fx_photo_no_crop",
      name: "Non-croppable photo",
      page: "front",
      type: "image",
      customerEditable: true,
      customerPermissions: permissionsWithout("cropImage", "zoomImage", "repositionImage"),
      src: PHOTO_B,
      imageTransform: { ...IMAGE_TRANSFORM },
      x: 1030, y: 760, width: 460, height: 560,
      rotation: 0, zIndex: 13, opacity: 1, hidden: false, locked: false, groupId: "",
    },
    {
      id: "fx_shape",
      name: "Shape",
      page: "front",
      type: "shape",
      shape: "rectangle",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      fill: "#D4AF37",
      stroke: "#303839",
      strokeWidth: 4,
      borderRadius: 0,
      x: 380, y: 1160, width: 300, height: 120,
      rotation: 0, zIndex: 14, opacity: 1, hidden: false, locked: false, groupId: "",
    },
    {
      // A line is a SHAPE with shape "line" in production (see the customer
      // "add line" action), not a separate layer type — so it is authored here
      // the same way rather than as an object the engine does not support.
      id: "fx_line",
      name: "Line",
      page: "front",
      type: "shape",
      shape: "line",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      fill: "none",
      stroke: "#303839",
      strokeWidth: 6,
      borderRadius: 0,
      lineStyle: "solid",
      lineCap: "round",
      lineStartCap: "none",
      lineEndCap: "none",
      x: 750, y: 1300, width: 600, height: 8,
      rotation: 0, zIndex: 21, opacity: 1, hidden: false, locked: false, groupId: "",
    },
    {
      id: "fx_frame",
      name: "Frame",
      page: "front",
      type: "frame",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      mask: { kind: "circle" },
      maskShape: "circle",
      src: PHOTO_C,
      assetId: "",
      defaultAssetId: "",
      placeholderImage: "",
      transform: { ...IMAGE_TRANSFORM },
      borderColor: "#303839",
      borderWidth: 6,
      backgroundColor: "#FFFFFF",
      x: 1060, y: 1180, width: 340, height: 340,
      rotation: 0, zIndex: 15, opacity: 1, hidden: false, locked: false, groupId: "",
    },
    {
      id: "fx_grid",
      name: "Photo grid",
      page: "front",
      type: "grid",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      columns: 2,
      rows: 2,
      slots: gridSlots(),
      gap: 18,
      padding: 0,
      cornerRadius: 0,
      borderColor: "",
      borderWidth: 0,
      backgroundColor: "#FFFFFF",
      x: 750, y: 1640, width: 1080, height: 620,
      rotation: 0, zIndex: 16, opacity: 1, hidden: false, locked: false, groupId: "",
    },

    /* ---- a real group, with its two members ---- */
    {
      id: "fx_group",
      name: "Group",
      page: "front",
      type: "group",
      childIds: ["fx_group_text", "fx_group_shape"],
      allowCustomerUngroup: true,
      childSelection: "group",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      x: 750, y: 2000, width: 520, height: 140,
      rotation: 0, zIndex: 17, opacity: 1, hidden: false, locked: false, groupId: "",
    },
    {
      id: "fx_group_text",
      name: "Grouped text",
      page: "front",
      type: "text",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      text: "Grouped",
      x: 640, y: 2000, width: 260, height: 100,
      rotation: 0, zIndex: 18, opacity: 1, hidden: false, locked: false,
      groupId: "fx_group",
      textStyle: { ...TEXT_STYLE, fontSize: 44 },
    },
    {
      id: "fx_group_shape",
      name: "Grouped shape",
      page: "front",
      type: "shape",
      shape: "ellipse",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      fill: "#303839",
      stroke: "",
      strokeWidth: 0,
      borderRadius: 0,
      x: 900, y: 2000, width: 120, height: 120,
      rotation: 0, zIndex: 19, opacity: 1, hidden: false, locked: false,
      groupId: "fx_group",
    },

    /* ---- back page ---- */
    {
      // Auto-WIDTH single line, left/top aligned: the combination where
      // `resolveTextBox` moves BOTH axes away from the stored centre, so the
      // resolved interaction box and the persisted document geometry differ by
      // the largest amount. Drag accuracy has to survive that.
      id: "fx_auto_text",
      name: "Auto width text",
      page: "front",
      type: "text",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      text: "Auto width",
      x: 750, y: 1500, width: 900, height: 160,
      rotation: 0, zIndex: 30, opacity: 1, hidden: false, locked: false, groupId: "",
      textStyle: { ...TEXT_STYLE, fontSize: 64, textAlign: "left", verticalAlign: "top", autoSizeMode: "width" },
    },
    {
      // Auto-HEIGHT multiline: the vertical case — the box grows downward from
      // a fixed top edge, so the resolved centre sits below the stored centre.
      id: "fx_auto_height_text",
      name: "Auto height text",
      page: "front",
      type: "text",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      text: "Auto height\nsecond line",
      x: 750, y: 1740, width: 900, height: 120,
      rotation: 0, zIndex: 31, opacity: 1, hidden: false, locked: false, groupId: "",
      textStyle: { ...TEXT_STYLE, fontSize: 56, autoSizeMode: "height", multiline: true },
    },
    {
      id: "fx_back_text",
      name: "Template-only back text",
      page: "back",
      type: "text",
      customerEditable: false,
      customerPermissions: { ...NO_PERMISSIONS, select: true },
      text: "Thank you",
      x: 750, y: 700, width: 1000, height: 140,
      rotation: 0, zIndex: 10, opacity: 1, hidden: false, locked: false, groupId: "",
      textStyle: { ...TEXT_STYLE, fontSize: 70, fontWeight: 500 },
    },
    {
      id: "fx_qr",
      name: "QR code",
      page: "back",
      type: "qrCode",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      value: "https://husnalogy.com/e2e-fixture",
      foregroundColor: "#303839",
      backgroundColor: "#FFFFFF",
      errorCorrection: "H",
      margin: 4,
      moduleStyle: "square",
      required: false,
      x: 750, y: 1300, width: 320, height: 320,
      rotation: 0, zIndex: 11, opacity: 1, hidden: false, locked: false, groupId: "",
    },
    {
      // Hidden layers must not be hit-testable; a spec asserts clicking through it.
      id: "fx_hidden",
      name: "Hidden shape",
      page: "back",
      type: "shape",
      shape: "rectangle",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      fill: "#FF0000",
      stroke: "",
      strokeWidth: 0,
      borderRadius: 0,
      x: 750, y: 1300, width: 600, height: 600,
      rotation: 0, zIndex: 12, opacity: 1, hidden: true, locked: false, groupId: "",
    },
  ];
}

const SETTINGS = {
  templateName: "Husnalogy customizer E2E fixture",
  templateDescription: "In-memory deterministic fixture. Never a real product.",
  adminNotes: "",
  showSafeArea: true,
  showBleed: false,
  allowCustomerPhotoCrop: true,
  allowCustomerTextMove: true,
  requireApprovalCheckbox: false,
  allowCustomerText: true,
  allowCustomerUploads: true,
  allowCustomerElements: true,
  allowCustomerShapes: true,
  allowCustomerLines: true,
  allowCustomerFrames: true,
  allowCustomerGrids: true,
  allowCustomerQRCodes: true,
  allowCustomerBackground: true,
  allowCustomerGrouping: true,
  showCustomerLayers: true,
  protectedPreview: false,
  autosave: false,
  snapping: true,
  featureFlags: {},
};

/**
 * Every customizer feature flag the fixture needs, forced on. The fixture must
 * not depend on the `customizer_feature_flags` table, or a staged rollout could
 * silently change what the interaction tests are even exercising.
 */
const FORCED_FLAGS: Record<string, boolean> = {
  customizer_v2: true,
  customizer_v2_grids: true,
  customizer_v2_groups: true,
  customizer_v2_customer_layers: true,
  customizer_v2_customer_multiselect: true,
  customizer_v2_customer_grouping: true,
  customizer_v2_qr_codes: true,
  customizer_v2_customer_shapes: true,
  customizer_v2_customer_lines: true,
  customizer_v2_customer_frames: true,
  customizer_v2_customer_grids: true,
  customizer_v2_image_filters: true,
  customizer_v2_split_view: true,
};

export type E2ECustomizerFixtureOptions = {
  /**
   * Enable autosave. Off by default so interaction tests are not interleaved
   * with saves; the persistence tests turn it on.
   */
  autosave?: boolean;
  /**
   * Turn snapping off. Geometry tests that assert an exact drag delta need it:
   * with snapping on, the applied delta is the SNAPPED one, which silently
   * changes the very number the assertion is about.
   */
  snapping?: boolean;
  /**
   * Pad the front page up to roughly this many layers, for stress measurement
   * (spec §22). The hand-authored layers are always present and unchanged; the
   * padding is appended, so a stress run exercises the same objects the
   * correctness tests do plus a realistic crowd around them.
   */
  stressLayers?: number;
};

export type E2ECustomizerFixture = {
  product: Record<string, any>;
  template: Record<string, any>;
};

/**
 * Build the fixture. Returns fresh objects every call so a caller (or a test)
 * can mutate the result without leaking state into the next build.
 */

/**
 * Deterministic filler layers for performance runs (spec §22).
 *
 * A mix of text, shapes, rotated objects and photos — the combination that
 * actually costs something: text re-measures, rotation widens every bounding
 * box, and photos add draw-box maths. Laid out on a grid from constant values,
 * so two runs at the same count produce byte-identical documents and a timing
 * comparison is not measuring a different scene.
 */
function stressLayers(count: number, startZ: number): any[] {
  const total = Math.max(0, Math.min(400, Math.floor(count)));
  const out: any[] = [];
  const columns = 6;
  for (let index = 0; index < total; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = 140 + column * 230;
    const y = 520 + row * 120;
    const kind = index % 4;
    const base = {
      page: "front",
      customerEditable: true,
      customerPermissions: { ...ALL_PERMISSIONS },
      x,
      y,
      // Every third object is rotated, so bounding-box maths is exercised.
      rotation: index % 3 === 0 ? 18 : 0,
      zIndex: startZ + index,
      opacity: 1,
      hidden: false,
      locked: false,
      groupId: "",
    };
    if (kind === 0) {
      out.push({ ...base, id: `sx_text_${index}`, name: `Stress text ${index}`, type: "text",
        text: `Item ${index}`, width: 200, height: 60, textStyle: { ...TEXT_STYLE, fontSize: 32 } });
    } else if (kind === 1) {
      out.push({ ...base, id: `sx_shape_${index}`, name: `Stress shape ${index}`, type: "shape",
        shape: "rounded-rectangle", fill: "#E8E2D6", stroke: "", strokeWidth: 0, borderRadius: 12,
        width: 180, height: 90 });
    } else if (kind === 2) {
      out.push({ ...base, id: `sx_photo_${index}`, name: `Stress photo ${index}`, type: "image",
        src: index % 8 === 2 ? PHOTO_A : PHOTO_B, assetId: "", width: 170, height: 110,
        mask: { kind: "rectangle" }, transform: { ...IMAGE_TRANSFORM }, borderColor: "", borderWidth: 0,
        backgroundColor: "" });
    } else {
      out.push({ ...base, id: `sx_ellipse_${index}`, name: `Stress ellipse ${index}`, type: "shape",
        shape: "ellipse", fill: "#F2EDE4", stroke: "#D9CFC2", strokeWidth: 2, borderRadius: 0,
        width: 150, height: 150 });
    }
  }
  return out;
}

export function buildE2ECustomizerFixture(options: E2ECustomizerFixtureOptions = {}): E2ECustomizerFixture {
  const template = {
    id: "e2e-fixture-template",
    productId: "e2e-fixture-product",
    enabled: true,
    version: 1,
    engine: "svg",
    canvasWidthPx: 1500,
    canvasHeightPx: 2100,
    cardWidthIn: 5,
    cardHeightIn: 7,
    dpi: 300,
    orientation: "portrait",
    defaultPage: "front",
    pages: PAGES.map((page) => ({ ...page })),
    fields: FIELDS.map((field) => ({ ...field })),
    layers: [
      ...layers(),
      ...stressLayers(Number(options.stressLayers) || 0, 1000),
    ],
    safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
    bleed: { top: 30, right: 30, bottom: 30, left: 30 },
    assets: {},
    settings: {
      ...SETTINGS,
      autosave: Boolean(options.autosave),
      snapping: options.snapping !== false,
    },
    featureFlags: { ...FORCED_FLAGS },
    mockupTemplates: [],
  };

  const product = {
    id: "e2e-fixture-product",
    slug: E2E_FIXTURE_SLUG,
    title: "Customizer E2E Fixture",
    category: "E2E",
    productType: "flat-card",
    status: "active",
    // Never listed: the fixture is reachable only by its own internal route.
    visibility: "direct",
    price: 0,
    currency: "BDT",
    customizeEnabled: true,
    description: "In-memory automated-test fixture. Not a purchasable product.",
    images: [],
    mockups: [],
    customizerTemplate: template,
  };

  return { product, template };
}
