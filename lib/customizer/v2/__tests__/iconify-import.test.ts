import { describe, expect, it, vi } from "vitest";
import { AssetIngestError, prepareAsset, storeAsset } from "../../server/asset-ingest";
import {
  applyElementAssetVerdict,
  collectElementAssetIds,
  verifyElementAssets,
} from "../../server/element-assets";

const SAFE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#303839" d="M12 21S4 13.6 4 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8 2.8C20 13.6 12 21 12 21Z"/></svg>`;
const MULTICOLOUR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff0000" d="M0 0h4v4H0z"/><path fill="#00ff00" d="M6 6h4v4H6z"/></svg>`;

const svgSource = (svg: string) => ({ buffer: Buffer.from(svg, "utf8"), mime: "image/svg+xml", filename: "mdi-heart.svg" });

/* ------------------------------------------------------------- sanitation */

describe("imported SVG passes through the existing sanitizer", () => {
  it("accepts a clean icon and records real dimensions", async () => {
    const prepared = await prepareAsset(svgSource(SAFE_SVG));
    expect(prepared.mime).toBe("image/svg+xml");
    expect(prepared.variants.width).toBeGreaterThan(0);
    expect(prepared.variants.height).toBeGreaterThan(0);
    expect(prepared.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects a single-colour icon as tintable and a multicolour one as not", async () => {
    expect((await prepareAsset(svgSource(SAFE_SVG))).tintable).toBe(true);
    expect((await prepareAsset(svgSource(MULTICOLOUR_SVG))).tintable).toBe(false);
  });

  it("preserves the source aspect ratio rather than forcing a square", async () => {
    const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 12"><path fill="#000" d="M0 0h48v12H0z"/></svg>`;
    const prepared = await prepareAsset(svgSource(wide));
    expect(prepared.variants.width / prepared.variants.height).toBeCloseTo(4, 1);
  });

  it.each([
    ["a script tag", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`],
    ["an event handler", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>`],
    ["a foreignObject", `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><b>x</b></foreignObject></svg>`],
    ["an external image", `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>`],
    ["an external css url", `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css)</style></svg>`],
    ["an XML entity", `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&xxe;</svg>`],
    ["a javascript href", `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>`],
    ["markup that is not SVG at all", `<html><body>nope</body></html>`],
  ])("rejects %s", async (_label, svg) => {
    await expect(prepareAsset(svgSource(svg))).rejects.toBeInstanceOf(AssetIngestError);
  });

  it("sanitizes BEFORE storage, so stored bytes are the sanitized document", async () => {
    const withComment = `<!-- secret --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M0 0h24v24H0z"/></svg>`;
    const prepared = await prepareAsset(svgSource(withComment));
    expect(prepared.buffer.toString("utf8")).not.toContain("secret");
  });
});

/* -------------------------------------------------------- concurrent import */

function fakeSupabase(overrides: Record<string, any> = {}) {
  const uploaded: string[] = [];
  const removed: string[] = [];
  return {
    uploaded,
    removed,
    storage: {
      from: () => ({
        upload: async (path: string) => {
          if (overrides.uploadFails) return { error: { message: "storage down" } };
          uploaded.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => { removed.push(...paths); return { error: null }; },
      }),
    },
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => (overrides.insertError
            ? { data: null, error: overrides.insertError }
            : { data: { id: "asset-1", bucket: "customizer-elements", path: "p", editor_path: "e", thumbnail_path: "t" }, error: null }),
        }),
      }),
      select: () => ({
        eq: function () { return this; },
        in: function () { return this; },
        order: function () { return this; },
        limit: function () { return this; },
        maybeSingle: async () => ({ data: overrides.existingRow || null, error: null }),
      }),
    }),
  } as any;
}

describe("storage and rollback", () => {
  const options = {
    title: "Heart", assetType: "svg", customerAvailable: true, adminAvailable: true,
    provenance: { provider: "iconify", key: "mdi:heart", collection: "mdi", license: "MIT", licenseUrl: "", licenseSpdx: "MIT", author: "" },
  };

  it("uploads original + editor + thumbnail then records the asset", async () => {
    const supabase = fakeSupabase();
    const prepared = await prepareAsset(svgSource(SAFE_SVG));
    const { row } = await storeAsset(supabase, prepared, svgSource(SAFE_SVG), options);
    expect(row.id).toBe("asset-1");
    expect(supabase.uploaded).toHaveLength(3);
    expect(supabase.removed).toHaveLength(0);
  });

  it("rolls back uploaded files when the database insert fails", async () => {
    const supabase = fakeSupabase({ insertError: { message: "db down" } });
    const prepared = await prepareAsset(svgSource(SAFE_SVG));
    await expect(storeAsset(supabase, prepared, svgSource(SAFE_SVG), options)).rejects.toBeInstanceOf(AssetIngestError);
    // Every uploaded object is removed — no orphans.
    expect(supabase.removed).toHaveLength(3);
  });

  it("resolves a concurrent duplicate import to the winning record instead of erroring", async () => {
    const winner = { id: "winner-asset", bucket: "customizer-elements", path: "p" };
    const supabase = fakeSupabase({ insertError: { code: "23505", message: "duplicate key" }, existingRow: winner });
    const prepared = await prepareAsset(svgSource(SAFE_SVG));
    const { row } = await storeAsset(supabase, prepared, svgSource(SAFE_SVG), options);
    expect(row.id).toBe("winner-asset");
    // The losing upload is still cleaned up.
    expect(supabase.removed).toHaveLength(3);
  });

  it("surfaces a storage failure as an ingest error", async () => {
    const supabase = fakeSupabase({ uploadFails: true });
    const prepared = await prepareAsset(svgSource(SAFE_SVG));
    await expect(storeAsset(supabase, prepared, svgSource(SAFE_SVG), options)).rejects.toBeInstanceOf(AssetIngestError);
  });
});

/* ------------------------------------------------- trusted asset resolution */

function assetSupabase(rows: any[]) {
  return {
    from: () => ({
      select: () => ({ in: async () => ({ data: rows, error: null }) }),
    }),
  } as any;
}

const READY = { id: "11111111-1111-4111-8111-111111111111", status: "ready", active: true, archived: false, customer_available: true };
const ADMIN_ONLY = { id: "22222222-2222-4222-8222-222222222222", status: "ready", active: true, archived: false, customer_available: false };
const ARCHIVED = { id: "33333333-3333-4333-8333-333333333333", status: "archived", active: true, archived: true, customer_available: true };

describe("element layers resolve against customizer_assets, never client src", () => {
  it("collects element assetIds from the editor state", () => {
    const editorState = {
      userLayers: [
        { type: "element", assetId: READY.id },
        { type: "text", text: "hi" },
        { type: "element", assetId: READY.id },
        { type: "element", assetId: ADMIN_ONLY.id },
      ],
    };
    expect(collectElementAssetIds(editorState).sort()).toEqual([READY.id, ADMIN_ONLY.id].sort());
  });

  it("allows a ready, customer-available asset", async () => {
    const verdict = await verifyElementAssets([READY.id], { supabase: assetSupabase([READY]) });
    expect(verdict.allowed.has(READY.id)).toBe(true);
    expect(verdict.rejected.size).toBe(0);
  });

  it("rejects an admin-only asset for customer use", async () => {
    const verdict = await verifyElementAssets([ADMIN_ONLY.id], { supabase: assetSupabase([ADMIN_ONLY]) });
    expect(verdict.allowed.size).toBe(0);
    expect(verdict.rejected.has(ADMIN_ONLY.id)).toBe(true);
  });

  it("rejects an archived asset", async () => {
    const verdict = await verifyElementAssets([ARCHIVED.id], { supabase: assetSupabase([ARCHIVED]) });
    expect(verdict.rejected.has(ARCHIVED.id)).toBe(true);
  });

  it("rejects a forged UUID that resolves to no row", async () => {
    const forged = "99999999-9999-4999-8999-999999999999";
    const verdict = await verifyElementAssets([forged], { supabase: assetSupabase([]) });
    expect(verdict.rejected.has(forged)).toBe(true);
  });

  it.each([
    ["a non-UUID string", "not-a-uuid"],
    ["a path", "../../etc/passwd"],
    ["an external URL", "https://evil.example/image.svg"],
    ["SQL-ish input", "' OR 1=1--"],
    ["empty", ""],
  ])("rejects %s without querying the database", async (_label, forged) => {
    const select = vi.fn();
    const verdict = await verifyElementAssets([forged], { supabase: { from: select } as any });
    expect(verdict.allowed.size).toBe(0);
    // Malformed ids never reach the database as a filter.
    expect(select).not.toHaveBeenCalled();
  });

  it("fails closed when the asset lookup itself errors", async () => {
    const supabase = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "db down" } }) }) }) } as any;
    const verdict = await verifyElementAssets([READY.id], { supabase });
    expect(verdict.allowed.size).toBe(0);
    expect(verdict.rejected.has(READY.id)).toBe(true);
  });

  it("drops unverifiable element layers and keeps everything else", () => {
    const editorState = {
      userLayers: [
        { type: "element", assetId: READY.id, src: "https://signed.example/a.svg" },
        { type: "element", assetId: "forged", src: "https://evil.example/x.svg" },
        { type: "text", text: "keep me" },
      ],
    };
    const verdict = { allowed: new Set([READY.id]), rejected: new Set(["forged"]) };
    const { editorState: next, removed } = applyElementAssetVerdict(editorState, verdict);
    expect(next.userLayers).toHaveLength(2);
    expect(next.userLayers.some((l: any) => l.type === "text")).toBe(true);
    expect(removed).toEqual(["forged"]);
  });

  it("strips client display URLs from surviving element layers", () => {
    const editorState = {
      userLayers: [{
        type: "element",
        assetId: READY.id,
        src: "https://evil.example/x.svg",
        url: "https://evil.example/x.svg",
        originalUrl: "https://evil.example/x.svg",
        thumbnailUrl: "https://evil.example/x.svg",
        expiresAt: "2030-01-01",
        width: 100,
      }],
    };
    const verdict = { allowed: new Set([READY.id]), rejected: new Set<string>() };
    const layer = applyElementAssetVerdict(editorState, verdict).editorState.userLayers[0];

    // assetId is the authority; the browser's URLs never persist.
    expect(layer.assetId).toBe(READY.id);
    expect(layer.src).toBeUndefined();
    expect(layer.url).toBeUndefined();
    expect(layer.originalUrl).toBeUndefined();
    expect(layer.thumbnailUrl).toBeUndefined();
    expect(layer.expiresAt).toBeUndefined();
    // Genuine layer geometry survives.
    expect(layer.width).toBe(100);
  });
});
