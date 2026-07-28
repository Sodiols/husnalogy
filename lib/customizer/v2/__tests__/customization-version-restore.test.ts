import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const client = readFileSync(
  path.join(root, "app/products/[slug]/personalize/personalize-client.tsx"),
  "utf8",
);
const route = readFileSync(
  path.join(root, "app/api/customizations/route.ts"),
  "utf8",
);
const patchRoute = readFileSync(
  path.join(root, "app/api/customizations/[id]/route.ts"),
  "utf8",
);

describe("customization template-version restore", () => {
  it("loads automatic drafts only for the active published template version", () => {
    expect(client).toContain('templateVersion: String(Number(template?.version) || 1)');
    expect(client).toContain("requireCurrentTemplateVersion: true");
    expect(route).toContain('url.searchParams.get("templateVersion")');
    expect(route).toContain('query.eq("template_version", templateVersion)');
  });

  it("passes the persisted editor state when validating a draft migration", () => {
    expect(patchRoute).toContain("template_version, render_data");
    expect(patchRoute).toContain("editorState: (existingRow.render_data as any)?.editorState || null");
  });

  it("does not allow layer-order actions for position-locked selections", () => {
    expect(client).toContain("const canArrangeSelection =");
    expect(client).toContain("if (!canArrangeSelection) return");
    expect(client).toContain("!layer.positionLocked");
    expect(client).toContain("getLayerPermissions(layer).changeLayerOrder");
  });
});
