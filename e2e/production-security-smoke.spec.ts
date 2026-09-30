import { test, expect } from "@playwright/test";

test("anonymous clients cannot read production assets or invoke privileged recovery/worker", async ({ request }) => {
  for (const path of ["/api/admin/production/assets?snapshotId=foreign&key=foreign", "/api/admin/production/health", "/api/admin/customizer/render/process"]) {
    expect((await request.get(path)).status()).toBe(401);
  }
  for (const path of ["/api/admin/production/retry", "/api/admin/production/manual-complete", "/api/admin/production/notification-delivery"]) {
    expect((await request.post(path, { data: {} })).status()).toBe(401);
  }
  expect((await request.get("/api/admin/customizer/render/process", { headers: { authorization: "Bearer invalid-worker-secret" } })).status()).toBe(401);
});

test("expired-session logout works through proxy and cross-site logout is refused", async ({ request, baseURL }) => {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || baseURL!;
  expect((await request.post("/api/admin/logout", { headers: { origin }, data: {} })).status()).toBe(200);
  expect((await request.post("/api/admin/logout", { headers: { origin: "https://foreign.example", "sec-fetch-site": "cross-site" }, data: {} })).status()).toBe(403);
});
