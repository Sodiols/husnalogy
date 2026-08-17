import { describe, expect, it } from "vitest";
import {
  constrainCropToAspect,
  resolveCropRect,
  resolveImageDrawBox,
  resolveImageDrawBoxFromTransform,
} from "../image-crop";

const FRAME = { frameX: 100, frameY: 200, frameWidth: 400, frameHeight: 300 };

// The formula both renderers used inline before this module existed. Every
// no-crop case must still produce exactly this, or artwork made before cropping
// existed would shift in print.
const legacyDrawBox = (zoom = 1, offsetX = 0, offsetY = 0) => {
  const width = FRAME.frameWidth * zoom;
  const height = FRAME.frameHeight * zoom;
  return {
    x: FRAME.frameX - (width - FRAME.frameWidth) / 2 + offsetX,
    y: FRAME.frameY - (height - FRAME.frameHeight) / 2 + offsetY,
    width,
    height,
  };
};

describe("resolveCropRect", () => {
  it("treats a zero width or height as no crop", () => {
    // This is the stored default on every existing document.
    expect(resolveCropRect({ cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0 })).toBeNull();
    expect(resolveCropRect({ cropWidth: 0.5, cropHeight: 0 })).toBeNull();
    expect(resolveCropRect({ cropWidth: 0, cropHeight: 0.5 })).toBeNull();
  });

  it("treats a full-frame rectangle as no crop", () => {
    expect(resolveCropRect({ cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 })).toBeNull();
  });

  it("tolerates a missing or malformed transform", () => {
    expect(resolveCropRect(null)).toBeNull();
    expect(resolveCropRect(undefined)).toBeNull();
    expect(resolveCropRect({ cropWidth: Number.NaN, cropHeight: 0.5 })).toBeNull();
  });

  it("returns a real crop unchanged", () => {
    expect(resolveCropRect({ cropX: 0.25, cropY: 0.1, cropWidth: 0.5, cropHeight: 0.5 })).toEqual({
      x: 0.25,
      y: 0.1,
      width: 0.5,
      height: 0.5,
    });
  });

  it("clamps a rectangle that runs past the frame edge", () => {
    const crop = resolveCropRect({ cropX: 0.8, cropY: 0.9, cropWidth: 0.5, cropHeight: 0.5 })!;
    expect(crop.x).toBe(0.8);
    expect(crop.y).toBe(0.9);
    // 1 - 0.8 is not exactly 0.2 in binary floating point.
    expect(crop.width).toBeCloseTo(0.2, 12);
    expect(crop.height).toBeCloseTo(0.1, 12);
  });

  it("collapses to null when clamping leaves nothing", () => {
    expect(resolveCropRect({ cropX: 1, cropY: 0, cropWidth: 0.5, cropHeight: 0.5 })).toBeNull();
  });
});

describe("resolveImageDrawBox without a crop", () => {
  it("reproduces the legacy formula exactly at zoom 1", () => {
    expect(resolveImageDrawBox({ ...FRAME })).toEqual(legacyDrawBox());
  });

  it("reproduces the legacy formula with zoom and offset", () => {
    expect(resolveImageDrawBox({ ...FRAME, zoom: 2.5, offsetX: 40, offsetY: -25 })).toEqual(
      legacyDrawBox(2.5, 40, -25),
    );
  });

  it("falls back to zoom 1 for a zero or negative zoom", () => {
    expect(resolveImageDrawBox({ ...FRAME, zoom: 0 })).toEqual(legacyDrawBox(1));
    expect(resolveImageDrawBox({ ...FRAME, zoom: -3 })).toEqual(legacyDrawBox(1));
  });

  it("is unchanged by a null crop", () => {
    expect(resolveImageDrawBox({ ...FRAME, crop: null })).toEqual(legacyDrawBox());
  });
});

describe("resolveImageDrawBox with a crop", () => {
  it("is the identity for a full-frame crop", () => {
    const box = resolveImageDrawBox({ ...FRAME, crop: { x: 0, y: 0, width: 1, height: 1 } });
    expect(box).toEqual(legacyDrawBox());
  });

  it("doubles the image when the crop selects half the frame on both axes", () => {
    const box = resolveImageDrawBox({ ...FRAME, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    expect(box.width).toBe(FRAME.frameWidth * 2);
    expect(box.height).toBe(FRAME.frameHeight * 2);
  });

  it("keeps a centred crop centred on the frame", () => {
    const box = resolveImageDrawBox({ ...FRAME, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    // The drawn image stays centred on the frame centre.
    expect(box.x + box.width / 2).toBeCloseTo(FRAME.frameX + FRAME.frameWidth / 2, 6);
    expect(box.y + box.height / 2).toBeCloseTo(FRAME.frameY + FRAME.frameHeight / 2, 6);
  });

  it("moves the image the opposite way when the crop moves", () => {
    const left = resolveImageDrawBox({ ...FRAME, crop: { x: 0, y: 0.25, width: 0.5, height: 0.5 } });
    const right = resolveImageDrawBox({ ...FRAME, crop: { x: 0.5, y: 0.25, width: 0.5, height: 0.5 } });
    // Selecting the RIGHT half must pull the image LEFT to bring it into view.
    expect(right.x).toBeLessThan(left.x);
  });

  it("scales uniformly, so a non-frame-aspect crop never stretches the photo", () => {
    const box = resolveImageDrawBox({ ...FRAME, crop: { x: 0, y: 0, width: 0.25, height: 0.75 } });
    // Aspect ratio of the drawn image is preserved.
    expect(box.width / box.height).toBeCloseTo(FRAME.frameWidth / FRAME.frameHeight, 6);
    // The tighter axis wins, so the region covers the frame.
    expect(box.width).toBeCloseTo(FRAME.frameWidth * 4, 6);
  });

  it("composes with zoom and offset", () => {
    const box = resolveImageDrawBox({
      ...FRAME,
      zoom: 2,
      offsetX: 10,
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    });
    expect(box.width).toBe(FRAME.frameWidth * 2 * 2);
    expect(Number.isFinite(box.x)).toBe(true);
  });

  it("degrades safely for a zero-sized frame", () => {
    const box = resolveImageDrawBox({
      frameX: 0,
      frameY: 0,
      frameWidth: 0,
      frameHeight: 0,
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
    expect(Number.isFinite(box.width)).toBe(true);
  });
});

describe("resolveImageDrawBoxFromTransform", () => {
  it("matches the legacy box for a transform with no crop", () => {
    expect(
      resolveImageDrawBoxFromTransform(FRAME, { zoom: 1.5, offsetX: 12, offsetY: -8 }),
    ).toEqual(legacyDrawBox(1.5, 12, -8));
  });

  it("applies a crop carried on the transform", () => {
    const box = resolveImageDrawBoxFromTransform(FRAME, {
      cropX: 0.25,
      cropY: 0.25,
      cropWidth: 0.5,
      cropHeight: 0.5,
    });
    expect(box.width).toBe(FRAME.frameWidth * 2);
  });

  it("is unchanged by the stored all-zero default", () => {
    expect(
      resolveImageDrawBoxFromTransform(FRAME, { cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0 }),
    ).toEqual(legacyDrawBox());
  });
});

describe("constrainCropToAspect", () => {
  it("squares off a mismatched rectangle in normalized units", () => {
    const crop = constrainCropToAspect({ x: 0.1, y: 0.1, width: 0.8, height: 0.4 }, 400, 300);
    expect(crop.width).toBeCloseTo(crop.height, 6);
  });

  it("keeps the constrained crop inside the frame", () => {
    const crop = constrainCropToAspect({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 400, 300);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("falls back to the full frame for nonsense input", () => {
    expect(constrainCropToAspect({ x: 0, y: 0, width: 0, height: 0 }, 400, 300)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});
