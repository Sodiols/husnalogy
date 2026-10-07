/**
 * SHARED BROWSER PRIVACY — the customer customizer's local recovery never
 * crosses accounts (Phase 2 of the stabilization brief).
 *
 * Customer A designs a product (private text, a private photo, and edits the
 * server never confirmed), then signs out. Customer B signs in on the SAME
 * browser and opens the SAME product. B must receive none of it: no values,
 * text, photo, crop state, customization id or recovery copy. A, back on the
 * browser, gets their own design again.
 *
 * Runs only against the stub server (no real Supabase can be reached):
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 E2E_FRESH_SERVER=1 E2E_PORT=3105 \
 *     npx playwright test e2e/customer-recovery-isolation.spec.ts --workers=1
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { editorTextarea, openFixture, selectLayer, waitForEditor } from "./customizer-fixture";
import {
  STUB_CUSTOMER,
  STUB_PHOTO_URL,
  StubCustomizationServer,
  signInStubCustomer,
  signOutStubCustomer,
  stubAuthStorageKey,
  stubSession,
  supabaseIsStubbed,
  type StubIdentity,
} from "./customer-stub";

const QUERY = "?autosave=1&snap=0";
const A: StubIdentity = STUB_CUSTOMER;
const B: StubIdentity = { id: "e2e00000-0000-4000-8000-0000000000b2", email: "customer.b@example.test", name: "Customer B" };
const SECRET = "PRIVATE-A-7731";
const UNSYNCED = "UNSYNCED-A-9904";

const canvasText = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-customizer-canvas="main"] text')].map((node) => node.textContent || "").join("\n"));

const canvasImageHrefs = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-customizer-canvas="main"] image')].map((node) => node.getAttribute("href") || ""));

/** Every recovery value in this browser, by key. */
const recoveryEntries = (page: Page) =>
  page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("husnalogy_customizer_draft"))
      .map((key) => ({ key, value: window.localStorage.getItem(key) || "" })),
  );

async function typeInto(page: Page, layerId: string, text: string) {
  await selectLayer(page, layerId);
  await page.getByRole("button", { name: "Edit Text", exact: true }).click();
  await expect(editorTextarea(page)).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
  await page.keyboard.press("Control+Enter");
  await expect(editorTextarea(page)).toHaveCount(0);
}

async function uploadPhoto(page: Page) {
  await page.locator("[data-customizer-root]").getByRole("button", { name: /Photos|Uploads/ }).first().click();
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  await page.locator("[data-customizer-root] input[type='file']").first().setInputFiles({ name: "private.png", mimeType: "image/png", buffer: png });
}

/** What another tab of this browser broadcasts when it signs out / in (Supabase multi-tab sync). */
async function broadcastAuth(context: BrowserContext, event: "SIGNED_OUT" | "SIGNED_IN", identity?: StubIdentity) {
  const other = await context.newPage();
  await other.goto("/api/health");
  await other.evaluate(
    ({ channel, message }) => {
      const bc = new BroadcastChannel(channel);
      bc.postMessage(message);
      bc.close();
    },
    { channel: stubAuthStorageKey(), message: { event, session: identity ? stubSession(identity).session : null } },
  );
  await other.close();
}

test.describe("shared browser: customizer recovery never crosses accounts", () => {
  test.skip(!supabaseIsStubbed, "Needs NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<dead port> on the dev server.");

  let server: StubCustomizationServer;

  test.beforeEach(async ({ context, page }) => {
    server = new StubCustomizationServer({ perAccount: true });
    await server.install(context);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  const writesBy = (owner: string) => server.designWrites().filter((entry) => entry.owner === owner);
  const mentions = (value: unknown, text: string) => JSON.stringify(value ?? "").includes(text);

  test("A signs out, B signs in on the same browser and opens the same product: nothing of A's", async ({ page, context, baseURL }) => {
    const base = baseURL || "http://127.0.0.1:3000";
    await signInStubCustomer(context, base, A);
    await openFixture(page, QUERY);

    await typeInto(page, "fx_free_text", ` ${SECRET}`);
    await uploadPhoto(page);
    await expect.poll(() => server.rows.size, { timeout: 15_000 }).toBe(1);
    await expect.poll(() => JSON.stringify([...server.rows.values()][0]?.values || {}), { timeout: 15_000 }).toContain("customizer/editor-");
    const aDesignId = [...server.rows.values()][0].id;
    await expect(page).toHaveURL(new RegExp(`customizationId=${aDesignId}`));

    // The newest edits never reach the server: they exist ONLY in this browser's recovery copy.
    server.failWrites = { status: 503, remaining: 100_000 };
    await typeInto(page, "fx_free_text", ` ${UNSYNCED}`);
    await expect.poll(async () => (await recoveryEntries(page)).some((entry) => entry.value.includes(UNSYNCED))).toBe(true);
    const aEntries = await recoveryEntries(page);
    expect(aEntries.every((entry) => entry.key.includes(`:user:${A.id}:`)), "A's recovery copy is scoped to A").toBe(true);
    expect(aEntries.some((entry) => /token=|\/object\/sign\//.test(entry.value)), "no signed URL is stored").toBe(false);

    // Same browser, same address (it still names A's design), different account.
    await signOutStubCustomer(context);
    await signInStubCustomer(context, base, B);
    server.failWrites = null;
    await page.goto(page.url());
    await waitForEditor(page);

    const shown = await canvasText(page);
    expect(shown).not.toContain(SECRET);
    expect(shown).not.toContain(UNSYNCED);
    expect(await canvasImageHrefs(page)).not.toContain(STUB_PHOTO_URL);
    expect(page.url(), "A's customization id is dropped from the address").not.toContain(aDesignId);

    // B edits; B's saves are B's own and carry nothing of A's.
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => writesBy(B.id).filter((entry) => entry.status === 200).length, { timeout: 15_000 }).toBeGreaterThan(0);
    // A's page may still flush its queued save while it is being left — after
    // the browser's cookie already belongs to B. Every such request names A as
    // the design's account and is refused before anything is written.
    for (const entry of writesBy(B.id)) {
      const carriesA = mentions(entry.body, SECRET) || mentions(entry.body, UNSYNCED) || entry.id === aDesignId;
      if (!carriesA) continue;
      expect(entry.body.expectedUserId, "a save of A's design must name A's account").toBe(A.id);
      expect(entry.status, `A's design reached B's session and was not refused: ${JSON.stringify({ method: entry.method, id: entry.id })}`).toBe(409);
    }
    expect(writesBy(B.id).some((entry) => entry.status === 200 && !mentions(entry.body, SECRET) && !mentions(entry.body, UNSYNCED))).toBe(true);
    for (const row of server.rows.values()) {
      if (row.ownerId === B.id) expect(JSON.stringify(row)).not.toMatch(new RegExp(`${SECRET}|${UNSYNCED}`));
    }
    expect(server.rows.get(aDesignId)?.ownerId).toBe(A.id);
    for (const entry of await recoveryEntries(page)) {
      if (entry.key.includes(`:user:${B.id}:`)) expect(entry.value).not.toMatch(new RegExp(`${SECRET}|${UNSYNCED}|${aDesignId}`));
    }
    expect(server.log.some((entry) => entry.owner === B.id && entry.method === "GET" && entry.id === aDesignId && entry.status === 200)).toBe(false);

    // A comes back: their own design — including the unsynced edits — is still theirs.
    await signOutStubCustomer(context);
    await signInStubCustomer(context, base, A);
    await page.goto(`/__e2e/customizer${QUERY}`);
    await waitForEditor(page);
    await expect.poll(() => canvasText(page), { timeout: 15_000 }).toContain(UNSYNCED);
    await expect.poll(() => mentions(server.rows.get(aDesignId)?.renderData, UNSYNCED) || mentions(server.rows.get(aDesignId)?.values, UNSYNCED), { timeout: 20_000 }).toBe(true);
  });

  test("in-page: A signs out in another tab while the editor is open, B signs in — the editor clears and writes nothing of A's", async ({ page, context, baseURL }) => {
    const base = baseURL || "http://127.0.0.1:3000";
    await signInStubCustomer(context, base, A);
    await openFixture(page, QUERY);
    await typeInto(page, "fx_free_text", ` ${SECRET}`);
    await expect.poll(() => server.rows.size, { timeout: 15_000 }).toBe(1);
    const aDesignId = [...server.rows.values()][0].id;

    await signOutStubCustomer(context);
    await broadcastAuth(context, "SIGNED_OUT");
    await expect.poll(() => canvasText(page), { timeout: 15_000 }).not.toContain(SECRET);
    expect(page.url()).not.toContain(aDesignId);

    await signInStubCustomer(context, base, B);
    await broadcastAuth(context, "SIGNED_IN", B);
    await expect(page.locator("[data-customizer-restore-overlay]")).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(2500);
    expect(await canvasText(page)).not.toContain(SECRET);

    await selectLayer(page, "fx_shape");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => writesBy(B.id).filter((entry) => entry.status === 200).length, { timeout: 15_000 }).toBeGreaterThan(0);
    for (const entry of writesBy(B.id)) {
      if (mentions(entry.body, SECRET) || entry.id === aDesignId) expect(entry.status).toBe(409);
    }
    for (const row of server.rows.values()) {
      if (row.ownerId === B.id) expect(JSON.stringify(row)).not.toContain(SECRET);
    }
    // Nothing of A's was written as a guest or into B's recovery slot either.
    for (const entry of await recoveryEntries(page)) {
      if (!entry.key.includes(`:user:${A.id}:`)) expect(entry.value).not.toContain(SECRET);
    }
    expect(mentions(server.rows.get(aDesignId)?.renderData, SECRET) || mentions(server.rows.get(aDesignId)?.values, SECRET)).toBe(true);
  });

  test("a guest who signs in from the editor keeps their guest design — and only that account gets it", async ({ page, context, baseURL }) => {
    const base = baseURL || "http://127.0.0.1:3000";
    const GUEST_TEXT = "GUEST-DESIGN-5512";
    await openFixture(page, QUERY);
    await typeInto(page, "fx_free_text", ` ${GUEST_TEXT}`);
    await expect.poll(async () => (await recoveryEntries(page)).some((entry) => entry.key.includes(":guest:") && entry.value.includes(GUEST_TEXT))).toBe(true);

    // Signs in from this editor (in-page auth modal).
    await signInStubCustomer(context, base, A);
    await broadcastAuth(context, "SIGNED_IN", A);
    await expect.poll(() => writesBy(A.id).some((entry) => entry.status === 200 && mentions(entry.body, GUEST_TEXT)), { timeout: 20_000 }).toBe(true);
    expect(await canvasText(page)).toContain(GUEST_TEXT);
    const entries = await recoveryEntries(page);
    expect(entries.some((entry) => entry.key.includes(":guest:") && entry.value.includes(GUEST_TEXT)), "the guest copy moved into the account").toBe(false);

    // Another account on this browser never receives it.
    await signOutStubCustomer(context);
    await signInStubCustomer(context, base, B);
    await page.goto(`/__e2e/customizer${QUERY}`);
    await waitForEditor(page);
    expect(await canvasText(page)).not.toContain(GUEST_TEXT);
  });
});
