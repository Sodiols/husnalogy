import { createHash } from "crypto";
import { FONT_REGISTRY_VERSION } from "./fonts";
import { assetReferenceHashMaterial } from "./asset-references";

export const MOCKUP_RENDERER_VERSION = "perspective-v1";

export type PerspectivePoints = {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
};

export type MockupArtworkArea = {
  id: string;
  sourcePageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  clipPath?: string;
  perspectivePoints?: PerspectivePoints;
  warpType?: "none" | "perspective" | "cylinder" | "custom";
  opacity?: number;
  blendMode?: string;
  sortOrder?: number;
  visible?: boolean;
  locked?: boolean;
};

export type MockupOverlay = {
  id: string;
  assetId?: string;
  src?: string;
  type: "shadow" | "highlight" | "texture" | "foreground";
  opacity: number;
  blendMode?: string;
  sortOrder?: number;
  visible?: boolean;
  locked?: boolean;
};

export type MockupView = {
  id: string;
  name: string;
  baseImageAssetId?: string;
  baseImageUrl?: string;
  width?: number;
  height?: number;
  sortOrder?: number;
  requiresTransparency?: boolean;
  artworkAreas: MockupArtworkArea[];
  overlays: MockupOverlay[];
};

export type MockupTemplate = {
  id: string;
  productId?: string;
  productType: string;
  name: string;
  baseImageAssetId?: string;
  width: number;
  height: number;
  version?: number;
  status?: "draft" | "published" | "archived";
  views: MockupView[];
};

export function calculatePerspectivePoints(area: MockupArtworkArea): PerspectivePoints {
  if (area.perspectivePoints) return area.perspectivePoints;
  const centerX = area.x + area.width / 2;
  const centerY = area.y + area.height / 2;
  const radians = ((Number(area.rotation) || 0) * Math.PI) / 180;
  const rotate = (x: number, y: number) => ({
    x: centerX + (x - centerX) * Math.cos(radians) - (y - centerY) * Math.sin(radians),
    y: centerY + (x - centerX) * Math.sin(radians) + (y - centerY) * Math.cos(radians),
  });
  return {
    topLeft: rotate(area.x, area.y),
    topRight: rotate(area.x + area.width, area.y),
    bottomRight: rotate(area.x + area.width, area.y + area.height),
    bottomLeft: rotate(area.x, area.y + area.height),
  };
}

export function perspectivePointList(points: PerspectivePoints) {
  return [points.topLeft, points.topRight, points.bottomRight, points.bottomLeft];
}

function cross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

export function validatePerspectivePoints(points: PerspectivePoints): { valid: true } | { valid: false; reason: string } {
  const list = perspectivePointList(points);
  if (list.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return { valid: false, reason: "Every perspective corner must contain finite x and y coordinates." };
  }
  if (segmentsIntersect(list[0], list[1], list[2], list[3]) || segmentsIntersect(list[1], list[2], list[3], list[0])) {
    return { valid: false, reason: "Perspective corners cannot form a self-intersecting quadrilateral." };
  }
  const turns = list.map((point, index) => cross(point, list[(index + 1) % 4], list[(index + 2) % 4]));
  if (turns.some((value) => Math.abs(value) < 0.0001) || !(turns.every((value) => value > 0) || turns.every((value) => value < 0))) {
    return { valid: false, reason: "Perspective corners must form a non-zero convex quadrilateral." };
  }
  const twiceArea = Math.abs(list.reduce((sum, point, index) => sum + point.x * list[(index + 1) % 4].y - list[(index + 1) % 4].x * point.y, 0));
  if (twiceArea < 2) return { valid: false, reason: "Perspective area is too small to render." };
  return { valid: true };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function computeMockupInputHash(input: {
  template: MockupTemplate;
  viewId: string;
  pageChecksums: Record<string, string>;
  documentState?: unknown;
  templateVersion?: number;
  engineVersion?: string;
}): string {
  const material = {
    ...input,
    documentState: assetReferenceHashMaterial(input.documentState),
    engineVersion: input.engineVersion || MOCKUP_RENDERER_VERSION,
    fontRegistryVersion: FONT_REGISTRY_VERSION,
  };
  return createHash("sha256").update(JSON.stringify(stable(material))).digest("hex");
}

export function createFlatMockupTemplate(productId = "", baseImageUrl = ""): MockupTemplate {
  return {
    id: `mockup_${Math.random().toString(36).slice(2, 9)}`,
    productId,
    productType: "flat-card",
    name: "Flat card mockups",
    width: 1600,
    height: 1200,
    version: 1,
    status: "draft",
    views: [
      {
        id: "front-card",
        name: "Front card",
        baseImageUrl,
        artworkAreas: [{ id: "front-artwork", sourcePageId: "front", x: 440, y: 170, width: 720, height: 900, rotation: 0, warpType: "none", opacity: 1 }],
        overlays: [],
      },
    ],
  };
}
