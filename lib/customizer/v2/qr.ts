import QRCode from "qrcode";

export type QRErrorCorrection = "L" | "M" | "Q" | "H";

export type QRCodeStyle = {
  value: string;
  foregroundColor?: string;
  backgroundColor?: string;
  errorCorrection?: QRErrorCorrection;
  margin?: number;
  moduleStyle?: "square" | "rounded";
};

export type QRMatrix = { size: number; data: boolean[][]; margin: number };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidQRValue(value: unknown): boolean {
  const text = String(value || "").trim();
  if (!text || text.length > 2048) return false;
  try {
    const url = new URL(text);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function parseHex(input: string): [number, number, number] {
  const value = input.replace("#", "");
  const expanded = value.length === 3 ? value.split("").map((part) => `${part}${part}`).join("") : value;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(color: string): number {
  if (!HEX.test(color)) return 0;
  return parseHex(color)
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

export function qrContrastRatio(foregroundColor: string, backgroundColor: string): number {
  const a = luminance(HEX.test(foregroundColor) ? foregroundColor : "#000000");
  const b = luminance(HEX.test(backgroundColor) ? backgroundColor : "#ffffff");
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function normalizeQRCodeStyle(input: Partial<QRCodeStyle> | Record<string, unknown>): Required<QRCodeStyle> {
  const margin = Math.max(0, Math.min(16, Math.round(Number(input.margin) || 4)));
  const correction = String(input.errorCorrection || "M").toUpperCase();
  return {
    value: String(input.value || "https://husnalogy.com").trim().slice(0, 2048),
    foregroundColor: HEX.test(String(input.foregroundColor || "")) ? String(input.foregroundColor) : "#303839",
    backgroundColor: HEX.test(String(input.backgroundColor || "")) ? String(input.backgroundColor) : "#ffffff",
    errorCorrection: (["L", "M", "Q", "H"].includes(correction) ? correction : "M") as QRErrorCorrection,
    margin,
    moduleStyle: input.moduleStyle === "rounded" ? "rounded" : "square",
  };
}

export function createQRMatrix(styleInput: Partial<QRCodeStyle> | Record<string, unknown>): QRMatrix {
  const style = normalizeQRCodeStyle(styleInput);
  const qr = QRCode.create(style.value || "https://husnalogy.com", { errorCorrectionLevel: style.errorCorrection });
  const size = qr.modules.size;
  const rows: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    const cells: boolean[] = [];
    for (let column = 0; column < size; column += 1) cells.push(Boolean(qr.modules.get(row, column)));
    rows.push(cells);
  }
  return { size, data: rows, margin: style.margin };
}

export function qrModuleRects(styleInput: Partial<QRCodeStyle> | Record<string, unknown>) {
  const matrix = createQRMatrix(styleInput);
  const rects: Array<{ x: number; y: number }> = [];
  matrix.data.forEach((row, y) => row.forEach((dark, x) => dark && rects.push({ x: x + matrix.margin, y: y + matrix.margin })));
  return { ...matrix, totalSize: matrix.size + matrix.margin * 2, rects };
}

