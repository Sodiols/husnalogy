/**
 * The security headers every page is served with (next.config.mjs). Pins the
 * protections that must never be weakened, and records the one known residual
 * item ('unsafe-inline' scripts, see the CSP comment) so a change to it is a
 * deliberate decision.
 */
import { describe, expect, it } from "vitest";

type Header = { key: string; value: string };

async function headersFor(path = "/") {
  const config = (await import("../../../next.config.mjs")) as unknown as { default: { headers: () => Promise<Array<{ source: string; headers: Header[] }>> } };
  const rules = await config.default.headers();
  const all = rules.find((rule) => rule.source === "/:path*");
  expect(all, `a header rule applies to ${path}`).toBeTruthy();
  return Object.fromEntries(all!.headers.map((header) => [header.key, header.value]));
}

describe("security headers on every page", () => {
  it("keep frame, sniffing, transport, referrer, permission and opener protections", async () => {
    const headers = await headersFor();
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=(\d+)/);
    expect(Number(headers["Strict-Transport-Security"].match(/max-age=(\d+)/)![1])).toBeGreaterThanOrEqual(31_536_000);
    expect(headers["Strict-Transport-Security"]).toContain("includeSubDomains");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
    expect(headers["Permissions-Policy"]).toContain("geolocation=()");
    expect(headers["Permissions-Policy"]).toContain("payment=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("the CSP blocks plugins, framing, base/form hijacking and foreign scripts", async () => {
    const csp = (await headersFor())["Content-Security-Policy"];
    const directives = Object.fromEntries(csp.split(";").map((part) => part.trim()).filter(Boolean).map((part) => [part.split(/\s+/)[0], part.split(/\s+/).slice(1)]));
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["frame-src"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'self'"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
    // Scripts come only from this origin (no CDN, no wildcard, no data:).
    expect(directives["script-src"].filter((source) => !source.startsWith("'"))).toEqual([]);
    expect(directives["script-src"]).not.toContain("*");
    expect(directives["script-src"]).not.toContain("data:");
  });

  it("records the residual item: 'unsafe-inline' scripts (no nonces in this release), and no eval outside development", async () => {
    const csp = (await headersFor())["Content-Security-Policy"];
    const scriptSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src "))!;
    expect(scriptSrc).toContain("'unsafe-inline'");
    if (process.env.NODE_ENV !== "development") expect(scriptSrc).not.toContain("'unsafe-eval'");
  });
});
