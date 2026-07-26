import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "app/components/customizer/ServerCustomizationImage.tsx"),
  "utf8",
);

describe("server customization image request lifecycle", () => {
  it("handles aborted preview requests without updating an unmounted component", () => {
    expect(source).toContain("let cancelled = false");
    expect(source).toContain("controller.signal.aborted");
    expect(source).toContain('(requestError as Error)?.name !== "AbortError"');
    expect(source).toContain("if (!cancelled) setLoading(false)");
    expect(source).toContain("cancelled = true");
    expect(source).not.toContain(".finally(() => setLoading(false))");
  });
});
