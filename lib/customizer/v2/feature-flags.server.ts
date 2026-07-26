import { createHash } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { CUSTOMIZER_FEATURE_FLAGS, type CustomizerFeatureFlag } from "./feature-flags";

export type ResolveFeatureFlagOptions = {
  productId?: string;
  productType?: string;
  actorId?: string;
  isAdmin?: boolean;
  environment?: string;
};

export type CustomizerFeatureFlagRow = {
  flag: CustomizerFeatureFlag;
  scope: "global" | "product_type" | "product";
  scope_key: string;
  product_id?: string | null;
  product_type?: string | null;
  enabled: boolean;
  environments?: string[] | null;
  rollout_percentage?: number | null;
  admin_only?: boolean | null;
};

let cache: { expiresAt: number; rows: CustomizerFeatureFlagRow[] } | null = null;

function rolloutBucket(flag: string, actorId: string, productId: string): number {
  const digest = createHash("sha256").update(`${flag}:${actorId || "anonymous"}:${productId || "global"}`).digest("hex").slice(0, 8);
  return Number.parseInt(digest, 16) % 100;
}

async function loadFlagRows(): Promise<CustomizerFeatureFlagRow[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.rows;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("customizer_feature_flags").select("flag,scope,scope_key,product_id,product_type,enabled,environments,rollout_percentage,admin_only");
  let rows: CustomizerFeatureFlagRow[];
  if (error?.code === "42703") {
    // Rolling deploy compatibility: the previous per-product table remains
    // readable while the hardening migration is being applied.
    const { data: legacy, error: legacyError } = await supabase.from("customizer_feature_flags").select("flag,product_id,enabled");
    if (legacyError) throw legacyError;
    rows = [
      { flag: "customizer_v2", scope: "global", scope_key: "*", enabled: true, rollout_percentage: 100 },
      ...(legacy || []).map((row: any) => ({ ...row, scope: row.product_id ? "product" : "global", scope_key: row.product_id || "*", rollout_percentage: 100 })),
    ] as CustomizerFeatureFlagRow[];
  } else {
    if (error) throw error;
    rows = (data || []) as CustomizerFeatureFlagRow[];
  }
  cache = { rows, expiresAt: Date.now() + 30_000 };
  return rows;
}

export function clearFeatureFlagCache() {
  cache = null;
}

export function evaluateCustomizerFeatureFlags(rows: CustomizerFeatureFlagRow[], options: ResolveFeatureFlagOptions): Record<CustomizerFeatureFlag, boolean> {
  const environment = options.environment || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
  const result = Object.fromEntries(CUSTOMIZER_FEATURE_FLAGS.map((flag) => [flag, false])) as Record<CustomizerFeatureFlag, boolean>;
  for (const flag of CUSTOMIZER_FEATURE_FLAGS) {
    const candidates = rows.filter((row) => row.flag === flag).filter((row) => {
      if (row.scope === "product") return Boolean(options.productId) && (row.scope_key === options.productId || row.product_id === options.productId);
      if (row.scope === "product_type") return Boolean(options.productType) && (row.scope_key === options.productType || row.product_type === options.productType);
      return row.scope === "global";
    });
    const priority = { global: 0, product_type: 1, product: 2 } as const;
    candidates.sort((left, right) => priority[right.scope] - priority[left.scope]);
    const selected = candidates[0];
    if (!selected || !selected.enabled) continue;
    if (selected.admin_only && !options.isAdmin) continue;
    if (selected.environments?.length && !selected.environments.includes(environment)) continue;
    const percentage = Math.max(0, Math.min(100, Number(selected.rollout_percentage ?? 100)));
    if (percentage < 100 && rolloutBucket(flag, options.actorId || "", options.productId || "") >= percentage) continue;
    result[flag] = true;
  }
  return result;
}

export async function resolveCustomizerFeatureFlags(options: ResolveFeatureFlagOptions): Promise<Record<CustomizerFeatureFlag, boolean>> {
  return evaluateCustomizerFeatureFlags(await loadFlagRows(), options);
}

export async function resolveFlagsIntoTemplate(template: any, options: ResolveFeatureFlagOptions): Promise<any> {
  const featureFlags = await resolveCustomizerFeatureFlags(options);
  return { ...template, settings: { ...(template?.settings || {}), featureFlags } };
}
