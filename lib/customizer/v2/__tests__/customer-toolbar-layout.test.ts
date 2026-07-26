import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = readFileSync(
  path.join(root, "app/products/[slug]/personalize/personalize-client.tsx"),
  "utf8",
);

describe("customer toolbar layout", () => {
  it("matches the admin floating toolbar position without covering the canvas", () => {
    expect(source).toContain("data-customer-toolbar-dock");
    expect(source).toContain("pointer-events-none absolute inset-x-0 top-3 z-40");
    expect(source).toContain("data-customer-toolbar-spacer");
    expect(source).toContain('className="h-[72px] shrink-0"');
    expect(source).toContain('<div className="relative min-h-0 flex-1">');
  });

  it("keeps opacity and arrange controls out of the canvas toolbar", () => {
    expect(source).toContain("CustomerSelectionPanel");
    expect(source).toContain("{selectionPanel}");
    expect(source).not.toContain("CustomerObjectToolbar");
    expect(source).not.toContain("showObjectToolbar");
  });

  it("uses the same selection panel in desktop and mobile properties views", () => {
    expect(source.match(/\{panelBody\}/g)?.length).toBe(2);
  });
});
