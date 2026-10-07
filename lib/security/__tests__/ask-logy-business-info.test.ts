/**
 * Ask Logy states Husnalogy's founder from the ONE authoritative value
 * (BUSINESS_INFO.founder) — in its own answers and in the instructions given
 * to the optional model — and keeps Logy (the assistant) a separate entity.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_INFO } from "@/lib/launch-config";

const { POST } = await import("@/app/api/ask-logy/route");

const ask = async (message: string) => {
  const response = await POST(new Request("http://localhost/api/ask-logy", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" }, body: JSON.stringify({ message }) }));
  return String((await response.json()).reply || "");
};

describe("Ask Logy founder answers", () => {
  it("the configured founder is Foyez Ahmed", () => {
    expect(BUSINESS_INFO.founder).toBe("Foyez Ahmed");
  });

  it.each(["Who founded Husnalogy?", "who is the owner of husnalogy", "Who runs Husnalogy?"])("%s → the configured founder", async (question) => {
    const reply = await ask(question);
    expect(reply).toContain(BUSINESS_INFO.founder);
    expect(reply).not.toMatch(/sodiol/i);
  });

  it("questions about Logy itself describe the assistant, not the company founder", async () => {
    const reply = await ask("Who made you?");
    expect(reply).toContain("Logy");
    expect(reply).not.toContain(BUSINESS_INFO.founder);
  });

  it("the model instructions interpolate the central value and hardcode no founder name", () => {
    const source = readFileSync(join(process.cwd(), "app/api/ask-logy/route.ts"), "utf8");
    expect(source).toContain("Husnalogy was founded by ${BUSINESS_INFO.founder}.");
    expect(source).not.toMatch(/founded by (?!\$\{BUSINESS_INFO\.founder\})[A-Z][a-z]+/);
  });
});

describe("one authoritative founder value across customer-facing code", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) return [];
      return statSync(path).isDirectory() ? files(path) : /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
    });

  it("no other source file spells out a founder name", () => {
    const offenders = [...files(join(process.cwd(), "app")), ...files(join(process.cwd(), "lib"))]
      .filter((path) => !path.endsWith(join("lib", "launch-config.ts")))
      .filter((path) => /Foyez|Sodiol/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
