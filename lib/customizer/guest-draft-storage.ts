// Guest draft storage (spec §13, §14). Browser-only.
//
// A guest's work lives on their device until they sign in. Every write returns
// an honest result: when the browser refuses to store the draft (private mode,
// quota exhausted, storage disabled by policy) the caller learns about it and
// must not tell the customer their design is saved.
//
// IndexedDB is the primary store — it has a far larger quota than
// localStorage and does not block the main thread. localStorage remains as a
// compatibility fallback and is also where drafts written by earlier versions
// of the editor are found and migrated from.

export const GUEST_DRAFT_SCHEMA_VERSION = 2;
export const GUEST_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const DB_NAME = "husnalogy_customizer";
const DB_VERSION = 1;
const STORE_NAME = "guest_drafts";
export const DRAFT_STORAGE_PREFIX = "husnalogy_customizer_draft";
const GUEST_SESSION_KEY = "husnalogy_guest_session_id";

export type GuestDraftStorageType = "indexeddb" | "localstorage" | "none";

export type GuestDraftErrorCode =
  | "STORAGE_UNAVAILABLE"
  | "SECURITY_ERROR"
  | "QUOTA_EXCEEDED"
  | "INVALID_JSON"
  | "CORRUPT_DRAFT"
  | "WRITE_FAILED"
  | "READ_FAILED";

export type GuestDraftRecord = {
  key: string;
  id: string;
  schemaVersion: number;
  guestSessionId: string;
  productId: string;
  templateId: string;
  templateVersion: number;
  updatedAt: string;
  expiresAt: string;
  payload: Record<string, unknown>;
};

export type GuestDraftWriteResult = {
  ok: boolean;
  draft: GuestDraftRecord | null;
  storageType: GuestDraftStorageType;
  errorCode?: GuestDraftErrorCode;
  errorMessage?: string;
};

export type GuestDraftReadResult = {
  ok: boolean;
  draft: GuestDraftRecord | null;
  storageType: GuestDraftStorageType;
  errorCode?: GuestDraftErrorCode;
  errorMessage?: string;
};

// The single customer-facing message for a failed device save. It never claims
// the design is safe and always offers the reliable alternative.
export const GUEST_SAVE_FAILURE_MESSAGE =
  "Your design could not be saved on this device. Please sign in to save it securely.";

export function draftStorageKey(productId: string, templateId: string, templateVersion: number): string {
  return `${DRAFT_STORAGE_PREFIX}:${productId || "product"}:${templateId || "template"}:${templateVersion || 1}`;
}

function classifyError(error: unknown): { code: GuestDraftErrorCode; message: string } {
  const name = String((error as any)?.name || "");
  const message = String((error as any)?.message || error || "Storage write failed.");
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || /quota/i.test(message)) {
    return { code: "QUOTA_EXCEEDED", message };
  }
  if (name === "SecurityError" || /security|denied|access/i.test(message)) {
    return { code: "SECURITY_ERROR", message };
  }
  if (name === "SyntaxError" || /json/i.test(message)) {
    return { code: "INVALID_JSON", message };
  }
  return { code: "WRITE_FAILED", message };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export function isLocalStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Merely reading window.localStorage throws in some privacy modes, and a
    // present object can still reject every write — probe with a real write.
    const probe = `${DRAFT_STORAGE_PREFIX}__probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function isIndexedDbAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.indexedDB);
  } catch {
    return false;
  }
}

export function getGuestSessionId(): string {
  const generate = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  if (!isLocalStorageAvailable()) return generate();
  try {
    const existing = window.localStorage.getItem(GUEST_SESSION_KEY);
    if (existing) return existing;
    const id = generate();
    window.localStorage.setItem(GUEST_SESSION_KEY, id);
    return id;
  } catch {
    return generate();
  }
}

// ---------------------------------------------------------------------------
// IndexedDB primitives
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const done = (value: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => done(request.result);
      request.onerror = () => done(null);
      request.onblocked = () => done(null);
      // A private-mode browser can leave the open request pending forever.
      window.setTimeout(() => done(null), 3000);
    } catch {
      done(null);
    }
  });
  return dbPromise;
}

type TransactionOutcome<T> = { ok: boolean; value?: T; error?: unknown };

function runTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<TransactionOutcome<T>> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) {
          resolve({ ok: false, error: new Error("IndexedDB unavailable") });
          return;
        }
        try {
          const tx = db.transaction(STORE_NAME, mode);
          const request = action(tx.objectStore(STORE_NAME));
          request.onsuccess = () => resolve({ ok: true, value: request.result });
          request.onerror = () => resolve({ ok: false, error: request.error });
          tx.onabort = () => resolve({ ok: false, error: tx.error });
          tx.onerror = () => resolve({ ok: false, error: tx.error });
        } catch (error) {
          resolve({ ok: false, error });
        }
      }),
  );
}

// ---------------------------------------------------------------------------
// Record shaping
// ---------------------------------------------------------------------------

function isExpired(record: GuestDraftRecord): boolean {
  const expiresAt = Date.parse(record.expiresAt || "");
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

// Preview images are large and regenerable — they must never consume the
// guest's storage quota (spec §14).
const OMITTED_PAYLOAD_KEYS = new Set(["previewImages", "printFiles", "previewData", "thumbnail"]);

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (OMITTED_PAYLOAD_KEYS.has(key)) continue;
    compact[key] = value;
  }
  return compact;
}

function buildRecord(
  key: string,
  payload: Record<string, unknown>,
  previous: GuestDraftRecord | null,
): GuestDraftRecord {
  const now = new Date();
  return {
    key,
    id: previous?.id || `local_${now.getTime()}_${Math.random().toString(36).slice(2)}`,
    schemaVersion: GUEST_DRAFT_SCHEMA_VERSION,
    guestSessionId: previous?.guestSessionId || getGuestSessionId(),
    productId: String(payload.productId || previous?.productId || ""),
    templateId: String(payload.templateId || previous?.templateId || ""),
    templateVersion: Number(payload.templateVersion || previous?.templateVersion || 1),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + GUEST_DRAFT_TTL_MS).toISOString(),
    payload: compactPayload({ ...(previous?.payload || {}), ...payload }),
  };
}

// Accepts both the current record shape and the flat payload written by
// earlier editor versions, so an in-progress guest design survives an upgrade.
function normalizeRecord(key: string, raw: unknown): GuestDraftRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, any>;

  if (Number(value.schemaVersion) >= 2 && value.payload && typeof value.payload === "object") {
    return {
      key: String(value.key || key),
      id: String(value.id || ""),
      schemaVersion: Number(value.schemaVersion),
      guestSessionId: String(value.guestSessionId || ""),
      productId: String(value.productId || ""),
      templateId: String(value.templateId || ""),
      templateVersion: Number(value.templateVersion) || 1,
      updatedAt: String(value.updatedAt || ""),
      expiresAt: String(value.expiresAt || ""),
      payload: value.payload as Record<string, unknown>,
    };
  }

  // Legacy (schema 1): the draft payload was stored flat.
  if (value.productId || value.values || value.renderData) {
    const updatedAt = String(value.updatedAt || new Date().toISOString());
    const updatedMs = Date.parse(updatedAt);
    return {
      key,
      id: String(value.id || `local_${Date.now()}_${Math.random().toString(36).slice(2)}`),
      schemaVersion: 1,
      guestSessionId: String(value.guestSessionId || ""),
      productId: String(value.productId || ""),
      templateId: String(value.templateId || ""),
      templateVersion: Number(value.templateVersion) || 1,
      updatedAt,
      expiresAt: new Date((Number.isFinite(updatedMs) ? updatedMs : Date.now()) + GUEST_DRAFT_TTL_MS).toISOString(),
      payload: compactPayload(value),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function readGuestDraft(key: string): Promise<GuestDraftReadResult> {
  // IndexedDB first, then the localStorage fallback (which also holds drafts
  // written before IndexedDB was used).
  const fromDb = await runTransaction<any>("readonly", (store) => store.get(key));
  if (fromDb.ok && fromDb.value) {
    const record = normalizeRecord(key, fromDb.value);
    if (!record) {
      return { ok: false, draft: null, storageType: "indexeddb", errorCode: "CORRUPT_DRAFT", errorMessage: "Stored draft could not be understood." };
    }
    if (isExpired(record)) {
      await removeGuestDraft(key);
      return { ok: true, draft: null, storageType: "indexeddb" };
    }
    return { ok: true, draft: record, storageType: "indexeddb" };
  }

  if (!isLocalStorageAvailable()) {
    return {
      ok: false,
      draft: null,
      storageType: "none",
      errorCode: "STORAGE_UNAVAILABLE",
      errorMessage: "This browser is not allowing the design to be stored on the device.",
    };
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ok: true, draft: null, storageType: "localstorage" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // A corrupt entry must not wedge the editor forever.
      window.localStorage.removeItem(key);
      const classified = classifyError(error);
      return { ok: false, draft: null, storageType: "localstorage", errorCode: "INVALID_JSON", errorMessage: classified.message };
    }
    const record = normalizeRecord(key, parsed);
    if (!record) {
      window.localStorage.removeItem(key);
      return { ok: false, draft: null, storageType: "localstorage", errorCode: "CORRUPT_DRAFT", errorMessage: "Stored draft could not be understood." };
    }
    if (isExpired(record)) {
      window.localStorage.removeItem(key);
      return { ok: true, draft: null, storageType: "localstorage" };
    }
    return { ok: true, draft: record, storageType: "localstorage" };
  } catch (error) {
    const classified = classifyError(error);
    return { ok: false, draft: null, storageType: "none", errorCode: classified.code, errorMessage: classified.message };
  }
}

export async function writeGuestDraft(
  key: string,
  payload: Record<string, unknown>,
): Promise<GuestDraftWriteResult> {
  const existing = await readGuestDraft(key);
  const record = buildRecord(key, payload, existing.draft);

  // IndexedDB is authoritative when it works.
  const written = await runTransaction("readwrite", (store) => store.put(record));
  const writeError = written.error;
  if (written.ok) {
    // Retire any stale localStorage copy so the two stores cannot disagree.
    if (isLocalStorageAvailable()) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // A failed cleanup is harmless: reads prefer IndexedDB.
      }
    }
    return { ok: true, draft: record, storageType: "indexeddb" };
  }

  // Fall back to localStorage by attempting the real write. Probing first
  // would misreport the reason: a quota-exhausted store fails the probe too,
  // and the customer deserves the specific cause, not a generic one.
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      throw Object.assign(new Error("Browser storage is not available."), { name: "StorageUnavailable" });
    }
    window.localStorage.setItem(key, JSON.stringify(record));
    return { ok: true, draft: record, storageType: "localstorage" };
  } catch (error) {
    // Both stores refused the write. The caller must report failure — it must
    // not display "Saved".
    const classified = classifyError(error);
    const code =
      classified.code === "WRITE_FAILED" || (error as any)?.name === "StorageUnavailable"
        ? "STORAGE_UNAVAILABLE"
        : classified.code;
    return {
      ok: false,
      draft: null,
      storageType: "none",
      errorCode: code,
      errorMessage: classified.message || String(writeError || classified.message),
    };
  }
}

export async function removeGuestDraft(key: string): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(key));
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing further to do — the draft is already gone from IndexedDB.
    }
  }
}

// Customer-facing text for a failed device save. Codes are never shown.
export function guestSaveFailureMessage(errorCode?: GuestDraftErrorCode): string {
  if (errorCode === "QUOTA_EXCEEDED") {
    return "There is not enough storage space on this device to save your design. Please sign in to save it securely.";
  }
  return GUEST_SAVE_FAILURE_MESSAGE;
}
