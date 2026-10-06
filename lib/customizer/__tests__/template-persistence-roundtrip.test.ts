/**
 * Template persistence round trip, end to end, against the REAL schema.
 *
 *   editor state (built with the real builder helpers)
 *     → prepareCustomizerTemplateForSave → normalizeCustomizerTemplate
 *     → product_customizer_templates row (real upsert, real updated_at trigger)
 *     → reload (templateFromRow + asset re-signing)
 *     → publish_customizer_template_version (real RPC, immutable row)
 *     → getPublicCustomizerTemplate (what a NEW customer session receives)
 *     → customer field mapper, server validator, preflight and SVG renderer.
 *
 * The production modules run unchanged; only the Supabase client is replaced
 * by a thin adapter over an in-process Postgres (PGlite) loaded with
 * supabase/schema.sql and every migration. Nothing here touches a Supabase
 * project.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => holder.client,
  createClient: async () => holder.client,
}));
vi.mock("@/lib/customizer/v2/server/google-fonts-catalog", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getFontCatalogSafe: async () => [],
}));

import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { createCustomizerTestClient, SIGNED_URL_HOST } from "@/lib/testing/pglite-customizer-client";
import { getCustomizerTemplateByProductId, saveCustomizerTemplate } from "@/lib/customizer/store";
import { getPublicCustomizerTemplate, publishTemplateVersion } from "@/lib/customizer/versions";
import { customerEditablePermissionBundle } from "@/lib/customizer";
import { hydrateAdminAssetUrls, stripAdminAssetUrls } from "@/lib/customizer/server/admin-assets";
import {
  addLayer,
  duplicatePage,
  linkLayerToField,
  moveConnectedField,
  newImageLayerFromAdminAsset,
  newTextLayer,
  removeLayer,
  setCustomerEditable,
  updateConnectedField,
  updateLayer,
} from "@/app/admin/dashboard/design-builder/builder-utils";
import { createGridSlots } from "@/lib/customizer/v2/grids";
import { groupLayers } from "@/lib/customizer/v2/groups";
import {
  getLayerPermissions,
  resolveLayerText,
  validateCustomerValues,
} from "@/app/components/customizer/customizer-utils";
import { mapCustomerFields } from "@/app/components/customizer/CustomerEditPanel";
import { validateCustomerState } from "@/lib/customizer/v2/validate";
import { resolveCustomerDocument, templateToDocument } from "@/lib/customizer/v2/document";
import { runPreflight } from "@/lib/customizer/v2/preflight";
import { buildPageSvg } from "@/lib/customizer/v2/svg";
import { resolveLayerSelectionGeometry } from "@/lib/customizer/v2/selection-geometry";
import { fallbackMeasure } from "@/lib/customizer/v2/text-layout";

const PRODUCT = "product-roundtrip";
const PHOTO_ASSET = "7d6e9c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6";
const BACKGROUND_ASSET = "0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d";

let t: TestDatabase;
let signatureCount: () => number;

async function seed(db: TestDatabase["db"]) {
  await db.query(
    `insert into public.products (id, slug, title, status, visibility, price, data)
     values ($1, 'roundtrip-card', 'Round Trip Card', 'hidden', 'public', 10, '{}'::jsonb)`,
    [PRODUCT],
  );
  await db.query(
    `insert into public.customizer_assets (id, title, bucket, path, editor_path, thumbnail_path, mime_type, original_filename, asset_type, status, width, height)
     values
      ($1, 'Bride portrait', 'customizer-elements', 'originals/portrait.png', 'editor/portrait.webp', 'thumbs/portrait.webp', 'image/png', 'portrait.png', 'image', 'ready', 3000, 2000),
      ($2, 'Linen background', 'customizer-elements', 'originals/linen.png', 'editor/linen.webp', 'thumbs/linen.webp', 'image/png', 'linen.png', 'background', 'ready', 1500, 2100)`,
    [PHOTO_ASSET, BACKGROUND_ASSET],
  );
}

const layerByName = (template: any, name: string) => template.layers.find((layer: any) => layer.name === name);

/** What an administrator builds in the studio, using the studio's own helpers. */
function buildEditorTemplate() {
  let template: any = {
    enabled: true,
    canvasWidthPx: 1500,
    canvasHeightPx: 2100,
    cardWidthIn: 5,
    cardHeightIn: 7,
    dpi: 300,
    defaultPage: "back",
    pages: [
      {
        id: "front",
        label: "Front",
        enabled: true,
        backgroundColor: "#ffffff",
        backgroundAssetId: BACKGROUND_ASSET,
        bucket: "customizer-elements",
        originalPath: "originals/linen.png",
        editorPath: "editor/linen.webp",
        thumbnailPath: "thumbs/linen.webp",
        // A signed URL from the studio session: ephemeral, must not persist.
        backgroundImage: `${SIGNED_URL_HOST}/customizer-elements/editor/linen.webp?token=studio-session`,
      },
      { id: "back", label: "Back", enabled: true, backgroundColor: "#f8f6f1" },
    ],
    fields: [],
    layers: [],
    guides: [{ id: "guide_center", pageId: "front", axis: "vertical", position: 750, locked: true, hidden: false, customerVisible: true }],
    safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
    bleed: { top: 45, right: 45, bottom: 45, left: 45 },
    settings: { allowCustomerText: false },
  };

  // Couple names on Front, linked from Back: ONE shared field.
  const front = { ...newTextLayer(template, "front"), name: "Couple names", text: "Ana & Ben", y: 500 };
  template = addLayer(template, front);
  template = setCustomerEditable(template, front.id, true);
  template = updateConnectedField(template, front.id, { label: "Your names", placeholder: "Both first names", helpText: "Shown on both sides" });
  const back = { ...newTextLayer(template, "back"), name: "Names again", text: "Ana & Ben", y: 400 };
  template = addLayer(template, back);
  template = linkLayerToField(template, back.id, layerByName(template, "Couple names").fieldId);

  // A customer photo with an admin crop, fit, mask, border and filter.
  const photo = newImageLayerFromAdminAsset(template, "front", {
    id: PHOTO_ASSET,
    title: "Bride portrait",
    url: `${SIGNED_URL_HOST}/x?token=studio`,
    editorUrl: `${SIGNED_URL_HOST}/customizer-elements/editor/portrait.webp?token=studio`,
    bucket: "customizer-elements",
    originalPath: "originals/portrait.png",
    editorPath: "editor/portrait.webp",
    thumbnailPath: "thumbs/portrait.webp",
    originalFilename: "portrait.png",
    mimeType: "image/png",
    width: 3000,
    height: 2000,
  });
  template = addLayer(template, { ...photo, y: 1100 });
  template = setCustomerEditable(template, photo.id, true);
  template = updateLayer(template, photo.id, {
    imageTransform: { zoom: 1.6, offsetX: 40, offsetY: -25, rotation: 12, flipX: true },
    fitMode: "contain",
    maskShape: "circle",
    borderWidth: 6,
    borderColor: "#303839",
    filters: { brightness: 1, contrast: 1, saturation: 1, grayscale: 1, sepia: 0, tintAmount: 0 },
  });

  // A required field hidden from customers, with an EMPTY design text — the
  // shape that used to make checkout impossible.
  const venue = { ...newTextLayer(template, "back"), name: "Venue", text: "", y: 900 };
  template = addLayer(template, venue);
  template = setCustomerEditable(template, venue.id, true);
  template = updateConnectedField(template, venue.id, { customerVisible: false, required: true });
  // Display order configured in the Fields panel, independent of stacking:
  // move the venue to the top of the customer's list.
  template = moveConnectedField(template, venue.id, "up");
  template = moveConnectedField(template, venue.id, "up");

  // Every text sizing mode.
  const sizing: Array<[string, Record<string, unknown>, string]> = [
    ["Auto width line", { autoSizeMode: "width", multiline: false, fitMode: "fixed", textAlign: "left", letterSpacing: 2, lineHeight: 1.1 }, "Saturday the fifth"],
    ["Auto height verse", { autoSizeMode: "height", multiline: true, fitMode: "auto-height", textAlign: "center", lineHeight: 1.4 }, "Two hearts\nOne promise"],
    ["Fixed box", { autoSizeMode: "fixed", multiline: false, fitMode: "fixed", textAlign: "right" }, "Fixed copy"],
    ["Shrink box", { autoSizeMode: "shrink", multiline: false, fitMode: "shrink", minFontSize: 20, textAlign: "center" }, "A rather long line that must shrink"],
  ];
  sizing.forEach(([name, style, text], index) => {
    const layer = newTextLayer(template, "back");
    template = addLayer(template, {
      ...layer,
      name,
      text,
      y: 1300 + index * 160,
      width: 600,
      height: 120,
      textStyle: { ...layer.textStyle, fontSize: 48, ...style },
    });
  });

  // A photo grid whose position is fixed for customers.
  template = addLayer(template, {
    id: "grid_fixed",
    name: "Photo grid",
    page: "front",
    type: "grid",
    x: 750,
    y: 1700,
    width: 900,
    height: 400,
    zIndex: 40,
    columns: 2,
    rows: 1,
    gap: 12,
    slots: createGridSlots(2, 1),
    customerEditable: true,
    customerPermissions: { ...customerEditablePermissionBundle(true), move: false, resize: false, rotate: false },
  });

  // A group on Front, then duplicate the page.
  template = addLayer(template, { id: "petal_a", name: "Petal A", page: "front", type: "shape", shape: "ellipse", x: 300, y: 300, width: 80, height: 80, zIndex: 50 });
  template = addLayer(template, { id: "petal_b", name: "Petal B", page: "front", type: "shape", shape: "ellipse", x: 400, y: 300, width: 80, height: 80, zIndex: 51 });
  template = { ...template, layers: groupLayers(template.layers, ["petal_a", "petal_b"], "group_petals", "Petals") };
  template = duplicatePage(template, "front").template;
  return template;
}

const textBox = (layer: any) => {
  const geometry = resolveLayerSelectionGeometry(layer, {
    text: layer.text,
    measure: fallbackMeasure,
    safeBounds: { left: 90, top: 90, right: 1410, bottom: 2010 },
  });
  return { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
};

// Signed URLs are single-use tokens here; strip them to compare artwork.
const withoutSignatures = (svg: string) => svg.replace(/\?ttl=\d+&amp;token=sig\d+|\?ttl=\d+&token=sig\d+/g, "?signed");

describe("customizer template persistence round trip (real schema)", () => {
  let editor: any;
  let saved: any;
  let draft: any;
  let customer: any;
  let draftRow: any;
  let versionDocument: any;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seed(t.db);
    const adapter = createCustomizerTestClient(t);
    holder.client = adapter.client;
    signatureCount = adapter.signatureCount;

    editor = buildEditorTemplate();
    saved = await saveCustomizerTemplate(PRODUCT, editor);
    draftRow = (await t.db.query<any>("select * from public.product_customizer_templates where product_id = $1", [PRODUCT])).rows[0];
    draft = await getCustomizerTemplateByProductId(PRODUCT);

    const published = await publishTemplateVersion(PRODUCT, null, "round trip", "minor", saved.updatedAt);
    if (published.ok === false) throw new Error(`publish failed: ${published.errors.join("; ")}`);
    versionDocument = (await t.db.query<any>("select document from public.customizer_template_versions where product_id = $1", [PRODUCT])).rows[0].document;
    customer = (await getPublicCustomizerTemplate(PRODUCT))!.template;
  }, 180_000);

  afterAll(() => t?.close());

  describe("shared fields across Front and Back", () => {
    it("persists ONE field definition that both layers keep", () => {
      for (const template of [draft, customer]) {
        const names = template.fields.filter((field: any) => field.id === "couple_names");
        expect(names).toHaveLength(1);
        expect(names[0]).toMatchObject({ label: "Your names", placeholder: "Both first names", helpText: "Shown on both sides", type: "text" });
        const bound = template.layers.filter((layer: any) => layer.fieldId === "couple_names").map((layer: any) => layer.page).sort();
        expect(bound).toEqual(["back", "front"]);
      }
      // No suffixed duplicate was invented on save.
      expect(draft.fields.some((field: any) => /^couple_names_\d+$/.test(field.id))).toBe(false);
    });

    it("updates both layers from one customer input and accepts it on the server", () => {
      const values = { couple_names: "Sofia & Liam" };
      const field = customer.fields.find((entry: any) => entry.id === "couple_names");
      const texts = customer.layers
        .filter((layer: any) => layer.fieldId === "couple_names")
        .map((layer: any) => resolveLayerText(layer, field, values));
      expect(texts).toEqual(["Sofia & Liam", "Sofia & Liam"]);
      expect(mapCustomerFields(customer).filter((entry) => entry.field.id === "couple_names")).toHaveLength(1);
      const result = validateCustomerState(customer, { values });
      expect(result.violations).toEqual([]);
      expect(result.sanitizedValues.couple_names).toBe("Sofia & Liam");
    });
  });

  describe("field order and customer visibility", () => {
    it("keeps the configured display order, not layer stacking", () => {
      expect(draft.fields.map((field: any) => field.id)).toEqual(["venue", "couple_names", "bride_portrait"]);
      expect(customer.fields.map((field: any) => field.id)).toEqual(["venue", "couple_names", "bride_portrait"]);
    });

    it("keeps customerVisible:false and the hidden field's binding through save and publish", () => {
      for (const template of [draft, customer]) {
        expect(template.fields.find((field: any) => field.id === "venue")).toMatchObject({ customerVisible: false, required: true });
        expect(layerByName(template, "Venue").fieldId).toBe("venue");
      }
    });

    it("hides the field from the customer form and never requires it", () => {
      expect(mapCustomerFields(customer).map((entry) => entry.field.id)).toEqual(["couple_names", "bride_portrait"]);
      expect(validateCustomerValues(customer, {}).missingRequired).not.toContain("venue");
      const { document } = templateToDocument(customer);
      const preflight = runPreflight(resolveCustomerDocument(document, {}, null));
      expect(preflight.issues.filter((issue) => issue.fieldId === "venue")).toEqual([]);
    });
  });

  describe("fixed grid permissions", () => {
    it("stores the explicit restrictions in the draft row and the published document", () => {
      const rowGrid = draftRow.layers.find((layer: any) => layer.id === "grid_fixed");
      const docGrid = versionDocument.layers.find((layer: any) => layer.id === "grid_fixed");
      for (const grid of [rowGrid, docGrid]) {
        expect(grid.customerPermissions).toMatchObject({ move: false, resize: false, rotate: false, replaceImage: true, cropImage: true });
      }
    });

    it("lets customers replace and crop grid photos but not move, resize or rotate the frame", () => {
      const grid = customer.layers.find((layer: any) => layer.id === "grid_fixed");
      const permissions = getLayerPermissions(grid);
      expect(permissions).toMatchObject({ move: false, resize: false, rotate: false, replaceImage: true, cropImage: true });

      const slotId = grid.slots[0].id;
      const allowed = validateCustomerState(customer, {
        editorState: {
          layerOverrides: { grid_fixed: { gridSlots: { [slotId]: { assetId: "photo-1", src: "https://example.test/p.jpg", transform: { zoom: 1.8, offsetX: 12 } } } } },
          userLayers: [],
        },
      });
      expect(allowed.violations).toEqual([]);
      expect(allowed.sanitizedEditorState.layerOverrides.grid_fixed.gridSlots[slotId].transform.zoom).toBe(1.8);

      const forbidden = validateCustomerState(customer, {
        editorState: { layerOverrides: { grid_fixed: { transform: { x: 10, width: 300, rotation: 15 } } }, userLayers: [] },
      });
      expect(forbidden.violations.map((violation) => violation.code).sort()).toEqual(["move-not-allowed", "resize-not-allowed", "rotate-not-allowed"]);
      expect(forbidden.sanitizedEditorState.layerOverrides.grid_fixed).toBeUndefined();
    });
  });

  describe("text automatic sizing", () => {
    const modes: Array<[string, string]> = [
      ["Auto width line", "width"],
      ["Auto height verse", "height"],
      ["Fixed box", "fixed"],
      ["Shrink box", "shrink"],
    ];

    it("carries every mode through the draft row, the published document and the customer template", () => {
      for (const [name, mode] of modes) {
        expect(draftRow.layers.find((layer: any) => layer.name === name).textStyle.autoSizeMode).toBe(mode);
        expect(versionDocument.layers.find((layer: any) => layer.name === name).textStyle.autoSizeMode).toBe(mode);
        expect(layerByName(customer, name).textStyle.autoSizeMode).toBe(mode);
      }
    });

    it("keeps typography, manual line breaks and the shrink floor", () => {
      const verse = layerByName(customer, "Auto height verse");
      expect(verse.text).toBe("Two hearts\nOne promise");
      expect(verse.textStyle).toMatchObject({ multiline: true, lineHeight: 1.4, textAlign: "center", fontSize: 48 });
      expect(layerByName(customer, "Auto width line").textStyle).toMatchObject({ letterSpacing: 2, lineHeight: 1.1, textAlign: "left" });
      expect(layerByName(customer, "Shrink box").textStyle.minFontSize).toBe(20);
    });

    it("resolves the same selection bounds after reopening and after publication", () => {
      for (const [name] of modes) {
        const before = textBox(layerByName(draft, name));
        expect(textBox(layerByName(customer, name))).toEqual(before);
      }
      // Auto width really is content-sized (not the stored 600px box).
      expect(textBox(layerByName(customer, "Auto width line")).width).not.toBe(600);
    });
  });

  describe("image edits and durable asset references", () => {
    it("keeps the crop, fit, mask, border and filters on the published layer", () => {
      const photo = layerByName(customer, "Bride portrait");
      expect(photo.imageTransform).toMatchObject({ zoom: 1.6, offsetX: 40, offsetY: -25, rotation: 12, flipX: true });
      expect(photo.fitMode).toBe("contain");
      expect(photo.mask).toEqual({ kind: "circle" });
      expect(photo.borderWidth).toBe(6);
      expect(photo.filters.grayscale).toBe(1);
    });

    it("renders the same artwork from the draft and from the published version", () => {
      const values = { couple_names: "Sofia & Liam" };
      for (const pageId of ["front", "back"]) {
        const fromDraft = withoutSignatures(buildPageSvg({ template: draft, pageId, values, mode: "print" }));
        const fromPublished = withoutSignatures(buildPageSvg({ template: customer, pageId, values, mode: "print" }));
        expect(fromPublished).toBe(fromDraft);
      }
      const front = buildPageSvg({ template: customer, pageId: "front", values, mode: "print" });
      expect(front).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(front).toContain("rotate(12 ");
      expect(front).toContain("scale(-1 1)");
    });

    it("persists durable identities and never a signed URL", () => {
      expect(JSON.stringify(draftRow)).not.toContain(SIGNED_URL_HOST);
      expect(JSON.stringify(versionDocument)).not.toContain(SIGNED_URL_HOST);

      const docPhoto = versionDocument.layers.find((layer: any) => layer.name === "Bride portrait");
      expect(docPhoto).toMatchObject({
        assetId: PHOTO_ASSET,
        bucket: "customizer-elements",
        originalPath: "originals/portrait.png",
        editorPath: "editor/portrait.webp",
        thumbnailPath: "thumbs/portrait.webp",
      });
      const docFront = versionDocument.pages.find((page: any) => page.id === "front");
      expect(docFront).toMatchObject({
        backgroundAssetId: BACKGROUND_ASSET,
        bucket: "customizer-elements",
        originalPath: "originals/linen.png",
        editorPath: "editor/linen.webp",
      });
    });

    it("resolves assets again after every earlier URL expired: editor variant for customers, original for production", async () => {
      const signedBefore = signatureCount();
      const fresh = (await getPublicCustomizerTemplate(PRODUCT))!.template;
      expect(signatureCount()).toBeGreaterThan(signedBefore);

      const photo = layerByName(fresh, "Bride portrait");
      const page = fresh.pages.find((entry: any) => entry.id === "front");
      expect(photo.src).toContain("/editor/portrait.webp");
      expect(page.backgroundImage).toContain("/editor/linen.webp");
      expect(page.backgroundAssetId).toBe(BACKGROUND_ASSET);
      // Customers never receive the proprietary original.
      expect(JSON.stringify(fresh)).not.toContain("originals/portrait.png?");

      const production = await hydrateAdminAssetUrls(stripAdminAssetUrls(fresh), holder.client, 60, "studio", true);
      expect(layerByName(production, "Bride portrait").src).toContain("/originals/portrait.png");
      expect(production.pages.find((entry: any) => entry.id === "front").backgroundImage).toContain("/originals/linen.png");
    });
  });

  describe("duplicated grouped page, default page and guides", () => {
    it("rebuilds group relationships on the copied page and keeps them through publication", () => {
      for (const template of [draft, customer]) {
        const copied = template.layers.filter((layer: any) => layer.page === "front_copy");
        const group = copied.find((layer: any) => layer.type === "group");
        const children = copied.filter((layer: any) => layer.name === "Petal A" || layer.name === "Petal B");
        expect(group).toBeTruthy();
        expect(group.id).not.toBe("group_petals");
        expect(children.map((child: any) => child.groupId)).toEqual([group.id, group.id]);
        expect([...group.childIds].sort()).toEqual(children.map((child: any) => child.id).sort());
        // The originals still belong to the original group.
        expect(template.layers.find((layer: any) => layer.id === "petal_a").groupId).toBe("group_petals");
      }
    });

    it("opens new customer sessions on the configured default page with the guides", () => {
      expect(draft.defaultPage).toBe("back");
      expect(versionDocument.defaultPageId).toBe("back");
      expect(customer.defaultPage).toBe("back");
      expect(customer.guides).toEqual([
        expect.objectContaining({ id: "guide_center", pageId: "front", axis: "vertical", position: 750, customerVisible: true }),
      ]);
    });
  });

  describe("shared field deletion survives a save", () => {
    it("deleting one linked layer keeps the field for the other", async () => {
      let next = removeLayer(draft, layerByName(draft, "Couple names").id);
      next = setCustomerEditable(next, layerByName(next, "Venue").id, false);
      const resaved = await saveCustomizerTemplate(PRODUCT, next);
      expect(resaved.fields.filter((field: any) => field.id === "couple_names")).toHaveLength(1);
      expect(layerByName(resaved, "Names again").fieldId).toBe("couple_names");
      expect(resaved.fields.find((field: any) => field.id === "couple_names").label).toBe("Your names");
      // The venue field had no other user, so it is genuinely gone.
      expect(resaved.fields.some((field: any) => field.id === "venue")).toBe(false);
    });
  });

  describe("publication pins the saved draft revision", () => {
    it("refuses to publish when the draft changed after the studio saved it", async () => {
      const first = await saveCustomizerTemplate(PRODUCT, draft);
      await saveCustomizerTemplate(PRODUCT, { ...draft, settings: { ...draft.settings, adminNotes: "edited elsewhere" } });
      const result = await publishTemplateVersion(PRODUCT, null, "", "minor", first.updatedAt);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.conflict).toBe(true);
      const count = (await t.db.query<any>("select count(*)::int as n from public.customizer_template_versions where product_id = $1", [PRODUCT])).rows[0].n;
      expect(count).toBe(1);
    });

    it("does not change the immutable published version when the draft changes", async () => {
      const stored = (await t.db.query<any>("select document from public.customizer_template_versions where product_id = $1", [PRODUCT])).rows[0].document;
      expect(stored).toEqual(versionDocument);
      // New customer sessions still get the published layers, not draft edits.
      const current = (await getPublicCustomizerTemplate(PRODUCT))!.template;
      expect(layerByName(current, "Couple names")).toBeTruthy();
    });
  });
});
