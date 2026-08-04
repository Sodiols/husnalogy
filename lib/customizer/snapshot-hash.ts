// Order design snapshot integrity hashing.
//
// Kept in its own dependency-free module because both the snapshot builder
// (lib/customizer/order-snapshots.ts) and the render queue
// (lib/customizer/render-jobs.ts) need it, and those two already reference
// each other — importing the hash from either would create an import cycle.

import { createHash } from "crypto";

export function computeIntegrityHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// Verify a stored snapshot still hashes to its recorded integrity hash
// (spec §32). Used by the admin snapshot viewer and the production renderer.
export function verifySnapshotIntegrity(row: {
  snapshot: unknown;
  integrity_hash?: string | null;
  integrityHash?: string | null;
}): { ok: boolean; expected: string; actual: string } {
  const expected = String(row.integrity_hash ?? row.integrityHash ?? "");
  const actual = computeIntegrityHash(row.snapshot);
  return { ok: Boolean(expected) && expected === actual, expected, actual };
}
