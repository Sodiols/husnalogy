import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLayerImage } from "@/app/components/customizer/customizer-utils";

const root = process.cwd();
const source = readFileSync(
  path.join(root, "app/products/[slug]/personalize/personalize-client.tsx"),
  "utf8",
);

const imageField = { id: "mainPhoto", type: "image" };
const frameLayer = {
  id: "mainPhotoFrame",
  type: "frame",
  fieldId: "mainPhoto",
  customerEditable: true,
};

describe("replacing a template-bound photo resets its stale crop", () => {
  it("demonstrates the bug: a persisted crop override bleeds onto a brand-new photo", () => {
    // Customer dialed in a zoom/pan on photo A...
    const layerWithStaleCrop = { ...frameLayer, imageTransform: { zoom: 3, offsetX: 40, offsetY: -25 } };
    // ...then replaced it with photo B (fresh upload, no crop of its own).
    const values = { mainPhoto: { url: "https://example.com/photoB.jpg", zoom: 1, offsetX: 0, offsetY: 0 } };
    const resolved = resolveLayerImage(layerWithStaleCrop, imageField, values);
    // Without clearing the override this incorrectly carries photo A's crop.
    expect(resolved?.zoom).toBe(3);
    expect(resolved?.offsetX).toBe(40);
  });

  it("is fixed once the stale imageTransform override is cleared on field change", () => {
    // Same scenario, but with the override cleared the way onFieldChange now does.
    const layerAfterReset = { ...frameLayer };
    const values = { mainPhoto: { url: "https://example.com/photoB.jpg", zoom: 1, offsetX: 0, offsetY: 0 } };
    const resolved = resolveLayerImage(layerAfterReset, imageField, values);
    expect(resolved?.zoom).toBe(1);
    expect(resolved?.offsetX).toBe(0);
    expect(resolved?.offsetY).toBe(0);
  });

  it("onFieldChange clears layerOverrides[layerId].imageTransform for image/file fields bound to the changed field", () => {
    expect(source).toContain("A new photo must never inherit the previous photo's crop/zoom/pan/flip");
    expect(source).toContain('field.type === "image" || field.type === "file"');
    expect(source).toMatch(/const \{ imageTransform: _drop, \.\.\.rest \} = existing;/);
  });
});
