import type { GridLayer, GridSlot, ImageTransform, MaskShape } from "./types";
import { defaultImageTransform } from "./types";
import { normalizeImageFilters } from "./image-filters";

export type GridPreset = {
  id: string;
  label: string;
  columns: number;
  rows: number;
  photoCount: number;
  weights?: number[][];
  slots?: Array<Partial<GridSlot> & Pick<GridSlot, "x" | "y" | "width" | "height">>;
};

export const GRID_PRESETS: GridPreset[] = [
  { id: "two-columns", label: "Two columns", columns: 2, rows: 1, photoCount: 2 },
  { id: "two-rows", label: "Two rows", columns: 1, rows: 2, photoCount: 2 },
  { id: "three-editorial", label: "Three photo editorial", columns: 3, rows: 1, photoCount: 3 },
  { id: "four", label: "Four photos", columns: 2, rows: 2, photoCount: 4 },
  {
    id: "five-hero",
    label: "Hero with four photos",
    columns: 3,
    rows: 2,
    photoCount: 5,
    slots: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.25, height: 0.5 },
      { x: 0.75, y: 0, width: 0.25, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.25, height: 0.5 },
      { x: 0.75, y: 0.5, width: 0.25, height: 0.5 },
    ],
  },
  { id: "six", label: "Six photos", columns: 3, rows: 2, photoCount: 6 },
  {
    id: "seven-magazine",
    label: "Seven photo magazine",
    columns: 4,
    rows: 2,
    photoCount: 7,
    slots: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 1 / 6, height: 0.5 },
      { x: 2 / 3, y: 0, width: 1 / 6, height: 0.5 },
      { x: 5 / 6, y: 0, width: 1 / 6, height: 0.5 },
      { x: 0.5, y: 0.5, width: 1 / 6, height: 0.5 },
      { x: 2 / 3, y: 0.5, width: 1 / 6, height: 0.5 },
      { x: 5 / 6, y: 0.5, width: 1 / 6, height: 0.5 },
    ],
  },
  { id: "eight-window", label: "Eight photo window", columns: 4, rows: 2, photoCount: 8 },
  { id: "nine", label: "Nine photo grid", columns: 3, rows: 3, photoCount: 9 },
  { id: "ten-collage", label: "Ten photo collage", columns: 5, rows: 2, photoCount: 10 },
  { id: "twelve", label: "Twelve photo grid", columns: 4, rows: 3, photoCount: 12 },
  { id: "sixteen", label: "Sixteen photo grid", columns: 4, rows: 4, photoCount: 16 },
  { id: "polaroid-story", label: "Polaroid inspired", columns: 3, rows: 1, photoCount: 3, slots: [
    { x: 0.01, y: 0.04, width: 0.31, height: 0.84, mask: { kind: "rounded", radius: 24 } },
    { x: 0.345, y: 0.1, width: 0.31, height: 0.84, mask: { kind: "rounded", radius: 24 } },
    { x: 0.68, y: 0.02, width: 0.31, height: 0.84, mask: { kind: "rounded", radius: 24 } },
  ] },
  { id: "arch-gallery", label: "Arch gallery", columns: 4, rows: 1, photoCount: 4, slots: [0, 1, 2, 3].map((column) => ({ x: column / 4, y: 0, width: 0.25, height: 1, mask: { kind: "arch-top" as const } })) },
  { id: "minimal-wedding", label: "Minimal wedding", columns: 3, rows: 2, photoCount: 5, slots: [
    { x: 0, y: 0, width: 2 / 3, height: 0.62, mask: { kind: "rounded", radius: 24 } },
    { x: 2 / 3, y: 0, width: 1 / 3, height: 0.62, mask: { kind: "arch-top" } },
    { x: 0, y: 0.62, width: 1 / 3, height: 0.38, mask: { kind: "rounded", radius: 24 } },
    { x: 1 / 3, y: 0.62, width: 1 / 3, height: 0.38, mask: { kind: "rounded", radius: 24 } },
    { x: 2 / 3, y: 0.62, width: 1 / 3, height: 0.38, mask: { kind: "rounded", radius: 24 } },
  ] },
  {
    id: "feature-left",
    label: "Feature left",
    columns: 3,
    rows: 2,
    photoCount: 5,
    slots: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.25, height: 0.5 },
      { x: 0.75, y: 0, width: 0.25, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.25, height: 0.5 },
      { x: 0.75, y: 0.5, width: 0.25, height: 0.5 },
    ],
  },
];

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeGridSlot(slot: Partial<GridSlot> | Record<string, unknown>, index = 0): GridSlot {
  const source = slot as Partial<GridSlot>;
  const mask = source.mask && typeof source.mask === "object" ? source.mask : ({ kind: "rectangle" } as MaskShape);
  return {
    id: String(source.id || `slot_${index + 1}`),
    x: Math.min(1, Math.max(0, finite(source.x))),
    y: Math.min(1, Math.max(0, finite(source.y))),
    width: Math.min(1, Math.max(0.0001, finite(source.width, 1))),
    height: Math.min(1, Math.max(0.0001, finite(source.height, 1))),
    assetId: String(source.assetId || ""),
    src: String(source.src || ""),
    bucket: source.bucket ? String(source.bucket) : undefined,
    path: source.path ? String(source.path) : undefined,
    originalPath: source.originalPath ? String(source.originalPath) : undefined,
    ownerId: source.ownerId ? String(source.ownerId) : undefined,
    assetReference: source.assetReference,
    transform: { ...defaultImageTransform(String(source.assetId || "")), ...(source.transform || {}) },
    filters: normalizeImageFilters(source.filters),
    permissions: source.permissions && typeof source.permissions === "object" ? source.permissions : {},
    required: Boolean(source.required),
    mask,
    metadata: source.metadata && typeof source.metadata === "object" ? source.metadata : {},
  };
}

export function createGridSlots(columns: number, rows: number): GridSlot[] {
  const safeColumns = Math.min(12, Math.max(1, Math.round(finite(columns, 1))));
  const safeRows = Math.min(12, Math.max(1, Math.round(finite(rows, 1))));
  const slots: GridSlot[] = [];
  for (let row = 0; row < safeRows; row += 1) {
    for (let column = 0; column < safeColumns; column += 1) {
      slots.push(
        normalizeGridSlot(
          {
            id: `slot_${row + 1}_${column + 1}`,
            x: column / safeColumns,
            y: row / safeRows,
            width: 1 / safeColumns,
            height: 1 / safeRows,
          },
          slots.length,
        ),
      );
    }
  }
  return slots;
}

export function createGridSlotsFromPreset(presetId: string): GridSlot[] {
  const preset = GRID_PRESETS.find((item) => item.id === presetId) || GRID_PRESETS[2];
  if (preset.slots?.length) {
    return preset.slots.map((slot, index) => normalizeGridSlot({ ...slot, id: `slot_${index + 1}` }, index));
  }
  return createGridSlots(preset.columns, preset.rows);
}

export type GridSlotRect = { x: number; y: number; width: number; height: number; centerX: number; centerY: number };

export function getGridSlotRect(layer: Pick<GridLayer, "x" | "y" | "width" | "height" | "padding" | "gap">, slot: GridSlot): GridSlotRect {
  const padding = Math.max(0, finite(layer.padding));
  const gap = Math.max(0, finite(layer.gap));
  const left = layer.x - layer.width / 2 + padding;
  const top = layer.y - layer.height / 2 + padding;
  const innerWidth = Math.max(1, layer.width - padding * 2);
  const innerHeight = Math.max(1, layer.height - padding * 2);
  const inset = gap / 2;
  const x = left + slot.x * innerWidth + inset;
  const y = top + slot.y * innerHeight + inset;
  const width = Math.max(1, slot.width * innerWidth - gap);
  const height = Math.max(1, slot.height * innerHeight - gap);
  return { x, y, width, height, centerX: x + width / 2, centerY: y + height / 2 };
}

export function validateGridGeometry(layer: Pick<GridLayer, "slots">): Array<{ slotId: string; code: string }> {
  const issues: Array<{ slotId: string; code: string }> = [];
  for (const raw of layer.slots || []) {
    const slot = normalizeGridSlot(raw);
    if (slot.x < 0 || slot.y < 0 || slot.x + slot.width > 1.000001 || slot.y + slot.height > 1.000001) {
      issues.push({ slotId: slot.id, code: "GRID_SLOT_OUT_OF_BOUNDS" });
    }
    const transform = slot.transform as ImageTransform;
    if (!(transform.zoom > 0) || transform.cropWidth < 0 || transform.cropHeight < 0) {
      issues.push({ slotId: slot.id, code: "INVALID_CROP" });
    }
    if (!slot.mask || typeof slot.mask !== "object" || !("kind" in slot.mask)) {
      issues.push({ slotId: slot.id, code: "INVALID_MASK" });
    }
  }
  return issues;
}

export function mergeGridSlotOverrides(
  slots: GridSlot[],
  overrides:
    | Record<
        string,
        {
          assetId?: string;
          src?: string;
            bucket?: string;
            path?: string;
            originalPath?: string;
            ownerId?: string;
            assetReference?: GridSlot["assetReference"];
          metadata?: Record<string, unknown>;
          transform?: Partial<ImageTransform>;
        }
      >
    | undefined,
): GridSlot[] {
  if (!overrides) return slots;
  return slots.map((slot, index) => {
    const patch = overrides[slot.id];
    if (!patch) return slot;
    return normalizeGridSlot(
      {
        ...slot,
        ...patch,
        transform: { ...slot.transform, ...(patch.transform || {}) },
      },
      index,
    );
  });
}
