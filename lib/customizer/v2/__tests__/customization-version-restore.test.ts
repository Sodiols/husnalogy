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
    // The automatic "latest draft" lookup (no design id in the URL) is held to
    // the active version; a design opened by id is pinned server-side instead.
    expect(client).toContain("requireCurrentTemplateVersion: fromLatestDraft");
    expect(route).toContain('url.searchParams.get("templateVersion")');
    expect(route).toContain('query.eq("template_version", templateVersion)');
  });

  it("passes the persisted editor state when validating a draft migration", () => {
    // The whole stored row (including template_version and render_data) is
    // loaded with a strict owner filter, and its editor state is what the
    // validator compares persisted overrides against.
    expect(patchRoute).toContain('.from("product_customizations").select("*").eq("id", id).eq("user_id", userId)');
    expect(patchRoute).toContain("templateVersion: Number(existingRow.template_version) || 0");
    expect(patchRoute).toContain("editorState: (existingRow.render_data as any)?.editorState || null");
  });

  it("does not allow layer-order actions for position-locked selections", () => {
    expect(client).toContain("const canArrangeSelection =");
    expect(client).toContain("if (!canArrangeSelection) return");
    expect(client).toContain("!layer.positionLocked");
    expect(client).toContain("getLayerPermissions(layer).changeLayerOrder");
  });
});
