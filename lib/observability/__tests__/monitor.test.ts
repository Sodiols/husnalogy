import { afterEach, describe, expect, it } from "vitest";
import { captureError, isMonitoringConfigured, resetMonitorForTests, scrub } from "@/lib/observability/monitor";
import { validateProductionEnv } from "@/lib/env/server-env";

afterEach(() => {
  delete process.env.SENTRY_DSN;
  resetMonitorForTests();
});

describe("error monitoring", () => {
  it("is a no-op without SENTRY_DSN (local development keeps working)", async () => {
    let called = false;
    await captureError(new Error("x"), {}, (async () => {
      called = true;
      return new Response("");
    }) as unknown as typeof fetch);
    expect(isMonitoringConfigured()).toBe(false);
    expect(called).toBe(false);
  });

  it("sends a Sentry envelope with scrubbed content", async () => {
    process.env.SENTRY_DSN = "https://publickey@o1.ingest.sentry.io/42";
    resetMonitorForTests();
    const sent: Array<{ url: string; body: string; auth: string }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>)["X-Sentry-Auth"] });
      return new Response("");
    }) as unknown as typeof fetch;
    await captureError(new Error("checkout failed for ayesha@example.com 01712345678 Bearer abc.def.ghi"), {
      event: "checkout.database_failed",
      extra: { customerEmail: "ayesha@example.com", stage: "transaction", serviceRoleKey: "sb_secret_x", note: "call 01712345678" },
    }, fakeFetch);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    expect(sent[0].auth).toContain("sentry_key=publickey");
    expect(sent[0].body).not.toContain("ayesha@example.com");
    expect(sent[0].body).not.toContain("01712345678");
    expect(sent[0].body).not.toContain("sb_secret_x");
    expect(sent[0].body).not.toContain("abc.def.ghi");
    expect(sent[0].body).toContain("checkout.database_failed");
  });

  it("throttles identical events and never throws when the monitor is down", async () => {
    process.env.SENTRY_DSN = "https://publickey@o1.ingest.sentry.io/42";
    resetMonitorForTests();
    let calls = 0;
    const down = (async () => {
      calls += 1;
      throw new Error("network");
    }) as unknown as typeof fetch;
    await captureError(new Error("same"), { event: "e" }, down);
    await captureError(new Error("same"), { event: "e" }, down);
    expect(calls).toBe(1);
  });

  it("scrubs nested secrets and personal data", () => {
    expect(scrub({ password: "x", nested: { authorization: "y", ok: "value" }, phone: "017" })).toEqual({ password: "[redacted]", nested: { authorization: "[redacted]", ok: "value" }, phone: "[redacted]" });
  });
});

describe("production configuration checks", () => {
  const complete = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_y",
    NEXT_PUBLIC_SITE_URL: "https://husnalogy.com",
    GOOGLE_FONTS_API_KEY: "k",
    CRON_SECRET: "c".repeat(40),
  };

  it("fails when distributed rate limiting is required but not configured", () => {
    expect(validateProductionEnv({ ...complete, REQUIRE_DISTRIBUTED_RATE_LIMIT: "1" }).errors.map((e) => e.variable)).toContain("UPSTASH_REDIS_REST_URL");
    expect(validateProductionEnv(complete).errors).toEqual([]);
    expect(validateProductionEnv(complete).warnings.map((w) => w.variable)).toEqual(expect.arrayContaining(["UPSTASH_REDIS_REST_URL", "RESEND_API_KEY", "SENTRY_DSN"]));
  });

  it("validates email and monitoring settings", () => {
    expect(validateProductionEnv({ ...complete, RESEND_API_KEY: "re_x" }).errors.map((e) => e.variable)).toContain("RESEND_API_KEY");
    expect(validateProductionEnv({ ...complete, SENTRY_DSN: "not-a-dsn" }).errors.map((e) => e.variable)).toContain("SENTRY_DSN");
    expect(validateProductionEnv({ ...complete, ORDER_NOTIFICATION_EMAIL: "nope" }).errors.map((e) => e.variable)).toContain("ORDER_NOTIFICATION_EMAIL");
    expect(validateProductionEnv({ ...complete, NEXT_PUBLIC_RESEND_API_KEY: "re_x", RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.co" }).errors.map((e) => e.variable)).toContain("NEXT_PUBLIC_RESEND_API_KEY");
  });
});
