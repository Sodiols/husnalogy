import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { calculatePerspectivePoints, computeMockupInputHash, createFlatMockupTemplate } from "../mockups";
import { renderFlatMockup, warpPerspectiveImage } from "../server/mockup-render";
import { computeRenderInputHash, getRenderErrorCode, renderRetryStatus, RENDER_MAX_ATTEMPTS } from "../../render-jobs";
import { RenderError } from "../server/render";
import { computeIntegrityHash } from "../../order-snapshots";
import { getDisabledRenderFeature } from "../feature-flags";

describe("flat product mockups", () => {
  it("calculates default corners and hashes reordered inputs identically", () => {
    const area: any = { id: "a", sourcePageId: "front", x: 20, y: 30, width: 200, height: 300, rotation: 0 };
    expect(calculatePerspectivePoints(area).bottomRight).toEqual({ x: 220, y: 330 });
    const template = createFlatMockupTemplate("product", "/base.png");
    const first = computeMockupInputHash({ template, viewId: "front-card", pageChecksums: { front: "a", back: "b" } });
    const second = computeMockupInputHash({ template, viewId: "front-card", pageChecksums: { back: "b", front: "a" } });
    expect(first).toBe(second);
  });

  it("composites, clips and checksums a real flat mockup", async () => {
    const baseImage = await sharp({ create: { width: 120, height: 100, channels: 4, background: "#ffffff" } }).png().toBuffer();
    const pageImage = await sharp({ create: { width: 60, height: 60, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const view: any = {
      id: "front", name: "Front", artworkAreas: [{ id: "art", sourcePageId: "front", x: 20, y: 20, width: 60, height: 60, rotation: 0, clipPath: "polygon(0 0, 50% 0, 50% 100%, 0 100%)", opacity: 1 }], overlays: [],
    };
    const result = await renderFlatMockup({ view, baseImage, pageImages: { front: pageImage }, width: 120, height: 100, format: "png" });
    const { data, info } = await sharp(result.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
    expect(pixel(25, 25)[0]).toBeGreaterThan(240);
    expect(pixel(25, 25)[1]).toBeLessThan(20);
    expect(pixel(70, 25).slice(0, 3)).toEqual([255, 255, 255]);
    expect(result.checksum).toHaveLength(64);
  });

  it("applies a real four-corner perspective transform", async () => {
    const baseImage = await sharp({ create: { width: 100, height: 90, channels: 4, background: "#ffffff" } }).png().toBuffer();
    const pageImage = await sharp({ create: { width: 50, height: 50, channels: 4, background: "#0066ff" } }).png().toBuffer();
    const view: any = {
      id: "perspective",
      name: "Perspective",
      artworkAreas: [{
        id: "art",
        sourcePageId: "front",
        x: 15,
        y: 10,
        width: 60,
        height: 60,
        rotation: 0,
        warpType: "perspective",
        perspectivePoints: {
          topLeft: { x: 25, y: 12 },
          topRight: { x: 70, y: 20 },
          bottomRight: { x: 82, y: 74 },
          bottomLeft: { x: 12, y: 68 },
        },
      }],
      overlays: [],
    };
    const result = await renderFlatMockup({ view, baseImage, pageImages: { front: pageImage }, width: 100, height: 90, format: "png" });
    const { data, info } = await sharp(result.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
    expect(pixel(45, 40).slice(0, 3)).toEqual([0, 102, 255]);
    expect(pixel(15, 15).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it("crops perspective artwork at output boundaries and rejects invalid corner order", async () => {
    const image = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const cropped = await warpPerspectiveImage(image, {
      topLeft: { x: -10, y: -10 }, topRight: { x: 20, y: 0 }, bottomRight: { x: 18, y: 24 }, bottomLeft: { x: -8, y: 20 },
    }, 16, 16);
    expect(cropped).not.toBeNull();
    expect(cropped?.left).toBe(0);
    expect(cropped?.top).toBe(0);
    await expect(warpPerspectiveImage(image, {
      topLeft: { x: 0, y: 0 }, topRight: { x: 20, y: 20 }, bottomRight: { x: 0, y: 20 }, bottomLeft: { x: 20, y: 0 },
    }, 30, 30)).rejects.toMatchObject({ code: "MOCKUP_PERSPECTIVE_INVALID" });
  });
});

describe("render job determinism and retry policy", () => {
  it("uses an order-independent stable trusted-input hash", () => {
    const base = { id: "customization", templateId: "template", templateVersion: 3, renderData: { editorState: { layerOverrides: { a: { transform: { x: 1, y: 2 } } } } } };
    const first = computeRenderInputHash("print_png", { ...base, values: { names: "A", date: "B" } });
    const second = computeRenderInputHash("print_png", { ...base, values: { date: "B", names: "A" } });
    expect(first).toBe(second);
    expect(computeRenderInputHash("print_pdf", { ...base, values: { names: "A", date: "B" } })).not.toBe(first);
  });

  it("requeues only until the configured final attempt and keeps canonical errors", () => {
    expect(renderRetryStatus(RENDER_MAX_ATTEMPTS - 1)).toBe("retrying");
    expect(renderRetryStatus(RENDER_MAX_ATTEMPTS)).toBe("failed");
    expect(getRenderErrorCode(new RenderError("FONT_FILE_MISSING", "missing"))).toBe("FONT_FILE_MISSING");
    expect(getRenderErrorCode(new Error("MOCKUP_RENDER_FAILED: bad placement"))).toBe("MOCKUP_RENDER_FAILED");
    const flags = { settings: { featureFlags: { customizer_v2_server_rendering: true, customizer_v2_print_pdf: false, customizer_v2_mockups: false } } };
    expect(getDisabledRenderFeature(flags, "print_png")).toBeNull();
    expect(getDisabledRenderFeature(flags, "print_pdf")).toBe("customizer_v2_print_pdf");
    expect(getDisabledRenderFeature(flags, "mockup")).toBe("customizer_v2_mockups");
    expect(getRenderErrorCode(new RenderError("FEATURE_DISABLED", "off"))).toBe("FEATURE_DISABLED");
  });

  it("changes immutable snapshot integrity when design data changes", () => {
    const snapshot = { templateVersion: 3, values: { names: "A" }, editorState: { layerOverrides: {} } };
    expect(computeIntegrityHash(snapshot)).toBe(computeIntegrityHash(structuredClone(snapshot)));
    expect(computeIntegrityHash(snapshot)).not.toBe(computeIntegrityHash({ ...snapshot, values: { names: "B" } }));
  });
});
