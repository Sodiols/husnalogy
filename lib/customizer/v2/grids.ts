import type { GridLayer, GridSlot, ImageTransform, MaskShape } from "./types";
import { defaultImageTransform } from "./types";

export type GridPreset = {
  id: string;
  label: string;
  columns: number;
  rows: number;
  weights?: number[][];
};

export const GRID_PRESETS: GridPreset[] = [
  { id: "two-columns", label: "Two columns", columns: 2, rows: 1 },
  { id: "two-rows", label: "Two rows", columns: 1, rows: 2 },
  { id: "four", label: "Four photos", columns: 2, rows: 2 },
  { id: "six", label: "Six photos", columns: 3, rows: 2 },
  { id: "feature-left", label: "Feature left", columns: 3, rows: 2, weights: [[2, 1, 1], [2, 1, 1]] },
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
