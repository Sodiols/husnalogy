import { createHash } from "crypto";
import sharp, { type Blend, type OverlayOptions } from "sharp";
import {
  calculatePerspectivePoints,
  perspectivePointList,
  validatePerspectivePoints,
  type MockupArtworkArea,
  type MockupView,
  type PerspectivePoints,
} from "../mockups";
import { RenderError } from "./render";

export type FlatMockupRenderInput = {
  view: MockupView;
  baseImage: Buffer;
  pageImages: Record<string, Buffer>;
  overlayImages?: Record<string, Buffer>;
  width: number;
  height: number;
  format?: "png" | "webp";
};

type WarpedImage = { input: Buffer; left: number; top: number };

function mockupError(message: string): RenderError {
  return new RenderError("MOCKUP_PERSPECTIVE_INVALID", message);
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clipPathData(value: string, width: number, height: number): string {
  const source = String(value || "").trim();
  const polygon = /^polygon\((.+)\)$/i.exec(source);
  if (polygon) {
    const points = polygon[1].split(",").map((pair) => {
      const [rawX, rawY] = pair.trim().split(/\s+/);
      const number = (part: string, size: number) => part.endsWith("%") ? (Number.parseFloat(part) / 100) * size : Number.parseFloat(part);
      return [number(rawX, width), number(rawY, height)];
    });
    if (points.length < 3 || points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
      throw new RenderError("MOCKUP_RENDER_FAILED", "The artwork clipping polygon is invalid.");
    }
    return `${points.map(([x, y], index) => `${index ? "L" : "M"} ${x} ${y}`).join(" ")} Z`;
  }
  if (source.length > 2000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\-\s]+$/.test(source)) {
    throw new RenderError("MOCKUP_RENDER_FAILED", "The artwork clipping path is unsafe or invalid.");
  }
  return source;
}

async function prepareArtwork(source: Buffer, area: MockupArtworkArea, width: number, height: number): Promise<Buffer> {
  let artwork = sharp(source).resize(width, height, { fit: "fill" }).ensureAlpha();
  if (area.clipPath) {
    const path = clipPathData(area.clipPath, width, height);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${xml(path)}" fill="white"/></svg>`);
    artwork = artwork.composite([{ input: mask, blend: "dest-in" }]);
  }
  const { data, info } = await artwork.raw().toBuffer({ resolveWithObject: true });
  const opacity = Math.max(0, Math.min(1, Number.isFinite(area.opacity) ? Number(area.opacity) : 1));
  if (opacity < 1) {
    for (let offset = 3; offset < data.length; offset += info.channels) data[offset] = Math.round(data[offset] * opacity);
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) throw mockupError("The perspective transform is singular and cannot be rendered.");
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[size]);
}

/** Builds an inverse homography: output-canvas coordinate -> source-image coordinate. */
function inverseHomography(points: PerspectivePoints, sourceWidth: number, sourceHeight: number): number[] {
  const destinations = perspectivePointList(points);
  const sources = [
    { x: 0, y: 0 },
    { x: sourceWidth - 1, y: 0 },
    { x: sourceWidth - 1, y: sourceHeight - 1 },
    { x: 0, y: sourceHeight - 1 },
  ];
  const matrix: number[][] = [];
  const values: number[] = [];
  destinations.forEach((destination, index) => {
    const source = sources[index];
    matrix.push([destination.x, destination.y, 1, 0, 0, 0, -source.x * destination.x, -source.x * destination.y]);
    values.push(source.x);
    matrix.push([0, 0, 0, destination.x, destination.y, 1, -source.y * destination.x, -source.y * destination.y]);
    values.push(source.y);
  });
  return solveLinearSystem(matrix, values);
}

function bilinear(data: Buffer, width: number, height: number, channels: number, x: number, y: number, output: Buffer, offset: number) {
  if (x < -0.001 || y < -0.001 || x > width - 1 + 0.001 || y > height - 1 + 0.001) return;
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = safeX - x0;
  const dy = safeY - y0;
  for (let channel = 0; channel < 4; channel += 1) {
    const read = (px: number, py: number) => channel < channels ? data[(py * width + px) * channels + channel] : 255;
    const top = read(x0, y0) * (1 - dx) + read(x1, y0) * dx;
    const bottom = read(x0, y1) * (1 - dx) + read(x1, y1) * dx;
    output[offset + channel] = Math.round(top * (1 - dy) + bottom * dy);
  }
}

export async function warpPerspectiveImage(source: Buffer, points: PerspectivePoints, canvasWidth: number, canvasHeight: number): Promise<WarpedImage | null> {
  const validation = validatePerspectivePoints(points);
  if (validation.valid === false) throw mockupError(validation.reason);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const corners = perspectivePointList(points);
  const left = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x))));
  const top = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y))));
  const right = Math.min(canvasWidth, Math.ceil(Math.max(...corners.map((point) => point.x))) + 1);
  const bottom = Math.min(canvasHeight, Math.ceil(Math.max(...corners.map((point) => point.y))) + 1);
  if (right <= left || bottom <= top) return null;
  const width = right - left;
  const height = bottom - top;
  const output = Buffer.alloc(width * height * 4);
  const transform = inverseHomography(points, info.width, info.height);
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const x = left + localX;
      const y = top + localY;
      const denominator = transform[6] * x + transform[7] * y + 1;
      if (Math.abs(denominator) < 1e-10) continue;
      const sourceX = (transform[0] * x + transform[1] * y + transform[2]) / denominator;
      const sourceY = (transform[3] * x + transform[4] * y + transform[5]) / denominator;
      bilinear(data, info.width, info.height, info.channels, sourceX, sourceY, output, (localY * width + localX) * 4);
    }
  }
  return { input: await sharp(output, { raw: { width, height, channels: 4 } }).png().toBuffer(), left, top };
}

async function applyOpacity(image: Buffer, opacity: number): Promise<Buffer> {
  const alpha = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
  if (alpha >= 1) return image;
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 3; offset < data.length; offset += info.channels) data[offset] = Math.round(data[offset] * alpha);
  return sharp(data, { raw: info }).png().toBuffer();
}

function ordered<T extends { id: string; sortOrder?: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.id.localeCompare(right.id));
}

export async function renderFlatMockup(input: FlatMockupRenderInput): Promise<{ image: Buffer; checksum: string; width: number; height: number }> {
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1 || input.width * input.height > 40_000_000) {
    throw new RenderError("MOCKUP_RENDER_FAILED", "Mockup output dimensions are invalid or exceed the safe limit.");
  }
  const composites: OverlayOptions[] = [];
  for (const area of ordered(input.view.artworkAreas || []).filter((item) => item.visible !== false)) {
    const source = input.pageImages[area.sourcePageId];
    if (!source) throw new RenderError("MOCKUP_RENDER_FAILED", `Source page ${area.sourcePageId} is missing.`);
    if (area.warpType === "cylinder" || area.warpType === "custom") {
      throw new RenderError("MOCKUP_RENDER_FAILED", `${area.warpType} warping is not supported by this renderer.`);
    }
    const width = Math.max(1, Math.round(area.width));
    const height = Math.max(1, Math.round(area.height));
    const artworkBuffer = await prepareArtwork(source, area, width, height);
    if (area.warpType === "perspective") {
      const warped = await warpPerspectiveImage(artworkBuffer, calculatePerspectivePoints(area), input.width, input.height);
      if (warped) composites.push({ ...warped, blend: (area.blendMode as Blend) || "over" });
      continue;
    }
    let rotated = sharp(artworkBuffer);
    if (area.rotation) rotated = rotated.rotate(area.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    const rotatedBuffer = await rotated.png().toBuffer();
    const rotatedMetadata = await sharp(rotatedBuffer).metadata();
    composites.push({
      input: rotatedBuffer,
      left: Math.round(area.x + (width - (rotatedMetadata.width || width)) / 2),
      top: Math.round(area.y + (height - (rotatedMetadata.height || height)) / 2),
      blend: (area.blendMode as Blend) || "over",
    });
  }
  for (const overlay of ordered(input.view.overlays || []).filter((item) => item.visible !== false)) {
    const source = input.overlayImages?.[overlay.id] || (overlay.assetId ? input.overlayImages?.[overlay.assetId] : undefined);
    if (!source) continue;
    const overlayImage = await sharp(source).resize(input.width, input.height, { fit: "fill" }).png().toBuffer();
    composites.push({ input: await applyOpacity(overlayImage, overlay.opacity), left: 0, top: 0, blend: (overlay.blendMode as Blend) || "over" });
  }
  let pipeline = sharp(input.baseImage).resize(input.width, input.height, { fit: "fill" }).composite(composites);
  pipeline = input.format === "png" ? pipeline.png() : pipeline.webp({ quality: 88, effort: 5 });
  const image = await pipeline.toBuffer();
  return { image, checksum: createHash("sha256").update(image).digest("hex"), width: input.width, height: input.height };
}
