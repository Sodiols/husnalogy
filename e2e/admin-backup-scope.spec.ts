/**
 * The admin Backup panel never presents a catalogue export as a full backup
 * (Phase 13). The export that holds settings + products is named for what it
 * is, and the panel says plainly that disaster recovery is the Supabase
 * database and Storage backups.
 */
import { expect, test } from "@playwright/test";

test("the catalogue export is labelled as a catalogue export, not a full backup", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Settings");
  await page.getByRole("tab", { name: /^Backup/ }).first().click();
  await expect(page.getByRole("button", { name: "Export Catalogue Backup" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Export Full Backup")).toHaveCount(0);
  await expect(page.locator("[data-backup-scope-note]")).toContainText("not a disaster-recovery backup");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Catalogue Backup" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^catalogue-backup/);
  const content = JSON.parse(await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8")));
  expect(Object.keys(content).sort()).toEqual(["products", "settings"]);
});
