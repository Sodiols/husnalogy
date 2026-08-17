import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveReviewIssues, validateCustomerValues } from "@/app/components/customizer/customizer-utils";

// Spec §28: "Surface actionable blocking problems… Allow navigation directly to
// the relevant page or object where practical."
//
// The review step listed validation messages as inert text. On a multi-page
// product that tells the customer what is wrong but not where, so each issue is
// now resolved to its layer and page and rendered as a jump.

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
const reviewSource = read("app/components/customizer/CustomizerReviewStep.tsx");
const personalizeSource = read("app/products/[slug]/personalize/personalize-client.tsx");

const template = {
  pages: [
    { id: "front", label: "Front", enabled: true },
    { id: "back", label: "Back", enabled: true },
  ],
  fields: [
    { id: "names", label: "Names", type: "text", required: true },
    { id: "photo", label: "Photo", type: "image", required: true },
    { id: "orphan", label: "Orphan", type: "text", required: true },
  ],
  layers: [
    {
      id: "names_layer",
      type: "text",
      page: "front",
      fieldId: "names",
      customerEditable: true,
    },
    {
      id: "photo_layer",
      type: "image",
      page: "back",
      fieldId: "photo",
      customerEditable: true,
    },
  ],
};

describe("resolveReviewIssues", () => {
  it("resolves each issue to its layer and page", () => {
    const issues = resolveReviewIssues(template, {
      names: "Names is required.",
      photo: "Photo is required.",
    });
    expect(issues).toEqual([
      {
        fieldId: "names",
        message: "Names is required.",
        layerId: "names_layer",
        pageId: "front",
        pageLabel: "Front",
      },
      {
        fieldId: "photo",
        message: "Photo is required.",
        layerId: "photo_layer",
        pageId: "back",
        pageLabel: "Back",
      },
    ]);
  });

  it("leaves a null target when no visible layer uses the field", () => {
    const [issue] = resolveReviewIssues(template, { orphan: "Orphan is required." });
    expect(issue.layerId).toBeNull();
    expect(issue.pageId).toBeNull();
  });

  it("skips hidden layers and layers on disabled pages", () => {
    const hiddenTemplate = {
      ...template,
      pages: [{ id: "front", label: "Front", enabled: true }],
      layers: [
        { id: "hidden_layer", type: "text", page: "front", fieldId: "names", hidden: true },
        { id: "disabled_page_layer", type: "image", page: "back", fieldId: "photo" },
      ],
    };
    const issues = resolveReviewIssues(hiddenTemplate, {
      names: "Names is required.",
      photo: "Photo is required.",
    });
    expect(issues.every((issue) => issue.layerId === null)).toBe(true);
  });

  it("returns nothing for an empty error map", () => {
    expect(resolveReviewIssues(template, {})).toEqual([]);
  });

  it("lines up with what validateCustomerValues actually produces", () => {
    const { errors, ok } = validateCustomerValues(template, {});
    expect(ok).toBe(false);
    const issues = resolveReviewIssues(template, errors);
    const named = issues.find((issue) => issue.fieldId === "names");
    expect(named?.layerId).toBe("names_layer");
    expect(named?.message).toContain("required");
  });
});

describe("review step wiring", () => {
  it("renders a jump only when the issue resolves to an object", () => {
    expect(reviewSource).toContain(
      "const canJump = Boolean(onFixIssue && issue.layerId && issue.pageId);",
    );
  });

  it("names the destination page in the control", () => {
    expect(reviewSource).toContain('issue.pageLabel ? `Fix on ${issue.pageLabel} →` : "Fix this →"');
  });

  it("navigates to the page and selects the object", () => {
    expect(personalizeSource).toContain("setSelectedLayerIds([issue.layerId]);");
    expect(personalizeSource).toContain('setStep("design");');
  });

  it("uses the normal page-change path so stale editing state is cleared", () => {
    // Calling setActivePage directly would leave crop mode, group scope and an
    // in-progress text edit alive from the page being left behind.
    expect(personalizeSource).toContain("if (issue.pageId) onActivePageChange(issue.pageId);");
    expect(personalizeSource).not.toContain("if (issue.pageId) setActivePage(issue.pageId);");
  });
});
