/**
 * Crash-safe local recovery for the customer customizer.
 *
 * The server is the system of record, but a server write cannot be the only
 * copy of a customer's latest edit: a refresh, a closed tab, a crashed browser
 * or a power cut can all land between "the customer changed something" and
 * "the server confirmed it". This store keeps a durable copy of the newest
 * editor state in the browser so that window is covered.
 *
 * Every snapshot carries two revision numbers:
 *
 *  - `clientRevision` — the revision of the state stored here. It only ever
 *    moves forward within a design, across reloads, so "newer" is a number
 *    comparison rather than a clock comparison.
 *  - `ackedRevision` — the newest revision the server has confirmed. A snapshot
 *    whose clientRevision is above it holds edits the server never received,
 *    and is the one to restore after a crash.
 *
 * The stored shape is deliberately the customization payload the editor
 * already restores from (values, selectedOptions, renderData.editorState,
 * renderData.activePage), so guest drafts written before this module existed
 * still restore unchanged.
 */

export const RECOVERY_STORAGE_PREFIX = "husnalogy_customizer_draft";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type RecoverySnapshot = {
  /** The server customization id when known; otherwise a `local_` id. */
  id: string;
  /** The server customization id this state belongs to; "" until the first server save. */
  customizationId: string;
  productId: string;
  templateId: string;
  templateVersion: number;
  cartItemId: string;
  values: Record<string, any>;
  selectedOptions: Record<string, any>;
  renderData: { editorState: Record<string, any>; activePage: string; [key: string]: any };
  activePage: string;
  guestSessionId: string;
  updatedAt: string;
  clientRevision: number;
  ackedRevision: number;
};

export type RecoveryState = {
  values: Record<string, any>;
  editorState: Record<string, any>;
  selectedOptions: Record<string, any>;
  activePage: string;
};

export type RecoveryIdentity = {
  productId: string;
  templateId: string;
  templateVersion: number;
};

export function recoveryStorageKey(productId: string, templateId: string, templateVersion: number): string {
  return `${RECOVERY_STORAGE_PREFIX}:${productId || "product"}:${templateId || "template"}:${templateVersion || 1}`;
}

const isObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const revisionOf = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

export const isLocalCustomizationId = (id: unknown): boolean => String(id || "").startsWith("local_");

/**
 * The server's customization id from any saved shape, or "" when the id is a
 * local placeholder.
 */
export function serverCustomizationId(id: unknown): string {
  const value = String(id || "");
  return value && !isLocalCustomizationId(value) ? value : "";
}

/** The revision a server row was last written at; 0 for rows saved before revisions existed. */
export function serverRevisionOf(customization: any): number {
  return revisionOf(customization?.renderData?.clientRevision);
}

export function readRecoverySnapshot(storage: StorageLike | null, key: string): RecoverySnapshot | null {
  if (!storage) return null;
  let parsed: unknown;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const renderData = isObject(parsed.renderData) ? parsed.renderData : {};
  const customizationId = serverCustomizationId(parsed.customizationId) || serverCustomizationId(parsed.id);
  return {
    id: String(parsed.id || customizationId || ""),
    customizationId,
    productId: String(parsed.productId || ""),
    templateId: String(parsed.templateId || ""),
    templateVersion: Number(parsed.templateVersion) || 0,
    cartItemId: String(parsed.cartItemId || ""),
    values: isObject(parsed.values) ? parsed.values : {},
    selectedOptions: isObject(parsed.selectedOptions) ? parsed.selectedOptions : {},
    renderData: {
      ...renderData,
      editorState: isObject(renderData.editorState) ? renderData.editorState : {},
      activePage: String(renderData.activePage || parsed.activePage || ""),
    },
    activePage: String(renderData.activePage || parsed.activePage || ""),
    guestSessionId: String(parsed.guestSessionId || ""),
    updatedAt: String(parsed.updatedAt || ""),
    // Drafts written before revisions existed restore as revision 0: they are
    // still a valid design, just never "newer" than a server row.
    clientRevision: revisionOf(parsed.clientRevision),
    ackedRevision: revisionOf(parsed.ackedRevision),
  };
}

function newLocalId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `local_${random}`;
}

/**
 * Write the newest editor state. Returns the stored snapshot, or null when the
 * browser refused the write (storage full, disabled, private mode) — the
 * caller must then keep warning before unload, because nothing durable exists.
 */
export function writeRecoverySnapshot(
  storage: StorageLike | null,
  key: string,
  input: {
    identity: RecoveryIdentity;
    state: RecoveryState;
    customizationId: string;
    cartItemId: string;
    clientRevision: number;
    ackedRevision: number;
    guestSessionId: string;
    now?: Date;
  },
): RecoverySnapshot | null {
  if (!storage) return null;
  const previous = readRecoverySnapshot(storage, key);
  const customizationId = serverCustomizationId(input.customizationId);
  // A guest design keeps one stable local id for its whole life; a server id
  // always wins once it exists.
  const localId =
    previous && isLocalCustomizationId(previous.id) && !previous.customizationId ? previous.id : newLocalId();
  const snapshot: RecoverySnapshot = {
    id: customizationId || localId,
    customizationId,
    productId: input.identity.productId,
    templateId: input.identity.templateId,
    templateVersion: input.identity.templateVersion,
    cartItemId: input.cartItemId || "",
    values: input.state.values,
    selectedOptions: input.state.selectedOptions,
    renderData: {
      editorState: input.state.editorState,
      activePage: input.state.activePage,
      templateVersion: input.identity.templateVersion,
    },
    activePage: input.state.activePage,
    guestSessionId: input.guestSessionId || previous?.guestSessionId || "",
    updatedAt: (input.now || new Date()).toISOString(),
    clientRevision: revisionOf(input.clientRevision),
    ackedRevision: Math.min(revisionOf(input.clientRevision), revisionOf(input.ackedRevision)),
  };
  try {
    storage.setItem(key, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Record that the server confirmed `revision` for `customizationId`, without
 * touching the stored state. Ignored when the stored snapshot belongs to a
 * different design or already records a newer acknowledgement.
 */
export function acknowledgeRecoverySnapshot(
  storage: StorageLike | null,
  key: string,
  ack: { customizationId: string; revision: number },
): boolean {
  if (!storage) return false;
  const current = readRecoverySnapshot(storage, key);
  const customizationId = serverCustomizationId(ack.customizationId);
  if (!current || !customizationId) return false;
  if (current.customizationId && current.customizationId !== customizationId) return false;
  const revision = revisionOf(ack.revision);
  const next: RecoverySnapshot = {
    ...current,
    id: customizationId,
    customizationId,
    ackedRevision: Math.min(current.clientRevision, Math.max(current.ackedRevision, revision)),
  };
  try {
    storage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export const hasUnacknowledgedChanges = (snapshot: RecoverySnapshot): boolean =>
  snapshot.clientRevision > snapshot.ackedRevision;

export type RestoreDecision =
  | { source: "server"; revision: number }
  | { source: "local"; revision: number; snapshot: RecoverySnapshot }
  | { source: "none"; revision: number };

/**
 * Decide which copy of a design to open.
 *
 * `requestedId` is the customization the page was opened for (from the URL).
 * `server` is what the server returned for it — or, with no requested id, the
 * customer's latest draft — and null when there is none or it could not be
 * read. `local` is this browser's recovery snapshot for the same product,
 * template and version.
 *
 * The local copy wins only when it holds edits the server never confirmed AND
 * it is the same design (or, with nothing requested, the newer work). A
 * snapshot for another design never replaces the one that was asked for.
 */
export function chooseRestoreSource(input: {
  requestedId: string;
  server: any | null;
  local: RecoverySnapshot | null;
}): RestoreDecision {
  const requestedId = serverCustomizationId(input.requestedId);
  const server = input.server || null;
  const local = input.local || null;
  const serverId = serverCustomizationId(server?.id);
  const serverRevision = server ? serverRevisionOf(server) : 0;

  if (!local) return server ? { source: "server", revision: serverRevision } : { source: "none", revision: 0 };

  // A snapshot of a different design than the one requested is never used.
  if (requestedId && local.customizationId && local.customizationId !== requestedId) {
    return server ? { source: "server", revision: serverRevision } : { source: "none", revision: 0 };
  }
  // A snapshot never synced to any server row cannot stand in for a specific
  // saved design the customer asked for.
  if (requestedId && !local.customizationId) {
    return server ? { source: "server", revision: serverRevision } : { source: "none", revision: 0 };
  }

  if (!server) return { source: "local", revision: local.clientRevision, snapshot: local };

  if (local.customizationId && local.customizationId === serverId) {
    // Same design: the newer revision wins. Only unacknowledged local edits
    // can be newer than the server.
    if (hasUnacknowledgedChanges(local) && local.clientRevision > serverRevision) {
      return { source: "local", revision: local.clientRevision, snapshot: local };
    }
    return { source: "server", revision: Math.max(serverRevision, local.clientRevision) };
  }

  // Nothing specific was requested and the two copies are different designs
  // (or the local one never reached the server): reopen whichever the
  // customer worked on last, but only if the local copy holds unsaved work.
  const localTime = Date.parse(local.updatedAt) || 0;
  const serverTime = Date.parse(String(server.updatedAt || "")) || 0;
  if (!requestedId && hasUnacknowledgedChanges(local) && localTime > serverTime) {
    return { source: "local", revision: local.clientRevision, snapshot: local };
  }
  return { source: "server", revision: serverRevision };
}
