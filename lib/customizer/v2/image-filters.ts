import type { ImageFilters } from "./types";

const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: unknown, min: number, max: number, fallback: number) => Math.min(max, Math.max(min, finite(value, fallback)));

export function normalizeImageFilters(input: Partial<ImageFilters> | Record<string, unknown> | null | undefined): ImageFilters {
  const source = input || {};
  return {
    brightness: clamp(source.brightness, 0, 2, 1),
    contrast: clamp(source.contrast, 0, 2, 1),
    saturation: clamp(source.saturation, 0, 2, 1),
    grayscale: clamp(source.grayscale, 0, 1, 0),
    sepia: clamp(source.sepia, 0, 1, 0),
    tintColor: /^#[0-9a-f]{6}$/i.test(String(source.tintColor || "")) ? String(source.tintColor) : undefined,
    tintAmount: clamp(source.tintAmount, 0, 1, 0),
  };
}

export function hasImageFilters(input: Partial<ImageFilters> | Record<string, unknown> | null | undefined): boolean {
  const value = normalizeImageFilters(input);
  return value.brightness !== 1 || value.contrast !== 1 || value.saturation !== 1 || value.grayscale > 0 || value.sepia > 0 || Boolean(value.tintColor && value.tintAmount > 0);
}

export function imageFilterCss(input: Partial<ImageFilters> | Record<string, unknown> | null | undefined): string {
  const value = normalizeImageFilters(input);
  return `brightness(${value.brightness}) contrast(${value.contrast}) saturate(${value.saturation}) grayscale(${value.grayscale}) sepia(${value.sepia})`;
}

export function imageFilterSvgPrimitives(input: Partial<ImageFilters> | Record<string, unknown> | null | undefined): string {
  const value = normalizeImageFilters(input);
  const slope = value.brightness * value.contrast;
  const intercept = 0.5 - 0.5 * value.contrast;
  const parts = [
    `<feComponentTransfer><feFuncR type="linear" slope="${slope}" intercept="${intercept}"/><feFuncG type="linear" slope="${slope}" intercept="${intercept}"/><feFuncB type="linear" slope="${slope}" intercept="${intercept}"/></feComponentTransfer>`,
    `<feColorMatrix type="saturate" values="${value.saturation}"/>`,
  ];
  if (value.grayscale > 0) parts.push(`<feColorMatrix type="saturate" values="${1 - value.grayscale}"/>`);
  if (value.sepia > 0) {
    const s = value.sepia;
    const inv = 1 - s;
    parts.push(`<feColorMatrix type="matrix" values="${inv + 0.393 * s} ${0.769 * s} ${0.189 * s} 0 0 ${0.349 * s} ${inv + 0.686 * s} ${0.168 * s} 0 0 ${0.272 * s} ${0.534 * s} ${inv + 0.131 * s} 0 0 0 0 0 1 0"/>`);
  }
  if (value.tintColor && value.tintAmount > 0) {
    parts.push(`<feFlood flood-color="${value.tintColor}" flood-opacity="${value.tintAmount}" result="tint"/><feBlend in="SourceGraphic" in2="tint" mode="multiply"/>`);
  }
  return parts.join("");
}
