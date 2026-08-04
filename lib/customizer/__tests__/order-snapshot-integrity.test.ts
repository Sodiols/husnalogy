// Customized order integrity (spec §4, §6, §7, §32, §43).
//
// These cover the promise that makes personalized orders safe: an order is
// never accepted unless every customized item produced a valid, immutable
// snapshot, and failures surface as typed codes with customer-safe messages
// that leak no internal detail.

import { describe, expect, it } from "vitest";
import {
  computeIntegrityHash,
  isOrderSnapshotError,
  OrderSnapshotError,
  verifySnapshotIntegrity,
  type OrderSnapshotErrorCode,
} from "../order-snapshots";

const ALL_CODES: OrderSnapshotErrorCode[] = [
  "CUSTOMIZATION_NOT_FOUND",
  "CUSTOMIZATION_OWNERSHIP_INVALID",
  "TEMPLATE_VERSION_NOT_FOUND",
  "PRIVATE_ASSET_UNAVAILABLE",
  "PREFLIGHT_BLOCKED",
  "SNAPSHOT_BUILD_FAILED",
  "SNAPSHOT_INSERT_FAILED",
  "ORDER_TRANSACTION_FAILED",
  "RENDER_QUEUE_FAILED",
];

describe("order snapshot failures", () => {
  it("carries a specific code rather than a generic string", () => {
    const error = new OrderSnapshotError("PREFLIGHT_BLOCKED", "Text overflow on layer l1", {
      customizationId: "c1",
    });
    expect(isOrderSnapshotError(error)).toBe(true);
    expect(error.code).toBe("PREFLIGHT_BLOCKED");
    expect(error.customizationId).toBe("c1");
    // The technical detail stays on the server-side fields.
    expect(error.detail).toContain("Text overflow on layer l1");
  });

  it("gives every code a customer-safe message with no internal detail", () => {
    for (const code of ALL_CODES) {
      const error = new OrderSnapshotError(code, "table product_customizations row 4a2f: FK violation on user_id");
      const message = error.customerMessage;

      expect(message.length).toBeGreaterThan(20);
      // No identifiers, schema names, SQL, or stack detail may reach a customer.
      expect(message).not.toContain("product_customizations");
      expect(message).not.toContain("4a2f");
      expect(message).not.toContain("FK violation");
      expect(message).not.toContain(code);
      expect(message).not.toMatch(/undefined|null|\[object/);
    }
  });

  it("prefers the preflight message when it is already customer-facing", () => {
    const error = new OrderSnapshotError("PREFLIGHT_BLOCKED", "TEXT_OVERFLOW", {
      customerMessage: "The names line is too long for the card. Shorten it or reduce the text size.",
    });
    expect(error.customerMessage).toContain("names line is too long");
  });
});

describe("snapshot integrity", () => {
  const snapshot = {
    templateId: "t1",
    templateVersion: 3,
    values: { names: "Aisha\n& Omar" },
    editorState: { layerOverrides: {}, userLayers: [] },
  };

  it("hashes deterministically for the same payload", () => {
    expect(computeIntegrityHash(snapshot)).toBe(computeIntegrityHash({ ...snapshot }));
  });

  it("changes when any part of the frozen design changes", () => {
    const original = computeIntegrityHash(snapshot);
    expect(computeIntegrityHash({ ...snapshot, templateVersion: 4 })).not.toBe(original);
    expect(computeIntegrityHash({ ...snapshot, values: { names: "Aisha & Omar" } })).not.toBe(original);
  });

  it("verifies a stored snapshot against its recorded hash", () => {
    const integrity_hash = computeIntegrityHash(snapshot);
    expect(verifySnapshotIntegrity({ snapshot, integrity_hash }).ok).toBe(true);
  });

  it("fails verification when the stored payload was altered after creation", () => {
    const integrity_hash = computeIntegrityHash(snapshot);
    const tampered = { ...snapshot, values: { names: "Someone Else" } };
    const result = verifySnapshotIntegrity({ snapshot: tampered, integrity_hash });
    expect(result.ok).toBe(false);
    expect(result.actual).not.toBe(result.expected);
  });

  it("fails verification when no hash was recorded at all", () => {
    expect(verifySnapshotIntegrity({ snapshot, integrity_hash: null }).ok).toBe(false);
    expect(verifySnapshotIntegrity({ snapshot, integrity_hash: "" }).ok).toBe(false);
  });

  it("keeps multiline customer text byte-identical through the hash", () => {
    // A line break lost anywhere in the snapshot pipeline would change the
    // hash, so this also guards the §18 persistence requirement.
    const multiline = { ...snapshot, values: { names: "Line one\nLine two\nLine three" } };
    const hash = computeIntegrityHash(multiline);
    const flattened = { ...snapshot, values: { names: "Line one Line two Line three" } };
    expect(computeIntegrityHash(flattened)).not.toBe(hash);
    expect(verifySnapshotIntegrity({ snapshot: multiline, integrity_hash: hash }).ok).toBe(true);
  });
});
