import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

describe("leaving unsaved design work asks first", () => {
  const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
  it("Back to Product goes through the exit prompt, which never closes on a failed save", () => {
    expect(builder).toContain("onBack={requestExit}");
    expect(builder).toMatch(/if \(result\.ok === false \|\| revisions\.isDirty\(\)\) \{\s*setExitPrompt\(\{ phase: "failed"/);
    expect(builder).toContain("await autosaveInFlightRef.current;");
    // Discard returns to the server-confirmed design, never to defaults.
    expect(builder).toContain("apply(lastSavedTemplateRef.current, revisions.saved);");
    expect(builder).toContain("lastSavedTemplateRef.current = sent;");
  });
  it("only offers Save and exit when the design can reach the server", () => {
    expect(builder).toContain("const canReachServer = Boolean(productId) || canCreateDraft;");
    expect(builder).toMatch(/\{canReachServer \? \(/);
    expect(builder).toContain("Keep changes and add a name");
  });
  it("the dashboard asks before the product form (and the studio in it) is unmounted", () => {
    const dashboard = read("app/admin/dashboard/admin-dashboard-client.tsx");
    for (const guarded of ["const closeProductForm = () =>\n    leaveUnsavedDesign(", "const handleLogout = () => leaveUnsavedDesign(", "const editProduct = (product) =>\n    leaveUnsavedDesign("]) {
      expect(dashboard.replace(/\r\n/g, "\n")).toContain(guarded);
    }
    expect(dashboard).toContain("leaveUnsavedDesign(() => changeSectionNow(section))");
    expect(read("app/admin/dashboard/product-upload-form.tsx")).toContain("onUnsavedChange={onDesignUnsavedChange}");
  });
});
