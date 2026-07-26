import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const customerToolbar = readFileSync(
  path.join(root, "app/components/customizer/CustomerContextToolbar.tsx"),
  "utf8",
);
const sharedDropdown = readFileSync(
  path.join(root, "app/components/customizer/ToolbarDropdown.tsx"),
  "utf8",
);
const adminToolbar = readFileSync(
  path.join(root, "app/admin/dashboard/design-builder/AdminContextToolbar.tsx"),
  "utf8",
);

describe("customer toolbar dropdown design", () => {
  it("shares the polished dropdown implementation with the admin customizer", () => {
    expect(customerToolbar).toContain('from "./ToolbarDropdown"');
    expect(adminToolbar).toContain('from "@/app/components/customizer/ToolbarDropdown"');
    expect(customerToolbar).not.toContain("<select");
  });

  it("supports accessible keyboard and focus behaviour", () => {
    expect(sharedDropdown).toContain('role="listbox"');
    expect(sharedDropdown).toContain('role="option"');
    expect(sharedDropdown).toContain('aria-selected={isSelected}');
    expect(sharedDropdown).toContain('event.key === "ArrowDown"');
    expect(sharedDropdown).toContain('event.key !== "Escape"');
    expect(sharedDropdown).toContain("focus-visible:ring-2");
  });
});
