import { describe, expect, it } from "vitest";
import { evaluateCustomizerFeatureFlags, type CustomizerFeatureFlagRow } from "../feature-flags.server";

const row = (patch: Partial<CustomizerFeatureFlagRow>): CustomizerFeatureFlagRow => ({
  flag: "customizer_v2",
  scope: "global",
  scope_key: "*",
  enabled: true,
  rollout_percentage: 100,
  environments: ["test"],
  ...patch,
});

describe("database feature flag evaluation", () => {
  it("prefers product over product type and global scope", () => {
    const flags = evaluateCustomizerFeatureFlags([
      row({ flag: "customizer_v2_mockups", scope: "global", enabled: false }),
      row({ flag: "customizer_v2_mockups", scope: "product_type", scope_key: "card", product_type: "card", enabled: false }),
      row({ flag: "customizer_v2_mockups", scope: "product", scope_key: "p1", product_id: "p1", enabled: true }),
    ], { productId: "p1", productType: "card", actorId: "a", environment: "test" });
    expect(flags.customizer_v2_mockups).toBe(true);
  });

  it("enforces environment and admin-only rules", () => {
    const rows = [
      row({ flag: "customizer_v2_grids", admin_only: true }),
      row({ flag: "customizer_v2_print_pdf", environments: ["production"] }),
    ];
    const customer = evaluateCustomizerFeatureFlags(rows, { environment: "test" });
    expect(customer.customizer_v2_grids).toBe(false);
    expect(customer.customizer_v2_print_pdf).toBe(false);
    const admin = evaluateCustomizerFeatureFlags(rows, { environment: "test", isAdmin: true });
    expect(admin.customizer_v2_grids).toBe(true);
  });

  it("keeps percentage rollout deterministic for the same actor and product", () => {
    const rows = [row({ flag: "customizer_v2_groups", rollout_percentage: 50 })];
    const first = evaluateCustomizerFeatureFlags(rows, { environment: "test", actorId: "actor", productId: "product" });
    const second = evaluateCustomizerFeatureFlags(rows, { environment: "test", actorId: "actor", productId: "product" });
    expect(second.customizer_v2_groups).toBe(first.customizer_v2_groups);
  });
});
