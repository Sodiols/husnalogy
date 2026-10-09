import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Product decision: the Customizer has no Effects feature and no Remove BG
// (background removal of photos). The image Eraser is a separate, kept tool.
const roots = ["app/admin/dashboard/design-builder", "app/components/customizer", "app/products/[slug]/personalize", "lib/customizer/v2"];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : files(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });

describe("forbidden Customizer controls", () => {
  const sources = roots.flatMap((root) => files(path.join(process.cwd(), root))).map((file) => ({ file, text: readFileSync(file, "utf8") }));
  it("no Effects control or Remove BG workflow exists in either editor", () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/["'>]\s*Effects\s*["'<]/);
      expect(text, file).not.toMatch(/remove\s*-?\s*bg|removeBg|remove_bg|background[- ]removal/i);
    }
  });
  it("the image Eraser is still there", () => {
    expect(sources.some(({ file }) => file.endsWith("AdminEraserBar.tsx"))).toBe(true);
  });
});
