/**
 * Account data lives in Supabase, owned by the signed-in account (RLS).
 *
 * The old browser-only helpers wrote addresses, the profile and orders to
 * GLOBAL localStorage keys that said nothing about whose data they were, so
 * the next person on a shared browser could see them. They are gone; the keys
 * survive only in the purge list that deletes what an old build left behind.
 * This guard keeps them from coming back.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as customerLists from "@/app/lib/customer-lists";
import { LEGACY_ACCOUNT_STORAGE_KEYS } from "@/app/lib/account-data";

const ROOT = path.resolve(__dirname, "../../..");
const LEGACY_KEYS = ["husnalogy_saved_addresses", "husnalogy_profile", "husnalogy_orders"];
const REMOVED_HELPERS = [
  "subscribeToSavedAddresses",
  "saveCustomerAddress",
  "updateCustomerAddress",
  "setDefaultAddress",
  "removeCustomerAddress",
  "getLocalProfile",
  "saveLocalProfile",
  "subscribeToLocalOrders",
  "saveLocalOrder",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === "__tests__" || name.startsWith(".") ? [] : sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

describe("legacy browser account storage", () => {
  it("customer-lists no longer offers the browser-only address, profile or order helpers", () => {
    for (const name of REMOVED_HELPERS) expect(customerLists, name).not.toHaveProperty(name);
  });

  it("the legacy keys appear only in the purge list — nothing reads or writes them", () => {
    const offenders = ["app", "lib", "components"]
      .map((dir) => path.join(ROOT, dir))
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap(sourceFiles)
      .filter((file) => path.relative(ROOT, file).replace(/\\/g, "/") !== "app/lib/account-data.ts")
      .filter((file) => LEGACY_KEYS.some((key) => readFileSync(file, "utf8").includes(key)))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
    expect([...LEGACY_ACCOUNT_STORAGE_KEYS].sort()).toEqual([...LEGACY_KEYS].sort());
  });
});
