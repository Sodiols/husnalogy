import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

// Uptime monitoring readiness: a fast, public, non-sensitive liveness route.
describe("GET /api/health", () => {
  it("returns 200 with a minimal, non-sensitive body", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ ok: true, status: "healthy" });
  });
});
