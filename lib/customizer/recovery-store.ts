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
 * The stored shape is the customization payload the editor already restores
 * from (values, selectedOptions, renderData.editorState, renderData.activePage).
 *
 * ACCOUNT ISOLATION. A browser is shared: one person signs out and another
 * signs in. Every snapshot therefore belongs to exactly one ACTOR — a signed-in
 * account (`user:<id>`) or this browser's anonymous guest session
 * (`guest:<id>`) — and that owner is part of the storage key AND stamped inside
 * the snapshot. A read returns a snapshot only when its stamped owner equals
 * the current actor, so a key collision, a hand-edited value or a future key
 * bug can still never hand one customer's design to another.
 *
 * NO CREDENTIALS. Signed Storage URLs are runtime credentials that expire; a
 * snapshot keeps each picture's durable identity only (asset id, bucket,
 * storage paths, crop/mask geometry), stripped by the same
 * `stripRuntimeAssetUrls` the studio recovery uses. The editor re-signs fresh
 * URLs from that identity after a restore.
 */

import { stripRuntimeAssetUrls } from "./v2/asset-identity";

export const RECOVERY_STORAGE_PREFIX = "husnalogy_customizer_draft";
/** Snapshots written before account scoping used `${prefix}:<product>:…` and are never read. */
const RECOVERY_KEY_VERSION = "v2";
const SCOPED_PREFIX = `${RECOVERY_STORAGE_PREFIX}:${RECOVERY_KEY_VERSION}:`;

export type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type RemovableStorage = StorageLike & Pick<Storage, "removeItem">;
export type EnumerableStorage = RemovableStorage & Pick<Storage, "key" | "length">;

/** Who a snapshot belongs to. */
export type RecoveryActor = { kind: "user" | "guest"; id: string };

const SCOPE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * `user:<id>` / `guest:<id>`, or "" when there is no usable identity (auth
 * still loading, storage blocked) — in which case nothing is read or written.
 */
export function recoveryOwnerScope(actor: RecoveryActor | null | undefined): string {
  if (!actor || (actor.kind !== "user" && actor.kind !== "guest")) return "";
  const id = String(actor.id || "");
  return SCOPE_ID.test(id) ? `${actor.kind}:${id}` : "";
}

export const isUserScope = (owner: unknown): boolean => typeof owner === "string" && /^user:[A-Za-z0-9_-]{1,128}$/.test(owner);
export const isGuestScope = (owner: unknown): boolean => typeof owner === "string" && /^guest:[A-Za-z0-9_-]{1,128}$/.test(owner);
const isScope = (owner: unknown): owner is string => isUserScope(owner) || isGuestScope(owner);

export type RecoverySnapshot = {
  /** The actor this snapshot belongs to (`user:<id>` or `guest:<id>`). */
  owner: string;
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

/**
 * `husnalogy_customizer_draft:v2:<owner>:product:<id>:template:<id>:version:<n>`,
 * or "" when there is no owner — callers then neither read nor write.
 */
export function recoveryStorageKey(owner: string, productId: string, templateId: string, templateVersion: number): string {
  if (!isScope(owner)) return "";
  return `${SCOPED_PREFIX}${owner}:product:${productId || "product"}:template:${templateId || "template"}:version:${templateVersion || 1}`;
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

/**
 * The snapshot stored at `key`, but ONLY when it belongs to `owner`. A snapshot
 * stamped with any other owner — or none — is treated as absent.
 */
export function readRecoverySnapshot(storage: StorageLike | null, key: string, owner: string): RecoverySnapshot | null {
  if (!storage || !key || !isScope(owner)) return null;
  let parsed: unknown;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.owner !== owner) return null;
  // Snapshots are stripped on write; stripping again on read also covers a
  // value written by an older build or edited by hand.
  const renderData: Record<string, any> = isObject(parsed.renderData) ? stripRuntimeAssetUrls(parsed.renderData) : {};
  const customizationId = serverCustomizationId(parsed.customizationId) || serverCustomizationId(parsed.id);
  return {
    owner,
    id: String(parsed.id || customizationId || ""),
    customizationId,
    productId: String(parsed.productId || ""),
    templateId: String(parsed.templateId || ""),
    templateVersion: Number(parsed.templateVersion) || 0,
    cartItemId: String(parsed.cartItemId || ""),
    values: isObject(parsed.values) ? stripRuntimeAssetUrls(parsed.values) : {},
    selectedOptions: isObject(parsed.selectedOptions) ? stripRuntimeAssetUrls(parsed.selectedOptions) : {},
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
 * Write the newest editor state for `input.owner`. Returns the stored snapshot,
 * or null when nothing was written: no owner/key, or the browser refused the
 * write (storage full, disabled, private mode) — the caller must then keep
 * warning before unload, because nothing durable exists.
 */
export function writeRecoverySnapshot(
  storage: StorageLike | null,
  key: string,
  input: {
    owner: string;
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
  if (!storage || !key || !isScope(input.owner)) return null;
  // The key must be this owner's: nothing can write into another actor's slot.
  if (!key.startsWith(`${SCOPED_PREFIX}${input.owner}:`)) return null;
  const previous = readRecoverySnapshot(storage, key, input.owner);
  const customizationId = serverCustomizationId(input.customizationId);
  // A guest design keeps one stable local id for its whole life; a server id
  // always wins once it exists.
  const localId =
    previous && isLocalCustomizationId(previous.id) && !previous.customizationId ? previous.id : newLocalId();
  const snapshot: RecoverySnapshot = {
    owner: input.owner,
    id: customizationId || localId,
    customizationId,
    productId: input.identity.productId,
    templateId: input.identity.templateId,
    templateVersion: input.identity.templateVersion,
    cartItemId: input.cartItemId || "",
    // Durable identity only: signed URLs (and values derived from them) are
    // runtime credentials and are re-signed after a restore.
    values: stripRuntimeAssetUrls(input.state.values),
    selectedOptions: stripRuntimeAssetUrls(input.state.selectedOptions),
    renderData: {
      editorState: stripRuntimeAssetUrls(input.state.editorState),
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
  owner: string,
  ack: { customizationId: string; revision: number },
): boolean {
  if (!storage) return false;
  const current = readRecoverySnapshot(storage, key, owner);
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

/**
 * Remove every snapshot written before account scoping. Their owner cannot be
 * established (a signed-in customer's draft looked exactly like a guest's), so
 * they are discarded rather than offered to whoever opens the product next.
 * Only this browser's copies are touched; saved designs live on the server.
 */
export function purgeLegacyRecoverySnapshots(storage: EnumerableStorage | null): number {
  if (!storage) return 0;
  const legacy: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(`${RECOVERY_STORAGE_PREFIX}:`) && !key.startsWith(SCOPED_PREFIX)) legacy.push(key);
    }
    legacy.forEach((key) => storage.removeItem(key));
  } catch {
    return 0;
  }
  return legacy.length;
}

/* -------------------------------------------------------------------------- */
/* Guest -> account handoff                                                    */
/* -------------------------------------------------------------------------- */

/*
 * A guest's design lives only on this device, and the editor asks them to sign
 * in to add it to the cart ("Your design is saved on this device"). The guest
 * draft must then follow THAT person into their account — and only them.
 *
 * Signing in is therefore never, on its own, a reason to read a guest
 * snapshot. The editor records an explicit, short-lived HANDOFF in
 * sessionStorage (one browser tab: it survives the OAuth round trip, not a
 * closed tab) when the guest asks to sign in, or when the person at this very
 * editor signs in mid-session. The next signed-in restore of the SAME design
 * consumes it.
 */

export const RECOVERY_HANDOFF_KEY = "husnalogy_customizer_guest_handoff";
export const RECOVERY_HANDOFF_TTL_MS = 30 * 60 * 1000;

type Handoff = { guestOwner: string; productId: string; templateId: string; templateVersion: number; createdAt: number };

export function offerGuestHandoff(
  session: RemovableStorage | null,
  input: { guestOwner: string; identity: RecoveryIdentity; now?: number },
): boolean {
  if (!session || !isGuestScope(input.guestOwner)) return false;
  const handoff: Handoff = {
    guestOwner: input.guestOwner,
    productId: input.identity.productId,
    templateId: input.identity.templateId,
    templateVersion: input.identity.templateVersion,
    createdAt: input.now ?? Date.now(),
  };
  try {
    session.setItem(RECOVERY_HANDOFF_KEY, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

/**
 * Move this tab's handed-off guest draft into the signed-in account, when the
 * handoff names exactly this design and is still fresh. The handoff is
 * single-use; the guest copy is removed once it belongs to the account. A
 * newer unsaved snapshot the account already holds for this design is never
 * replaced. Returns the account-owned snapshot, or null when nothing was adopted.
 */
export function adoptGuestHandoff(
  local: RemovableStorage | null,
  session: RemovableStorage | null,
  input: { userOwner: string; identity: RecoveryIdentity; now?: number },
): RecoverySnapshot | null {
  if (!local || !session || !isUserScope(input.userOwner)) return null;
  let handoff: Handoff | null = null;
  try {
    const raw = session.getItem(RECOVERY_HANDOFF_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    handoff = isObject(parsed) ? (parsed as Handoff) : null;
  } catch {
    handoff = null;
  }
  if (!handoff) return null;
  const now = input.now ?? Date.now();
  const age = now - Number(handoff.createdAt);
  const fresh = Number.isFinite(age) && age >= 0 && age <= RECOVERY_HANDOFF_TTL_MS;
  const sameDesign =
    handoff.productId === input.identity.productId &&
    handoff.templateId === input.identity.templateId &&
    Number(handoff.templateVersion) === input.identity.templateVersion;
  // A fresh handoff for another design is left for that design.
  if (fresh && !sameDesign) return null;
  try {
    session.removeItem(RECOVERY_HANDOFF_KEY);
  } catch {
    // A handoff that cannot be removed simply expires.
  }
  if (!fresh || !isGuestScope(handoff.guestOwner)) return null;

  const { productId, templateId, templateVersion } = input.identity;
  const guestKey = recoveryStorageKey(handoff.guestOwner, productId, templateId, templateVersion);
  const userKey = recoveryStorageKey(input.userOwner, productId, templateId, templateVersion);
  const guest = readRecoverySnapshot(local, guestKey, handoff.guestOwner);
  // Revision 0 is the untouched template: there is no guest work to carry.
  if (!guest || guest.clientRevision < 1) return null;
  const existing = readRecoverySnapshot(local, userKey, input.userOwner);
  if (existing && hasUnacknowledgedChanges(existing) && (Date.parse(existing.updatedAt) || 0) >= (Date.parse(guest.updatedAt) || 0)) {
    return null;
  }

  // A guest draft was never on the server: it becomes a NEW design of this
  // account (no customization id), with every edit still unconfirmed.
  const adopted: RecoverySnapshot = {
    ...guest,
    owner: input.userOwner,
    id: isLocalCustomizationId(guest.id) ? guest.id : newLocalId(),
    customizationId: "",
    cartItemId: "",
    ackedRevision: 0,
  };
  try {
    local.setItem(userKey, JSON.stringify(adopted));
    local.removeItem(guestKey);
  } catch {
    return null;
  }
  return adopted;
}

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
