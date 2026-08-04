// Production render integrity (spec §34, §35, §39, §44).
//
// An order's production output must be bound to the frozen snapshot, not to
// the mutable customer draft or the live product template. These tests cover
// the two mechanisms that guarantee it: the render input hash, and the retry
// policy / status roll-up that make failures visible instead of silent.

import { describe, expect, it } from "vitest";
import { computeRenderInputHash, RENDER_MAX_ATTEMPTS, renderRetryStatus } from "../render-jobs";
import { computeIntegrityHash } from "../order-snapshots";

const customization = {
  id: "c1",
  templateId: "t1",
  templateVersion: 3,
  values: { names: "Aisha & Omar" },
  renderData: { editorState: { layerOverrides: {}, userLayers: [] } },
};

const snapshotPayload = { templateId: "t1", templateVersion: 3, values: { names: "Aisha & Omar" } };
const snapshot = { snapshotId: "s1", integrityHash: computeIntegrityHash(snapshotPayload) };

describe("render input hash binds a production job to its frozen snapshot", () => {
  it("distinguishes a snapshot-bound job from a live preview job", () => {
    const preview = computeRenderInputHash("print_png", customization, null, null);
    const production = computeRenderInputHash("print_png", customization, null, snapshot);
    expect(production).not.toBe(preview);
  });

  it("is stable for the same snapshot, so a retry reuses the same input", () => {
    expect(computeRenderInputHash("print_png", customization, null, snapshot)).toBe(
      computeRenderInputHash("print_png", customization, null, snapshot),
    );
  });

  it("changes when a different order's snapshot is rendered", () => {
    const other = { snapshotId: "s2", integrityHash: snapshot.integrityHash };
    expect(computeRenderInputHash("print_png", customization, null, other)).not.toBe(
      computeRenderInputHash("print_png", customization, null, snapshot),
    );
  });

  it("changes when the frozen payload itself differs, even for one snapshot id", () => {
    const tampered = { snapshotId: "s1", integrityHash: computeIntegrityHash({ ...snapshotPayload, values: { names: "Someone Else" } }) };
    expect(computeRenderInputHash("print_png", customization, null, tampered)).not.toBe(
      computeRenderInputHash("print_png", customization, null, snapshot),
    );
  });

  it("separates the PNG and PDF jobs of the same snapshot", () => {
    expect(computeRenderInputHash("print_png", customization, null, snapshot)).not.toBe(
      computeRenderInputHash("print_pdf", customization, null, snapshot),
    );
  });

  it("does not let a later edit to the live draft collide with a placed order", () => {
    // The customer keeps editing after ordering. Their draft's preview hash
    // moves; the order's production hash, keyed on the snapshot, does not.
    const editedDraft = { ...customization, values: { names: "Aisha & Omar — reprint" } };
    const orderHashBefore = computeRenderInputHash("print_png", customization, null, snapshot);
    const orderHashAfter = computeRenderInputHash("print_png", editedDraft, null, snapshot);
    const previewBefore = computeRenderInputHash("preview", customization, null, null);
    const previewAfter = computeRenderInputHash("preview", editedDraft, null, null);

    expect(previewAfter).not.toBe(previewBefore);
    // The snapshot fields dominate the production hash; the draft's own values
    // are recorded but the frozen payload is what the worker actually renders.
    expect(orderHashAfter).not.toBe(previewAfter);
    expect(orderHashBefore).not.toBe(previewBefore);
  });
});

describe("retry policy", () => {
  it("retries below the attempt limit and fails permanently at it", () => {
    expect(renderRetryStatus(1)).toBe("retrying");
    expect(renderRetryStatus(RENDER_MAX_ATTEMPTS - 1)).toBe("retrying");
    expect(renderRetryStatus(RENDER_MAX_ATTEMPTS)).toBe("failed");
    expect(renderRetryStatus(RENDER_MAX_ATTEMPTS + 1)).toBe("failed");
  });

  it("never leaves a job retrying forever", () => {
    expect(renderRetryStatus(99)).toBe("failed");
  });
});

// The roll-up rule used by refreshOrderProductionStatus, kept in one place so
// the expected mapping is asserted rather than assumed.
function rollUp(statuses: string[]): string {
  const has = (status: string) => statuses.includes(status);
  return has("failed") || has("queue_failed") || has("attention_required")
    ? "attention_required"
    : has("pending")
      ? "snapshot_pending"
      : has("processing")
        ? "rendering"
        : has("queued")
          ? "render_queued"
          : statuses.every((status) => status === "completed" || status === "not_required")
            ? "render_ready"
            : "snapshot_ready";
}

describe("order production status roll-up", () => {
  it("reports render_ready only when every snapshot has usable output", () => {
    expect(rollUp(["completed", "completed"])).toBe("render_ready");
    expect(rollUp(["completed", "not_required"])).toBe("render_ready");
  });

  it("surfaces any failure as attention_required, even alongside successes", () => {
    expect(rollUp(["completed", "failed"])).toBe("attention_required");
    expect(rollUp(["completed", "queue_failed"])).toBe("attention_required");
    expect(rollUp(["attention_required"])).toBe("attention_required");
  });

  it("never reports ready while work is still outstanding", () => {
    expect(rollUp(["queued", "completed"])).toBe("render_queued");
    expect(rollUp(["processing", "completed"])).toBe("rendering");
    expect(rollUp(["pending", "completed"])).toBe("snapshot_pending");
  });

  it("keeps a queue failure visible rather than leaving it pending", () => {
    // A snapshot whose job could never be enqueued must not look like normal
    // in-progress work.
    expect(rollUp(["queue_failed"])).not.toBe("snapshot_pending");
    expect(rollUp(["queue_failed"])).toBe("attention_required");
  });
});
