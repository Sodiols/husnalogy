import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("admin properties sidebar contract", () => {
  const panel = read("app/admin/dashboard/design-builder/AdminPropertiesPanel.tsx");
  const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
  const adminCanvas = read("app/admin/dashboard/design-builder/AdminCanvas.tsx");
  const customerCanvas = read("app/components/customizer/CustomizerWorkspace.tsx");

  it("does not render position, size, or arrange inspectors", () => {
    expect(panel).not.toContain('<Section title="Position & size">');
    expect(panel).not.toContain('<Section title="Arrange"');
    expect(panel).not.toContain('ariaLabel="X position"');
    expect(panel).not.toContain('ariaLabel="Opacity"');
    // The inspector is a bounded-width sidebar (now on the right, per the
    // editor redesign) that collapses to a bottom drawer on small screens.
    expect(builder).toContain("w-[clamp(300px,21vw,360px)]");
    expect(builder).toContain("max-lg:bottom-0");
  });

  it("keeps simple text content and direct font-size editing", () => {
    expect(panel).toContain("<Lbl>Text content</Lbl>");
    expect(panel).toContain("<Lbl>Font size</Lbl>");
    expect(panel).toContain('ariaLabel="Font size"');
    expect(panel).toContain("showStepButtons={false}");
    expect(panel).toContain("<textarea");
    expect(panel).toContain('resolveTextEditorKeyAction(event, true)');
    expect(panel).toContain('multiline: true');
    expect(panel).toContain('autoSizeMode: "height"');
  });

  it("uses the Husnalogy soft background for customer access", () => {
    expect(panel).toContain('bg-[#F8F6F1]');
    expect(panel).not.toContain("#F4ECEC");
  });

  it("uses text-specific resize constraints and inline editors in both canvases", () => {
    for (const canvas of [adminCanvas, customerCanvas]) {
      expect(canvas).toContain("getTextResizeConstraints");
      expect(canvas).toContain("<InlineCanvasTextEditor");
      expect(canvas).toContain("This text is too long for the available space.");
    }
    expect(adminCanvas).toContain('id: "n"');
    expect(adminCanvas).toContain('id: "e"');
    expect(customerCanvas).toContain('id: "n"');
    expect(customerCanvas).toContain('id: "e"');
  });
});
