import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMIZER_FEATURE_FLAGS } from "../feature-flags";

const root = process.cwd();
const canonical = readFileSync(path.join(root, "supabase", "customizer_v2.sql"), "utf8");
const liveValidator = readFileSync(path.join(root, "scripts", "validate_customizer_database.sql"), "utf8");
const readMigration = (name: string) => readFileSync(path.join(root, "supabase", "migrations", name), "utf8");
const flagConstraintMigrations = [
  "20260714153000_customizer_v2_completion.sql",
  "20260714210000_customizer_v2_production_hardening.sql",
  "20260718120000_customizer_v2_customer_parity.sql",
  "20260719120000_customizer_v2_schema_consolidation.sql",
].map(readMigration);
const hardeningMigration = flagConstraintMigrations[1];
const replayedFlagConstraintMigrations = flagConstraintMigrations.slice(1);
const requiredTables = [
  "product_customizer_templates", "product_customizations", "customizer_template_versions",
  "customizer_asset_categories", "customizer_assets", "customer_asset_library",
  "customizer_mockup_templates", "customizer_mockup_views", "customizer_mockup_artwork_areas",
  "customizer_mockup_overlays", "customizer_guides", "customizer_render_jobs",
  "customizer_render_outputs", "customizer_preflight_results", "order_design_snapshots",
  "customizer_feature_flags", "customizer_audit_logs", "customizer_asset_folders",
];

const permanentAssetMigration = readMigration("20260719180000_permanent_admin_asset_library.sql");

describe("canonical Customizer V2 database contract", () => {
  it("contains every required table and live validation check", () => {
    for (const table of requiredTables) {
      expect(canonical).toMatch(new RegExp(`(?:create table if not exists|alter table)\\s+public\\.${table}\\b`, "i"));
      expect(liveValidator).toContain(`'${table}'`);
    }
  });

  it("keeps the validator read-only and the install surface schema-safe", () => {
    expect(liveValidator).toMatch(/begin\s+transaction\s+read\s+only/i);
    expect(liveValidator).toMatch(/rollback\s*;/i);
    const executable = canonical.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    expect(executable).not.toMatch(/\b(?:drop\s+(?:table|schema)|truncate(?:\s+table)?)\b/i);
  });

  it("allows every runtime feature flag at every constraint migration", () => {
    for (const migration of flagConstraintMigrations) {
      for (const flag of CUSTOMIZER_FEATURE_FLAGS) {
        expect(migration).toContain(`'${flag}'`);
      }
    }
  });

  it("preserves legacy flag rows and makes named hardening constraints replay-safe", () => {
    for (const migration of replayedFlagConstraintMigrations) {
      expect(migration).toMatch(/add constraint customizer_feature_flags_flag_check[\s\S]*?not valid;/i);
      expect(migration).toContain("validate constraint customizer_feature_flags_flag_check");
      expect(migration).toContain("when check_violation then");
    }

    for (const constraint of [
      "customizer_feature_flags_scope_check",
      "customizer_feature_flags_rollout_check",
      "customizer_render_outputs_status_check",
    ]) {
      const dropAt = hardeningMigration.indexOf(`drop constraint if exists ${constraint}`);
      const addAt = hardeningMigration.indexOf(`add constraint ${constraint}`);
      expect(dropAt).toBeGreaterThanOrEqual(0);
      expect(addAt).toBeGreaterThan(dropAt);
    }
  });

  it("keeps administrator assets private, signed on demand, and deletion protected", () => {
    expect(permanentAssetMigration).toContain("public.customizer_assets");
    expect(permanentAssetMigration).toContain("thumbnail_path");
    expect(permanentAssetMigration).toContain("editor_path");
    expect(permanentAssetMigration).toContain("checksum");
    expect(permanentAssetMigration).toContain("customizer_asset_usage");
    expect(permanentAssetMigration).toContain("prevent_used_customizer_asset_delete");
    expect(permanentAssetMigration).toMatch(/'customizer-elements',\s*'customizer-elements',\s*false/i);
    expect(permanentAssetMigration).toMatch(/customizer_assets_read[\s\S]*customer_available/i);
    expect(permanentAssetMigration).toMatch(/customizer_admin_assets_insert[\s\S]*public\.is_admin\(\)/i);
    expect(permanentAssetMigration).toMatch(/customizer_admin_assets_delete[\s\S]*public\.is_admin\(\)/i);
  });
});
