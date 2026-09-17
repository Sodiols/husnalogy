// Regression coverage for server-side failure reporting.
//
// `console.error("context:", error)` logged `{}` for the one failure that
// actually happened in production — a missing SUPABASE_SERVICE_ROLE_KEY in the
// root layout. `message`, `name` and `stack` are NON-ENUMERABLE on `Error`, and
// Next.js's dev logger serializes console arguments structurally, so the only
// line describing the failure described nothing at all.
//
// The fix is to render the description into the MESSAGE STRING rather than
// passing the object as a second argument, so no downstream serializer can
// flatten it. These tests pin that behaviour for the shapes that actually
// reach this code path.

import { describe, expect, it } from "vitest";

import { describeError } from "@/lib/core/server-errors";

describe("describeError", () => {
  it("renders a plain Error, which used to serialize to {}", () => {
    // The exact failure from the report: the root layout's settings fetch.
    const described = describeError(new Error("SUPABASE_SERVICE_ROLE_KEY is missing."));
    expect(described).toBe("Error: SUPABASE_SERVICE_ROLE_KEY is missing.");
    // Proof of the original defect: an Error carries nothing enumerable.
    expect(Object.keys(new Error("boom"))).toEqual([]);
    expect(JSON.stringify(new Error("boom"))).toBe("{}");
  });

  it("keeps the Postgrest fields that explain a database failure", () => {
    const described = describeError({
      message: "permission denied for table site_settings",
      code: "42501",
      details: "",
      hint: "",
    });
    expect(described).toContain("permission denied for table site_settings");
    expect(described).toContain("code=42501");
  });

  it("surfaces a Next.js digest rather than hiding it", () => {
    const signal: any = new Error("Dynamic server usage");
    signal.digest = "DYNAMIC_SERVER_USAGE";
    expect(describeError(signal)).toContain("digest=DYNAMIC_SERVER_USAGE");
  });

  it("follows the cause chain, which is where a fetch failure hides its reason", () => {
    const described = describeError(
      new Error("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND db.supabase.co") }),
    );
    expect(described).toContain("fetch failed");
    expect(described).toContain("ENOTFOUND");
  });

  it("describes non-Error throws without inventing an Error", () => {
    expect(describeError("just a string")).toBe("just a string");
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
    expect(describeError(42)).toBe("42");
  });

  it("never throws, whatever it is handed", () => {
    // A logger that can fail inside a catch block replaces the original
    // problem with a worse one.
    const circular: any = { name: "Weird" };
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
    expect(() => describeError(Object.create(null))).not.toThrow();
    const hostile = { get message() { throw new Error("nope"); } };
    expect(() => describeError(hostile)).not.toThrow();
  });

  it("stops recursing on a deep cause chain", () => {
    let error = new Error("root");
    for (let index = 0; index < 20; index += 1) error = new Error(`level ${index}`, { cause: error });
    expect(() => describeError(error)).not.toThrow();
  });
});
