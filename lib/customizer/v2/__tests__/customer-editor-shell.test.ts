import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Wiring guards for the customer editor shell. Each assertion pins a defect
// that was observed in a real browser at a real viewport size.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const personalize = read("app/products/[slug]/personalize/personalize-client.tsx");
const header = read("app/components/customizer/CustomerCustomizerHeader.tsx");
const workspace = read("app/components/customizer/CustomizerWorkspace.tsx");
const zoomControls = read("app/components/customizer/CustomizerZoomControls.tsx");
const adminCanvas = read("app/admin/dashboard/design-builder/AdminCanvas.tsx");
const adminPreview = read("app/admin/dashboard/design-builder/AdminCustomerPreview.tsx");

describe("Fit is measured, never hardcoded (spec §9)", () => {
  it("no surface still fits by setting zoom to 1", () => {
    for (const source of [personalize, adminPreview]) {
      expect(source).not.toContain("onFit={() => setViewZoom(1)}");
      expect(source).not.toContain("onFit={() => setZoom(1)}");
    }
  });

  it("both canvases measure their box on two axes", () => {
    for (const source of [workspace, adminCanvas]) {
      expect(source).toContain("availableHeight: containerHeight");
    }
    // The customer workspace keeps the width-based base scale with a separate
    // measured Fit zoom.
    expect(workspace).toContain("computeFitZoom");
    expect(workspace).toContain("onFitZoomChange?.(fitZoom)");
    // The admin builder redefines zoom 1 as the fitted page, so its base width
    // comes from the workspace fit itself and 1:1 is reported instead.
    expect(adminCanvas).toContain("computeWorkspaceFit");
    expect(adminCanvas).toContain("onFitZoomChange?.(actualZoom)");
    expect(adminCanvas).not.toContain("maxCanvasWidth");
  });

  it("re-measures on resize and orientation change, not only via ResizeObserver", () => {
    for (const source of [workspace, adminCanvas]) {
      expect(source).toContain('window.addEventListener("resize", update)');
      expect(source).toContain('window.addEventListener("orientationchange", update)');
      expect(source).toContain('window.removeEventListener("resize", update)');
      expect(source).toContain('window.removeEventListener("orientationchange", update)');
    }
  });

  it("follows Fit until the customer picks their own zoom", () => {
    expect(personalize).toContain("userChoseZoomRef");
    expect(personalize).toContain("if (!userChoseZoomRef.current) setViewZoom(next)");
    expect(adminPreview).toContain("if (!userChoseZoomRef.current) setZoom(next)");
  });

  it("shares one zoom range across the stepper, pinch and Fit", () => {
    expect(zoomControls).toContain('from "@/lib/customizer/v2/zoom"');
    expect(workspace).toContain("clampZoom(gesture.zoom * ratio, ZOOM_MIN, ZOOM_MAX)");
    // The old hardcoded pinch clamp is gone.
    expect(workspace).not.toContain("Math.min(3, Math.max(0.35,");
  });
});

describe("mobile header fits a 320px phone (spec §8, DoD 6)", () => {
  it("moves the step nav out of the crowded main row", () => {
    expect(header).toContain('className="hidden shrink-0 items-center gap-0.5 rounded-full bg-[#F0EDED] p-1 sm:flex"');
  });

  it("gives the overflow actions a menu instead of a fifth icon button", () => {
    expect(header).toContain("function MoreMenu");
    expect(header).toContain('aria-label="More actions"');
    expect(header).toContain('aria-haspopup="menu"');
    // Dismissible by Escape and outside press.
    expect(header).toContain('event.key !== "Escape"');
    expect(header).toContain('document.addEventListener("pointerdown", onPointerDown)');
  });

  it("keeps 44px touch targets on the mobile step control", () => {
    expect(header).toContain("min-h-11 min-w-0 flex-1 truncate rounded-full");
  });

  it("does not signal save state by colour alone", () => {
    expect(header).toContain('role="status"');
    expect(header).toContain("{saveStatusLabel}");
  });
});

describe("mobile layout prioritises the canvas (spec §8, DoD 5)", () => {
  it("hides the tall page-thumbnail strip on phones and keeps a compact pager", () => {
    expect(personalize).toContain(
      'className="hidden overflow-x-auto border-t border-[#303839]/8 bg-white px-3 py-2.5 no-scrollbar md:block"',
    );
    expect(personalize).toContain('role="group" aria-label="Page navigation"');
    expect(personalize).not.toContain(
      'shadow-[0_2px_12px_rgba(48,56,57,0.08)] md:flex" role="group" aria-label="Page navigation"',
    );
  });
});

describe("autosave reliability (spec §11)", () => {
  it("runs through the single-flight save queue, not a bare setTimeout", () => {
    expect(personalize).toContain("createSaveQueue");
    expect(personalize).toContain("saveQueue.request()");
    expect(personalize).not.toContain("saveCustomizationDraft(\"draft\", { silent: true });\n      }, 900)");
  });

  it("never marks a draft Saved before the write resolves", () => {
    // The raw save no longer sets any status; only the queue and the explicit
    // tracked save do, and both set it after the write settles.
    const rawSave = personalize.slice(
      personalize.indexOf("const saveCustomizationDraft = async"),
      personalize.indexOf("/* ----- autosave queue"),
    );
    expect(rawSave).not.toContain('setSaveStatus("saved")');
    expect(rawSave).not.toContain('setSaveStatus("saving")');
  });

  it("keeps an explicit save from racing the queue", () => {
    expect(personalize).toContain("explicitSaveRef");
    expect(personalize).toContain("await saveQueue.flush()");
  });

  it("distinguishes a device-only draft from a confirmed server save", () => {
    expect(personalize).toContain('setSaveStatus(result?.local ? "saved-local" : "saved")');
  });
});
