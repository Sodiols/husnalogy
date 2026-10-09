import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AssetUploadError, describeUploadFailure, precheckBackgroundFile, uploadFailureOf } from "../upload-failure";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

describe("background upload failures are classified with actionable messages", () => {
  it("refuses unsupported formats, oversized and empty files before sending", () => {
    expect(precheckBackgroundFile({ type: "image/gif", size: 1000 })?.kind).toBe("unsupported-format");
    expect(precheckBackgroundFile({ type: "application/pdf", size: 1000 })?.kind).toBe("unsupported-format");
    expect(precheckBackgroundFile({ type: "image/png", size: 26 * 1024 * 1024 })?.kind).toBe("too-large");
    expect(precheckBackgroundFile({ type: "image/png", size: 0 })?.kind).toBe("invalid-image");
    expect(precheckBackgroundFile({ type: "image/webp", size: 5000 })).toBeNull();
    // Unknown browser type: the server sniffs the bytes.
    expect(precheckBackgroundFile({ type: "", size: 5000 })).toBeNull();
  });

  it("maps transport and HTTP outcomes", () => {
    expect(describeUploadFailure({ status: 0 })).toMatchObject({ kind: "network", retryable: true });
    expect(describeUploadFailure({ status: 0, aborted: true })).toMatchObject({ kind: "cancelled" });
    expect(describeUploadFailure({ status: 401 })).toMatchObject({ kind: "auth", retryable: false });
    expect(describeUploadFailure({ status: 403, serverMessage: "Forbidden" })).toMatchObject({ kind: "auth" });
    expect(describeUploadFailure({ status: 413 })).toMatchObject({ kind: "too-large", retryable: false });
    expect(describeUploadFailure({ status: 400, serverMessage: "Unsupported file type. Use JPG, PNG, or WebP." })).toMatchObject({ kind: "unsupported-format" });
    expect(describeUploadFailure({ status: 400, serverMessage: "Assets must be 25MB or smaller." })).toMatchObject({ kind: "too-large" });
    expect(describeUploadFailure({ status: 400, serverMessage: "This file could not be safely decoded or optimized." })).toMatchObject({ kind: "invalid-image", retryable: false });
    expect(describeUploadFailure({ status: 500, serverMessage: "Upload failed: bucket not found" })).toMatchObject({ kind: "storage", retryable: true });
    expect(describeUploadFailure({ status: 500, serverMessage: "The file uploaded, but its asset record could not be saved. The uploaded files were rolled back." })).toMatchObject({ kind: "storage" });
    const generic = describeUploadFailure({ status: 502 });
    expect(generic).toMatchObject({ kind: "server", retryable: true });
    expect(generic.message).toContain("502");
  });

  it("keeps the classification through the thrown error", () => {
    const failure = describeUploadFailure({ status: 401 });
    expect(uploadFailureOf(new AssetUploadError(failure))).toBe(failure);
    expect(uploadFailureOf(new Error("boom"))).toMatchObject({ kind: "server", message: "boom" });
    expect(uploadFailureOf("weird")).toMatchObject({ kind: "server" });
  });
});

describe("the studio wires failures to visible, non-destructive state", () => {
  it("the upload helper rejects with classified errors, and only success applies", () => {
    const utils = read("app/admin/dashboard/design-builder/builder-utils.ts");
    expect(utils).toContain("new AssetUploadError(describeUploadFailure({ status: request.status, serverMessage: payload?.error }))");
    expect(utils).toContain("new AssetUploadError(describeUploadFailure({ status: 0 }))");
    const hook = read("app/admin/dashboard/design-builder/use-background-upload.ts");
    // The page is changed only after the awaited upload resolves, and only by the latest upload.
    expect(hook).toMatch(/await uploadBuilderImage[\s\S]*if \(token !== latest\.current\) return;\s*applyRef\.current\(pageId, asset\)/);
    expect(hook).toMatch(/catch \(error\) \{\s*if \(token !== latest\.current\) return;\s*setState\(\{ status: "failed"/);
  });

  it("both background entry points render progress and failure with Retry", () => {
    for (const file of ["AdminPagesPanel.tsx", "AdminBackgroundPanel.tsx"]) {
      const source = read(`app/admin/dashboard/design-builder/${file}`);
      expect(source).toContain("useBackgroundUpload(onSetBackgroundImage)");
      expect(source).toContain("<BackgroundUploadStatus");
    }
  });
});
