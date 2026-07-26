import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const component = read("app/components/customizer/EditableNumericStepper.tsx");

function tsxFiles(directory: string): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(relative) : entry.name.endsWith(".tsx") ? [relative] : [];
  });
}

describe("editable numeric stepper component contract", () => {
  it("implements select, commit, cancel, keyboard stepping, and mobile input modes", () => {
    expect(component).toContain("event.currentTarget.select()");
    expect(component).toContain('event.key === "Enter"');
    expect(component).toContain("onBlur");
    expect(component).toContain('event.key === "Escape"');
    expect(component).toContain('event.key === "ArrowUp"');
    expect(component).toContain('event.key === "ArrowDown"');
    expect(component).toContain("event.shiftKey");
    expect(component).toContain('inputMode={allowDecimal || allowNegative ? "decimal" : "numeric"}');
  });

  it("keeps typing as a preview and commits only through explicit commit paths", () => {
    const changeHandler = component.match(/onChange=\{\(event\) => \{([\s\S]*?)\n        \}\}/)?.[1] || "";
    expect(changeHandler).toContain("setDraft(sanitized)");
    expect(changeHandler).toContain("onPreviewChange");
    expect(changeHandler).not.toContain("onCommit(");
    expect(component).toContain("if (shouldCommit) onCommit(next)");
  });

  it("replaces legacy range and number settings throughout both customizers", () => {
    const files = [
      ...tsxFiles("app/components/customizer"),
      ...tsxFiles("app/admin/dashboard/design-builder"),
    ];
    const legacy = files
      .filter((file) => !file.endsWith("EditableNumericStepper.tsx"))
      .filter((file) => /type=["'](?:number|range)["']/.test(read(file)));
    expect(legacy).toEqual([]);
    expect(read("app/admin/dashboard/design-builder/AdminPropertiesPanel.tsx")).toContain("EditableNumericStepper");
  });

  it("disables customer numeric editing when the property permission is absent", () => {
    const selectionPanel = read("app/components/customizer/CustomerSelectionPanel.tsx");
    const gridToolbar = read("app/components/customizer/CustomerGridToolbar.tsx");
    expect(selectionPanel).toContain('const canOpacity = allow("changeOpacity")');
    expect(selectionPanel).toContain("disabled={!canOpacity}");
    expect(selectionPanel).toContain("disabled={!canStyle}");
    expect(gridToolbar).toContain("disabled={!(permissions.zoomImage || permissions.cropImage)}");
  });

  it("uses direct numeric inputs without visible carousel buttons in both text toolbars", () => {
    const adminToolbar = read("app/admin/dashboard/design-builder/AdminContextToolbar.tsx");
    const customerToolbar = read("app/components/customizer/CustomerContextToolbar.tsx");
    expect(component).toContain("showStepButtons?: boolean");
    expect(component).toContain("showStepButtons &&");
    for (const toolbar of [adminToolbar, customerToolbar]) {
      expect(toolbar).toContain("showStepButtons={false}");
      expect(toolbar).toContain('label="Font size"');
      expect(toolbar).toMatch(/label="Letter spac(?:e|ing)"/);
      expect(toolbar).toContain('label="Line height"');
    }
    expect(adminToolbar).toContain('sharedStyleValue(layers, "fontSize", 48)');
    expect(adminToolbar).toContain('sharedStyleValue(layers, "letterSpacing", 0)');
    expect(adminToolbar).toContain('sharedStyleValue(layers, "lineHeight", 1.15)');
    expect(customerToolbar).toContain("style.fontSize ?? 48");
    expect(customerToolbar).toContain("style.letterSpacing ?? 0");
    expect(customerToolbar).toContain("style.lineHeight ?? 1.2");
  });

  it("uses one alignment dropdown for horizontal and vertical text alignment", () => {
    const alignment = read("app/components/customizer/TextAlignmentDropdown.tsx");
    const adminToolbar = read("app/admin/dashboard/design-builder/AdminContextToolbar.tsx");
    const customerToolbar = read("app/components/customizer/CustomerContextToolbar.tsx");
    expect(alignment).toContain('role="menu"');
    expect(alignment).toContain('role="menuitemradio"');
    expect(alignment).toContain('event.key === "Escape"');
    expect(alignment).toContain('document.addEventListener("pointerdown", onOutside)');
    expect(alignment).toContain("grid grid-cols-3");
    expect(adminToolbar).toContain("<TextAlignmentDropdown");
    expect(customerToolbar).toContain("<TextAlignmentDropdown");
    expect(customerToolbar).toContain("canHorizontal={canAlign}");
    expect(customerToolbar).toContain("canVertical={canVerticalAlign}");
  });

  it("shows mixed typography values and applies admin changes to every selected text layer", () => {
    const stepper = read("app/components/customizer/EditableNumericStepper.tsx");
    const toolbar = read("app/admin/dashboard/design-builder/AdminContextToolbar.tsx");
    const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
    expect(stepper).toContain('placeholder={mixed ? "Mixed" : undefined}');
    expect(toolbar).toContain("values.some((value) => value !== values[0])");
    expect(toolbar).toContain('horizontal={textAlign.mixed ? "mixed"');
    expect(builder).toContain("for (const layer of selectedLayers)");
    expect(builder).toContain('if (layer.type === "text") next = constrainTextLayerBox(updateLayerStyle');
  });

  it("omits grid and grouping actions from the admin tool rail", () => {
    const rail = read("app/admin/dashboard/design-builder/AdminToolRail.tsx");
    expect(rail).not.toContain('label="Grid"');
    expect(rail).not.toContain('label="Group"');
    expect(rail).not.toContain('label="Ungroup"');
  });
});
