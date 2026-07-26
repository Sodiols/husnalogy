import { expect, test } from "@playwright/test";
import { adminCredentials, customerCredentials, login, requireSeededAcceptance, seedManifest } from "./helpers";

const adminProductUrl = process.env.E2E_ADMIN_PRODUCT_URL || seedManifest.adminProductUrl || "";
const customizationAId = process.env.E2E_CUSTOMIZATION_A_ID || seedManifest.customizationAId || "";
const customerBEmail = process.env.E2E_CUSTOMER_B_EMAIL || seedManifest.customerBEmail || "";
const customerBPassword = process.env.E2E_CUSTOMER_B_PASSWORD || seedManifest.password || "";
requireSeededAcceptance([
  ["E2E_ADMIN_PRODUCT_URL", adminProductUrl], ["admin email", adminCredentials.email], ["admin password", adminCredentials.password],
  ["Customer A customization", customizationAId], ["Customer B email", customerBEmail], ["Customer B password", customerBPassword],
  ["Customer A email", customerCredentials.email], ["Customer A password", customerCredentials.password],
]);

test("administrator creates V2 objects, groups, guides, preflights and publishes", async ({ page }) => {
  await login(page, adminCredentials.email, adminCredentials.password, adminProductUrl);
  await page.goto(adminProductUrl);
  const open = page.getByRole("button", { name: /Open Design Studio/i });
  if (await open.count()) await open.click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: "4 photos" }).click();
  const canvasLayers = page.locator('[data-canvas-layer]');
  const count = await canvasLayers.count();
  await canvasLayers.nth(count - 2).click();
  await canvasLayers.nth(count - 1).click({ modifiers: ["Control"] });
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await page.getByRole("button", { name: "Guide", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: "horizontal" }).click();
  const editable = page.getByLabel("Customer editable").first();
  if (await editable.count()) await editable.check();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Publish|Update Published/ }).click();
  await expect(page.getByRole("dialog", { name: "Publish checks" })).toBeVisible();
  const confirm = page.getByRole("dialog").getByRole("button", { name: /Publish anyway|Publish|Update Published/ }).last();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText(/Published as version|Saved/i).first()).toBeVisible({ timeout: 30_000 });
});

test("Customer B cannot access Customer A customization or render it", async ({ page }) => {
  await login(page, customerBEmail, customerBPassword);
  const read = await page.request.get(`/api/customizations/${encodeURIComponent(customizationAId)}`);
  expect([403, 404]).toContain(read.status());
  const render = await page.request.post("/api/customizer/render", { data: { customizationId: customizationAId, jobType: "preview" } });
  expect([403, 404]).toContain(render.status());
  const assetResolve = await page.request.post("/api/customizer/assets/resolve", { data: { references: [seedManifest.customerAssetReference], variant: "original" } });
  expect([403, 404]).toContain(assetResolve.status());
});

test("trusted customization produces protected PNG output", async ({ page }) => {
  const customizationId = process.env.E2E_RENDER_CUSTOMIZATION_ID || customizationAId;
  await login(page, customerCredentials.email, customerCredentials.password);
  const response = await page.request.post("/api/customizer/render", { data: { customizationId, jobType: "preview" }, timeout: 90_000 });
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(payload.outputs[0].format).toBe("png");
  expect(payload.outputs[0].watermarked).toBe(true);
  expect(payload.outputs[0].widthPx).toBeGreaterThan(0);
  expect(payload.outputs[0].heightPx).toBeGreaterThan(0);
});

test("administrator produces QR-backed print PNG and PDF outputs", async ({ page }) => {
  await login(page, adminCredentials.email, adminCredentials.password);
  const png = await page.request.post("/api/customizer/render", { data: { customizationId: customizationAId, jobType: "print_png" }, timeout: 90_000 });
  expect(png.ok()).toBe(true);
  const pngPayload = await png.json();
  expect(pngPayload.outputs.length).toBeGreaterThanOrEqual(2);
  expect(pngPayload.outputs.every((output: any) => output.format === "png" && output.watermarked === false && output.checksum)).toBe(true);

  const pdf = await page.request.post("/api/customizer/render", { data: { customizationId: customizationAId, jobType: "print_pdf" }, timeout: 90_000 });
  expect(pdf.ok()).toBe(true);
  const pdfPayload = await pdf.json();
  expect(pdfPayload.outputs).toHaveLength(1);
  expect(pdfPayload.outputs[0].format).toBe("pdf");
  expect(pdfPayload.outputs[0].checksum).toBeTruthy();
});

test("customer cannot invoke unwatermarked print production", async ({ page }) => {
  await login(page, customerCredentials.email, customerCredentials.password);
  const response = await page.request.post("/api/customizer/render", { data: { customizationId: customizationAId, jobType: "print_pdf" } });
  expect(response.status()).toBe(403);
});

test("trusted customization produces cached WebP perspective mockups", async ({ page }) => {
  await login(page, customerCredentials.email, customerCredentials.password);
  const first = await page.request.post("/api/customizer/render", { data: { customizationId: customizationAId, jobType: "mockup" }, timeout: 90_000 });
  expect(first.ok()).toBe(true);
  const firstPayload = await first.json();
  expect(firstPayload.outputs.length).toBeGreaterThanOrEqual(2);
  expect(firstPayload.outputs.every((output: any) => output.format === "webp")).toBe(true);
  expect(firstPayload.outputs.every((output: any) => output.checksum && output.inputHash && output.bucket && output.path)).toBe(true);

  const second = await page.request.post("/api/customizer/render", { data: { customizationId: customizationAId, jobType: "mockup" }, timeout: 90_000 });
  expect(second.ok()).toBe(true);
  const secondPayload = await second.json();
  expect(secondPayload.jobId).toBe(firstPayload.jobId);
});

test("admin normalized mockup API exposes the published multi-view scene", async ({ page }) => {
  await login(page, adminCredentials.email, adminCredentials.password);
  const response = await page.request.get(`/api/admin/customizer/mockups/${encodeURIComponent(seedManifest.productId)}`);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.mockup.status).toBe("published");
  expect(payload.mockup.views).toHaveLength(2);
  expect(payload.mockup.views[0].artworkAreas[0].warpType).toBe("perspective");
});
