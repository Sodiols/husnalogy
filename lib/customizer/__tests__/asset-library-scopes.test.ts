/**
 * The studio's Uploads panel lists only what an admin or designer uploaded.
 *
 * Designer report (2026-10-09): icons and elements placed on a design showed
 * up in Uploads. Placing an Iconify icon imports it into the shared library
 * (`customizer_assets`), and the Uploads panel, the media manager and the
 * studio's Elements panel all listed that whole table unfiltered.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ log: [] as Array<[string, ...unknown[]]> }));
vi.mock("@/lib/auth/roles", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  requireDesignerOrAdmin: async () => ({ ok: true, actor: { id: "admin-1", role: "admin" } }),
}));
vi.mock("@/lib/supabase/server", () => {
  const builder = (table: string): any => {
    const chain: any = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === "then") {
            return (resolve: any) => resolve({ data: [], error: null, count: 0 });
          }
          return (...args: unknown[]) => {
            if (table === "customizer_assets") calls.log.push([method, ...args]);
            return chain;
          };
        },
      },
    );
    return chain;
  };
  return { createServiceRoleClient: () => ({ from: builder }), createClient: async () => ({ from: builder }) };
});
vi.mock("@/lib/customizer/server/admin-assets", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  signAdminAssetRows: async (_supabase: unknown, rows: unknown[]) => rows,
}));

import { ADMIN_ASSET_SCOPES, assetInScope, parseAdminAssetScope } from "@/lib/customizer/asset-scopes";
import { ASSET_THUMB_MAX_PX, buildSvgVariants } from "@/lib/customizer/server/asset-variants";
import { GET } from "@/app/api/admin/customizer/assets/route";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("asset scopes: which pictures each studio panel lists", () => {
  it("Uploads holds the pictures people uploaded, never icons, elements, backgrounds or mockup parts", () => {
    expect(assetInScope({ assetType: "image" }, "uploads")).toBe(true);
    expect(assetInScope({ assetType: "frame" }, "uploads")).toBe(true);
    // An SVG a designer uploaded through Uploads is kept as an image.
    expect(assetInScope({ assetType: "image", sourceProvider: null }, "uploads")).toBe(true);
    // The designer's report: an Iconify icon placed on a design.
    expect(assetInScope({ assetType: "svg", sourceProvider: "iconify" }, "uploads")).toBe(false);
    for (const assetType of ["element", "svg", "background", "mockup", "overlay", "texture", "other"]) {
      expect(assetInScope({ assetType }, "uploads")).toBe(false);
    }
  });

  it("Elements holds the element library, including imported icons, and no uploaded photos", () => {
    expect(assetInScope({ assetType: "element" }, "elements")).toBe(true);
    expect(assetInScope({ assetType: "svg" }, "elements")).toBe(true);
    expect(assetInScope({ assetType: "svg", sourceProvider: "iconify" }, "elements")).toBe(true);
    expect(assetInScope({ assetType: "image" }, "elements")).toBe(false);
    expect(assetInScope({ assetType: "background" }, "elements")).toBe(false);
  });

  it("only known scopes narrow the list", () => {
    expect(parseAdminAssetScope("uploads")).toBe("uploads");
    expect(parseAdminAssetScope("elements")).toBe("elements");
    expect(parseAdminAssetScope("everything")).toBeNull();
    expect(parseAdminAssetScope(null)).toBeNull();
  });
});

describe("GET /api/admin/customizer/assets?scope=…", () => {
  beforeEach(() => {
    calls.log = [];
  });
  const list = (query: string) => GET(new Request(`http://localhost/api/admin/customizer/assets?${query}`));

  it("scope=uploads asks the database for uploaded types without a library source", async () => {
    expect((await list("scope=uploads&page=1&pageSize=24")).status).toBe(200);
    expect(calls.log).toContainEqual(["in", "asset_type", ADMIN_ASSET_SCOPES.uploads.types]);
    expect(calls.log).toContainEqual(["is", "source_provider", null]);
  });

  it("scope=elements asks for element types, imports included", async () => {
    await list("scope=elements");
    expect(calls.log).toContainEqual(["in", "asset_type", ADMIN_ASSET_SCOPES.elements.types]);
    expect(calls.log.some(([method, column]) => method === "is" && column === "source_provider")).toBe(false);
  });

  it("no scope (the Elements Library manager) still lists everything", async () => {
    await list("pageSize=100&includeUnavailable=1");
    expect(calls.log.some(([method, column]) => method === "in" && column === "asset_type")).toBe(false);
    expect(calls.log.some(([method, column]) => method === "is" && column === "source_provider")).toBe(false);
  });
});

describe("the studio panels ask for their own scope", () => {
  it("Uploads and the media manager list uploads; the studio's Elements panel lists elements", () => {
    expect(read("app/admin/dashboard/design-builder/AdminUploadsPanel.tsx")).toContain('scope: "uploads"');
    expect(read("app/admin/dashboard/design-builder/AdminMediaLibrary.tsx")).toContain('scope: "uploads"');
    expect(read("app/components/customizer/CustomerElementsPanel.tsx")).toContain('if (adminMode) query.set("scope", "elements");');
  });
});

describe("SVG thumbnails are sharp at any declared size", () => {
  const heart = (size: number) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`,
    );

  it("a 12 px icon gets a full-size thumbnail, not a 12 px bitmap", async () => {
    const variants = await buildSvgVariants(heart(12));
    expect(Math.max(variants.thumbnailWidth, variants.thumbnailHeight)).toBeGreaterThanOrEqual(ASSET_THUMB_MAX_PX - 2);
    const meta = await sharp(variants.thumbnailBuffer).metadata();
    expect(meta.width).toBe(variants.thumbnailWidth);
    // The vector itself stays the editor variant, at its declared size.
    expect(variants.editorMime).toBe("image/svg+xml");
    expect([variants.width, variants.height]).toEqual([12, 12]);
  });

  it("a large SVG is still capped at the thumbnail size", async () => {
    const variants = await buildSvgVariants(heart(3000));
    expect(Math.max(variants.thumbnailWidth, variants.thumbnailHeight)).toBeLessThanOrEqual(ASSET_THUMB_MAX_PX);
  });
});
