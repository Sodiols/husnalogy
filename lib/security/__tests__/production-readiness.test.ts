import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { getSafeRedirectPath, resolvePostLoginPath } from "@/lib/auth/redirects";
import { resolveRequestOrigin } from "@/lib/site-url";
import { getRenderWorkerSecrets, validateProductionEnv } from "@/lib/env/server-env";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("one role-aware post-login redirect for every sign-in path", () => {
  it("sends each role to its own workspace by default", () => {
    expect(resolvePostLoginPath("admin", "/")).toBe("/admin/dashboard");
    expect(resolvePostLoginPath("designer", "/")).toBe("/designer");
    expect(resolvePostLoginPath("customer", "/")).toBe("/");
  });

  it("never routes a customer or an unknown role into a workspace", () => {
    expect(resolvePostLoginPath("customer", "/admin/dashboard")).toBe("/");
    expect(resolvePostLoginPath("customer", "/designer")).toBe("/");
    expect(resolvePostLoginPath(null, "/admin")).toBe("/");
    expect(resolvePostLoginPath(null, "/designer")).toBe("/");
  });

  it("never routes a designer into the admin area", () => {
    expect(resolvePostLoginPath("designer", "/admin/dashboard")).toBe("/designer");
    expect(resolvePostLoginPath("designer", "/admin/review")).toBe("/designer");
  });

  it("honours a safe explicit destination the role may open", () => {
    expect(resolvePostLoginPath("customer", "/checkout")).toBe("/checkout");
    expect(resolvePostLoginPath("designer", "/designer?tab=review")).toBe("/designer?tab=review");
    expect(resolvePostLoginPath("admin", "/admin/review")).toBe("/admin/review");
  });

  it("rejects open redirects and auth-page loops", () => {
    expect(getSafeRedirectPath("https://evil.example")).toBe("/");
    expect(getSafeRedirectPath("//evil.example")).toBe("/");
    expect(getSafeRedirectPath("/\\evil.example")).toBe("/");
    expect(getSafeRedirectPath("/login?next=/admin")).toBe("/");
  });

  it("is the resolver used by email/password login, OAuth callback and the proxy", () => {
    expect(read("app/lib/auth.ts")).toContain("resolvePostLoginPath(normalizeRole(profile?.role), next)");
    expect(read("app/auth/callback/route.ts")).toContain("resolvePostLoginPath(normalizeRole(profile?.role), next)");
    expect(read("proxy.js")).toContain("resolvePostLoginPath(role, next)");
    // The old admin-only branch must not come back.
    expect(read("app/lib/auth.ts")).not.toContain('profile?.role === "admin"');
  });
});

describe("production origin resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const request = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it("never redirects to the internal bind address in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://husnalogy.com");
    expect(resolveRequestOrigin(request("http://0.0.0.0:3000/auth/callback"))).toBe("https://husnalogy.com");
    expect(resolveRequestOrigin(request("http://localhost:3000/auth/callback"))).toBe("https://husnalogy.com");
  });

  it("keeps the public host (apex or www) the flow started on", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://husnalogy.com");
    expect(resolveRequestOrigin(request("http://0.0.0.0:3000/x", { "x-forwarded-host": "www.husnalogy.com" }))).toBe("https://www.husnalogy.com");
    expect(resolveRequestOrigin(request("http://0.0.0.0:3000/x", { host: "husnalogy.com" }))).toBe("https://husnalogy.com");
  });

  it("ignores a spoofed Host header in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://husnalogy.com");
    expect(resolveRequestOrigin(request("http://0.0.0.0:3000/x", { "x-forwarded-host": "evil.example" }))).toBe("https://husnalogy.com");
  });
});

describe("production environment validation", () => {
  const secret = "a".repeat(64);
  const complete = {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example",
    NEXT_PUBLIC_SITE_URL: "https://husnalogy.com",
    GOOGLE_FONTS_API_KEY: "fonts-key",
    CRON_SECRET: secret,
  };

  it("accepts a complete production configuration", () => {
    expect(validateProductionEnv(complete).errors).toEqual([]);
  });

  it("names every missing required variable", () => {
    const names = validateProductionEnv({}).errors.map((issue) => issue.variable);
    for (const required of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_SITE_URL",
      "GOOGLE_FONTS_API_KEY",
      "CRON_SECRET",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("rejects a localhost or plain-http site URL", () => {
    expect(validateProductionEnv({ ...complete, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }).errors.length).toBeGreaterThan(0);
    expect(validateProductionEnv({ ...complete, NEXT_PUBLIC_SITE_URL: "http://husnalogy.com" }).errors.length).toBeGreaterThan(0);
  });

  it("rejects secrets published through NEXT_PUBLIC_ variables", () => {
    expect(validateProductionEnv({ ...complete, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "x" }).errors.length).toBeGreaterThan(0);
    expect(validateProductionEnv({ ...complete, NEXT_PUBLIC_COPY: secret }).errors.length).toBeGreaterThan(0);
    expect(validateProductionEnv({ ...complete, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_x" }).errors.length).toBeGreaterThan(0);
  });

  it("requires a strong worker secret and accepts either name", () => {
    expect(validateProductionEnv({ ...complete, CRON_SECRET: "short" }).errors.length).toBeGreaterThan(0);
    expect(validateProductionEnv({ ...complete, CRON_SECRET: "", RENDER_WORKER_SECRET: secret }).errors).toEqual([]);
    expect(getRenderWorkerSecrets({ CRON_SECRET: "a", RENDER_WORKER_SECRET: "b" })).toEqual(["a", "b"]);
  });

  it("does not require Upstash", () => {
    const report = validateProductionEnv(complete);
    expect(report.errors.some((issue) => issue.variable.startsWith("UPSTASH"))).toBe(false);
  });
});

describe("launch configuration", () => {
  it("pins Node 22 LTS for Hostinger", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.engines?.node).toBe("22.x");
    expect(pkg.scripts.start).toBe("next start");
  });

  it("trusts only this project's Supabase host for images and renders", () => {
    const config = read("next.config.mjs");
    expect(config).toContain('hostname: supabaseHost || "*.supabase.co"');
    const render = read("lib/customizer/v2/server/render.ts");
    expect(render).not.toContain("supabase\\.co$/i.test");
    expect(render).toContain('redirect: "error"');
  });

  it("does not report a test email as sent when no provider is connected", () => {
    const route = read("app/api/admin/settings/test-email/route.ts");
    expect(route).toContain("status: 501");
    expect(route).not.toContain("ok: true");
  });

  it("guards profile roles and closes direct order inserts in a forward migration", () => {
    const migration = read("supabase/migrations/20260919120000_production_security_hardening.sql");
    expect(migration).toContain("create trigger protect_profile_role");
    expect(migration).toContain('drop policy if exists "orders_customer_insert_own" on public.orders;');
    expect(migration).not.toMatch(/drop table|truncate|delete from/i);
    // SECURITY DEFINER would make every caller look privileged.
    expect(migration).not.toMatch(/protect_profile_role\(\)[\s\S]{0,80}security definer/i);
  });
});
