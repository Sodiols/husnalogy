import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  formatCustomizerVersion,
  nextCustomizerVersion,
} from "@/lib/customizer/public-version";

describe("customizer public versioning", () => {
  it.each([
    [{ major: 2, revision: 0 }, "2"],
    [{ major: 2, revision: 1 }, "2.001"],
    [{ major: 2, revision: 9 }, "2.009"],
    [{ major: 2, revision: 10 }, "2.010"],
    [{ major: 2, revision: 100 }, "2.100"],
  ])("formats %o as %s", (version, expected) => {
    expect(formatCustomizerVersion(version)).toBe(expected);
  });

  it("increments minor revisions without changing the major version", () => {
    expect(nextCustomizerVersion({ major: 2, revision: 0 }, "minor")).toEqual({ major: 2, revision: 1 });
    expect(nextCustomizerVersion({ major: 2, revision: 1 }, "minor")).toEqual({ major: 2, revision: 2 });
  });

  it("increments the major version and resets its revision", () => {
    expect(nextCustomizerVersion({ major: 2, revision: 18 }, "major")).toEqual({ major: 3, revision: 0 });
    expect(nextCustomizerVersion({ major: 3, revision: 0 }, "minor")).toEqual({ major: 3, revision: 1 });
  });

  it("keeps draft saves separate from publication numbering", () => {
    const store = readFileSync(path.join(process.cwd(), "lib/customizer/store.ts"), "utf8");
    expect(store).not.toContain("shouldBumpTemplateVersion");
    expect(store).toContain("next.version = Number(existing.version || 1)");
  });

  it("serializes immutable publications and preserves the internal sequence", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20260726120000_customizer_public_versioning.sql"),
      "utf8",
    );
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("next_internal_version");
    expect(migration).toContain("prevent_customizer_version_mutation");
    expect(migration).toContain("Published customizer versions are immutable");
    expect(migration).toContain("uq_customizer_template_public_version");
  });
});
