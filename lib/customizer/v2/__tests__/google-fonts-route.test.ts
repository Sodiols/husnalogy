import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleFontFamily } from "../google-fonts";

const mocks = vi.hoisted(() => ({
  getFontCatalog: vi.fn(),
  rateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/customizer/v2/server/google-fonts-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/google-fonts-catalog")>();
  return { ...actual, getFontCatalog: mocks.getFontCatalog };
});

vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: mocks.rateLimit }));

import { GET } from "@/app/api/customizer/fonts/route";

function family(name: string): GoogleFontFamily {
  return {
    family: name,
    category: "sans-serif",
    variants: [
      {
        key: "regular",
        weight: "400",
        style: "normal",
        url: `https://fonts.gstatic.com/s/${encodeURIComponent(name)}/regular.ttf`,
      },
    ],
    weights: ["400"],
    hasItalic: false,
    subsets: ["latin"],
    version: "v1",
    lastModified: "2026-08-24",
  };
}

const largeCatalog = Array.from({ length: 750 }, (_, index) => family(`Fixture Font ${String(index).padStart(3, "0")}`));
largeCatalog[700] = family("Playfair Display");
largeCatalog[701] = family("Montserrat");

async function request(query = "") {
  const response = await GET(new Request(`http://localhost/api/customizer/fonts${query}`));
  return { response, payload: await response.json() };
}

beforeEach(() => {
  mocks.getFontCatalog.mockReset().mockResolvedValue(largeCatalog);
  mocks.rateLimit.mockReset().mockReturnValue(null);
});

describe("GET /api/customizer/fonts", () => {
  it("returns the complete cached catalog when limit is missing", async () => {
    const { response, payload } = await request();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.total).toBe(largeCatalog.length);
    expect(payload.families).toHaveLength(largeCatalog.length);
    expect(payload.families.length).toBeGreaterThan(500);
    expect(mocks.getFontCatalog).toHaveBeenCalledTimes(1);
  });

  it("never interprets a missing limit as one result", async () => {
    const { payload } = await request("?q=");
    expect(payload.families).toHaveLength(largeCatalog.length);
    expect(payload.families).not.toHaveLength(1);
  });

  it.each([
    ["?limit=1", 1],
    ["?limit=10", 10],
  ])("honours an explicit valid limit (%s)", async (query, expected) => {
    const { payload } = await request(query);
    expect(payload.families).toHaveLength(expected);
  });

  it("finds a family positioned outside the first 500 catalog entries", async () => {
    const { payload } = await request("?q=playfair");
    expect(payload.families.map((entry: { family: string }) => entry.family)).toEqual(["Playfair Display"]);
  });

  it("supports partial family search across the complete catalog", async () => {
    const { payload } = await request("?q=mont");
    expect(payload.families.map((entry: { family: string }) => entry.family)).toContain("Montserrat");
  });

  it.each(["abc", "0", "-2", "1.5", "", "999999999999999999999999"])(
    "rejects an invalid limit without throwing (%s)",
    async (value) => {
      const { response, payload } = await request(`?limit=${encodeURIComponent(value)}`);
      expect(response.status).toBe(400);
      expect(payload).toMatchObject({ ok: false, code: "INVALID_LIMIT" });
      expect(mocks.getFontCatalog).not.toHaveBeenCalled();
    },
  );

  it("bounds an extreme but safe limit by the dynamic catalog size", async () => {
    const { payload } = await request("?limit=999999");
    expect(payload.families).toHaveLength(largeCatalog.length);
  });
});
