/**
 * Two editors, one draft: a save made against an older draft revision is
 * refused instead of silently replacing work it never saw.
 *
 * Runs the real store against the real schema (PGlite with schema.sql and every
 * migration), including the real `updated_at` trigger the revision relies on.
 * Nothing here touches a Supabase project.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => holder.client,
  createClient: async () => holder.client,
}));

import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { createCustomizerTestClient } from "@/lib/testing/pglite-customizer-client";
import { getCustomizerTemplateByProductId, saveCustomizerTemplate } from "@/lib/customizer/store";
import { DraftConflictError, parseExpectedDraftRevision } from "@/lib/customizer/draft-revision";

const PRODUCT = "product-draft-conflict";

let t: TestDatabase;
let baseClient: any;
// When set, runs once just before the next UPDATE reaches the database:
// another editor's save landing between the store's check and its write.
let interleave: (() => Promise<void>) | null = null;

const templateWithTitle = (title: string, base: any = {}) => ({
  ...base,
  enabled: true,
  layers: [{ id: "title", type: "text", page: "front", text: title, x: 100, y: 100, width: 600, height: 80 }],
});
const storedTitle = async () => (await getCustomizerTemplateByProductId(PRODUCT))?.layers?.find((layer: any) => layer.id === "title")?.text;

beforeAll(async () => {
  t = await createTestDatabase();
  await t.db.query(
    `insert into public.products (id, slug, title, status, visibility, price, data)
     values ($1, 'draft-conflict-card', 'Draft Conflict Card', 'draft', 'public', 10, '{}'::jsonb)`,
    [PRODUCT],
  );
  baseClient = createCustomizerTestClient(t).client;
  holder.client = {
    ...baseClient,
    from(table: string) {
      const builder = baseClient.from(table);
      const update = builder.update;
      builder.update = (value: any) => {
        update(value);
        const then = builder.then;
        builder.then = async (resolve: any, reject: any) => {
          const hook = interleave;
          interleave = null;
          if (hook) await hook();
          return then.call(builder, resolve, reject);
        };
        return builder;
      };
      return builder;
    },
  };
}, 120_000);

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  interleave = null;
  await t.db.query("delete from public.product_customizer_templates where product_id = $1", [PRODUCT]);
});

describe("draft saves are pinned to the revision the editor last saw", () => {
  it("refuses a second tab's stale save and keeps the first tab's work", async () => {
    const opened = await saveCustomizerTemplate(PRODUCT, templateWithTitle("Original"));
    // Both tabs open the same draft revision.
    const seenByA = opened!.updatedAt;
    const seenByB = opened!.updatedAt;

    const savedByA = await saveCustomizerTemplate(PRODUCT, templateWithTitle("Tab A edit", opened), { expectedUpdatedAt: seenByA });
    expect(savedByA!.updatedAt).not.toBe(seenByA);

    await expect(
      saveCustomizerTemplate(PRODUCT, templateWithTitle("Tab B edit", opened), { expectedUpdatedAt: seenByB }),
    ).rejects.toBeInstanceOf(DraftConflictError);
    expect(await storedTitle()).toBe("Tab A edit");
  });

  it("lets the same editor keep saving with the revision each save returns", async () => {
    let current = await saveCustomizerTemplate(PRODUCT, templateWithTitle("v1"));
    for (const title of ["v2", "v3", "v4"]) {
      current = await saveCustomizerTemplate(PRODUCT, templateWithTitle(title, current), { expectedUpdatedAt: current!.updatedAt });
    }
    expect(await storedTitle()).toBe("v4");
  });

  it("catches a save that lands between the check and the write (compare-and-swap)", async () => {
    const opened = await saveCustomizerTemplate(PRODUCT, templateWithTitle("Original"));
    interleave = async () => {
      await t.db.query(
        `update public.product_customizer_templates
            set layers = jsonb_set(layers, '{0,text}', '"Other editor"')
          where product_id = $1`,
        [PRODUCT],
      );
    };
    await expect(
      saveCustomizerTemplate(PRODUCT, templateWithTitle("Mine", opened), { expectedUpdatedAt: opened!.updatedAt }),
    ).rejects.toBeInstanceOf(DraftConflictError);
    expect(await storedTitle()).toBe("Other editor");
  });

  it("replaces the other version only when the editor chose to (no expected revision)", async () => {
    const opened = await saveCustomizerTemplate(PRODUCT, templateWithTitle("Original"));
    await saveCustomizerTemplate(PRODUCT, templateWithTitle("Theirs", opened), { expectedUpdatedAt: opened!.updatedAt });
    await saveCustomizerTemplate(PRODUCT, templateWithTitle("Mine", opened));
    expect(await storedTitle()).toBe("Mine");
  });

  it("creates a missing draft even when a revision is sent", async () => {
    const created = await saveCustomizerTemplate(PRODUCT, templateWithTitle("New"), { expectedUpdatedAt: "2026-10-01T00:00:00.000000+00:00" });
    expect(created!.updatedAt).toBeTruthy();
    expect(await storedTitle()).toBe("New");
  });
});

describe("parseExpectedDraftRevision", () => {
  it("accepts only timestamp strings", () => {
    expect(parseExpectedDraftRevision("2026-10-09T13:42:58.123456+00:00")).toBe("2026-10-09T13:42:58.123456+00:00");
    expect(parseExpectedDraftRevision("not a date")).toBeNull();
    expect(parseExpectedDraftRevision(12345)).toBeNull();
    expect(parseExpectedDraftRevision("")).toBeNull();
    expect(parseExpectedDraftRevision(undefined)).toBeNull();
  });
});
