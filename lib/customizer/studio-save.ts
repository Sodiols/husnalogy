// The Design Studio's save / publish contract (client-side, pure).
//
// Saving a template DRAFT and publishing an immutable template VERSION are two
// separate server operations. The studio used to await a product save that
// returned nothing on failure, clear its dirty flag regardless, and call the
// publication endpoint anyway — so a failed save could still freeze an old
// draft, a new product published against a null id, and an edit made while
// the request was in flight was marked clean without ever being saved.
//
// This module is the single, testable statement of the contract:
//   - a save resolves to an explicit ProductSaveResult;
//   - publication is attempted only after a confirmed save, against the id the
//     save returned, pinned to the draft revision that save produced;
//   - a saved-but-not-published outcome is reported as exactly that;
//   - dirty state is tracked per revision, so only the revision actually saved
//     is ever marked clean.

export type ProductSaveResult =
  | { ok: true; productId: string; product: any; template: any | null }
  | { ok: false; reason: "validation" | "request" | "busy"; error: string };

export type TemplatePublishResult =
  | { ok: true; displayVersion: string; version: any; warnings: string[] }
  | { ok: false; error: string; conflict: boolean };

export type StudioPublishOutcome =
  | { status: "published"; message: string; save: Extract<ProductSaveResult, { ok: true }>; publish: Extract<TemplatePublishResult, { ok: true }> }
  | { status: "save-failed"; message: string; save: Extract<ProductSaveResult, { ok: false }> }
  | { status: "publish-failed"; message: string; save: Extract<ProductSaveResult, { ok: true }>; publish: Extract<TemplatePublishResult, { ok: false }> };

/** Interpret a save callback's return value; anything but a confirmed result is a failure. */
export function asProductSaveResult(value: unknown): ProductSaveResult {
  const result = value as any;
  if (result && result.ok === true && typeof result.productId === "string" && result.productId) {
    return { ok: true, productId: result.productId, product: result.product ?? null, template: result.template ?? null };
  }
  if (result && result.ok === false) {
    const reason = result.reason === "validation" || result.reason === "busy" ? result.reason : "request";
    return { ok: false, reason, error: String(result.error || "The design could not be saved.") };
  }
  return { ok: false, reason: "request", error: "The design could not be saved." };
}

/** POST the publication request and normalise every outcome (never throws). */
export async function requestTemplatePublication(
  productId: string,
  body: { updateType: "minor" | "major"; notes: string; expectedDraftUpdatedAt: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<TemplatePublishResult> {
  try {
    const response = await fetchImpl(`/api/admin/customizer/templates/${encodeURIComponent(productId)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: any = await response.json().catch(() => ({}));
    if (response.ok && data?.ok) {
      return {
        ok: true,
        displayVersion: String(data.version?.display || data.version?.version || ""),
        version: data.version ?? null,
        warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [],
      };
    }
    return {
      ok: false,
      conflict: response.status === 409 || Boolean(data?.conflict),
      error: String(data?.errors?.[0] || data?.error || "The version snapshot could not be created."),
    };
  } catch {
    return { ok: false, conflict: false, error: "The version snapshot could not be created (network error)." };
  }
}

/**
 * Save the draft, then — only if the save is confirmed — publish exactly that
 * draft as a new immutable version.
 */
export async function saveThenPublish(deps: {
  save: () => Promise<unknown>;
  publish: (productId: string, expectedDraftUpdatedAt: string | null) => Promise<TemplatePublishResult>;
}): Promise<StudioPublishOutcome> {
  const save = asProductSaveResult(await deps.save());
  if (save.ok === false) {
    return { status: "save-failed", save, message: `Not published — the draft was not saved: ${save.error}` };
  }
  const expected = save.template?.updatedAt ? String(save.template.updatedAt) : null;
  const publish = await deps.publish(save.productId, expected);
  if (publish.ok === false) {
    return {
      status: "publish-failed",
      save,
      publish,
      message: `Draft saved, but it was not published: ${publish.error}`,
    };
  }
  return {
    status: "published",
    save,
    publish,
    message: "Published. New customers now see this design.",
  };
}

/**
 * Revision tokens for dirty tracking. Every document change takes a NEW token
 * (never reused); undo, redo and cancelled previews restore an earlier token.
 * A save records the token of the revision it actually sent, so edits made
 * while the request was in flight stay dirty.
 */
export type RevisionTracker = {
  readonly current: number;
  readonly saved: number;
  next(): number;
  restore(token: number): void;
  markSaved(token: number): void;
  isDirty(): boolean;
};

export function createRevisionTracker(): RevisionTracker {
  let counter = 0;
  let current = 0;
  let saved = 0;
  return {
    get current() {
      return current;
    },
    get saved() {
      return saved;
    },
    next() {
      counter += 1;
      current = counter;
      return current;
    },
    restore(token: number) {
      current = token;
    },
    markSaved(token: number) {
      saved = token;
    },
    isDirty() {
      return current !== saved;
    },
  };
}

/* ------------------------------------------------------------ save status */

/**
 * What the studio tells the designer about where their work is. Every label
 * is a statement about the SERVER, never inferred from a local write:
 *
 *  - "Saved"       the server confirmed the current revision;
 *  - "Unsaved"     the current revision is not on the server yet — it stays
 *                  until the server confirms, never cleared by merely sending;
 *  - "Saving…"     shown beside it while a request is in flight;
 *  - "Local only"  there is no server record of this design at all — it lives
 *                  only in this browser's recovery copy;
 *  - "Save failed" the last attempt failed (detail says why; it is retried);
 *  - "Offline"     the browser has no connection; changes are kept locally.
 */
export type StudioSaveStatusInput = {
  /** The product exists on the server (it has an id). */
  hasServerRecord: boolean;
  /** The current revision differs from the last one the server confirmed. */
  dirty: boolean;
  /** A save request is in flight. */
  saving: boolean;
  /** The last save attempt's failure, cleared by the next success. */
  failure: { reason: "validation" | "request" | "busy"; error: string } | null;
  online: boolean;
  /** A new product can be created as a draft (it has the minimum a draft needs: a name). */
  canCreateDraft: boolean;
};

export type StudioSaveStatus = {
  /** The headline: Saved, Unsaved, or "" for an untouched new design. */
  primary: "Saved" | "Unsaved" | "";
  /** Extra truths shown beside it. */
  flags: Array<"Saving…" | "Local only" | "Save failed" | "Offline">;
  /** One sentence for the designer, or "" when everything is saved. */
  detail: string;
  /** Whether the detail is a problem the designer should see now. */
  alert: boolean;
};

export function describeStudioSaveStatus(input: StudioSaveStatusInput): StudioSaveStatus {
  const flags: StudioSaveStatus["flags"] = [];
  const primary: StudioSaveStatus["primary"] = input.dirty ? "Unsaved" : input.hasServerRecord ? "Saved" : "";
  if (input.saving) flags.push("Saving…");
  if (!input.hasServerRecord && (input.dirty || input.saving)) flags.push("Local only");
  if (!input.online && input.dirty) flags.push("Offline");
  const failed = Boolean(input.failure && input.failure.reason !== "busy" && input.dirty && !input.saving);
  if (failed) flags.push("Save failed");

  let detail = "";
  let alert = false;
  if (!input.online && input.dirty) {
    detail = "You're offline. Your changes are kept on this device and will save when the connection returns.";
    alert = true;
  } else if (failed) {
    const kept = "Your changes are kept on this device.";
    detail = input.failure!.reason === "validation"
      ? `Not saved to the server — ${input.failure!.error} ${kept}`
      : `Save failed — ${input.failure!.error} ${kept} Retrying automatically.`;
    alert = true;
  } else if (!input.hasServerRecord && input.dirty && !input.canCreateDraft) {
    detail = "This design is only on this device. Give the product a name (Back to Product) and it will save to the server as a draft.";
    alert = true;
  } else if (!input.hasServerRecord && input.dirty) {
    detail = "This design is only on this device until its first save; it will be saved to the server as a draft automatically.";
  }
  return { primary, flags, detail, alert };
}

/** May the studio start an autosave now? (A new product needs a name; never while offline.) */
export function studioMayAutosave(input: { hasServerRecord: boolean; canCreateDraft: boolean; dirty: boolean; online: boolean }): boolean {
  return input.dirty && input.online && (input.hasServerRecord || input.canCreateDraft);
}

/** Backoff for retrying a failed studio autosave: 5 s, 15 s, 30 s, then every 60 s. */
export function studioAutosaveRetryDelayMs(attempt: number): number {
  const delays = [5_000, 15_000, 30_000];
  return delays[Math.max(0, attempt - 1)] ?? 60_000;
}
