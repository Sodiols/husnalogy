import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = readFileSync(
  path.join(root, "app/products/[slug]/personalize/personalize-client.tsx"),
  "utf8",
);

// Spec §1/§2/§9: Easy Personalize must be the default customer experience —
// only Your Details, Photos, and Options — with professional canvas tools
// (Add Text, Elements, Shapes, Lines, Frames, Grids, QR, Background, Layers)
// gated behind an explicit "Advanced Customize" switch. Both modes must read
// and write the SAME values/editorState, never a second document.
describe("Easy Personalize / Advanced Customize", () => {
  it("defaults to Easy Personalize", () => {
    expect(source).toMatch(/useState<"easy" \| "advanced">\("easy"\)/);
  });

  it("narrows the tool rail to edit/uploads/options in Easy mode", () => {
    expect(source).toContain('new Set<CustomerTool>(["edit", "uploads", "options"])');
    expect(source).toContain(
      'customizeMode === "easy" ? tools.filter((tool) => EASY_PERSONALIZE_TOOL_IDS.has(tool.id)) : tools',
    );
  });

  it("exposes an explicit toggle between Easy Personalize and Advanced Customize", () => {
    expect(source).toContain('"Advanced Customize"');
    expect(source).toContain('"Simple View"');
    expect(source).toContain("setCustomizeModeSafely");
  });

  it("never introduces a second document: the toggle only gates tool visibility, sharing the same values/editorState", () => {
    // The mode setter must not touch values/editorState/history at all —
    // only activeTool, which is pure UI navigation state.
    const setterMatch = source.match(/const setCustomizeModeSafely = \(mode: "easy" \| "advanced"\) => \{[\s\S]*?\n  \};/);
    expect(setterMatch).toBeTruthy();
    const body = setterMatch![0];
    expect(body).not.toContain("setValues");
    expect(body).not.toContain("setEditorState");
    expect(body).not.toContain("recordHistory");
  });
});
