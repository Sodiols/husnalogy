import { describe, expect, it } from "vitest";
import {
  acknowledgeRecoverySnapshot,
  chooseRestoreSource,
  readRecoverySnapshot,
  recoveryStorageKey,
  serverRevisionOf,
  writeRecoverySnapshot,
  type StorageLike,
} from "../recovery-store";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

const KEY = recoveryStorageKey("product-1", "template-1", 3);
const identity = { productId: "product-1", templateId: "template-1", templateVersion: 3 };
const state = (title: string, page = "front") => ({
  values: { title },
  editorState: { layerOverrides: { headline: { transform: { x: 10 } } }, userLayers: [{ id: "u1", type: "text", text: title }] },
  selectedOptions: { paper: "Linen", quantity: 25 },
  activePage: page,
});

function write(storage: StorageLike, input: Partial<Parameters<typeof writeRecoverySnapshot>[2]> & { title?: string } = {}) {
  return writeRecoverySnapshot(storage, KEY, {
    identity,
    state: state(input.title || "Ayesha & Rahim"),
    customizationId: input.customizationId ?? "",
    cartItemId: input.cartItemId ?? "",
    clientRevision: input.clientRevision ?? 1,
    ackedRevision: input.ackedRevision ?? 0,
    guestSessionId: input.guestSessionId ?? "guest-1",
    now: input.now,
  });
}

describe("recovery snapshot storage", () => {
  it("keeps the legacy key so guest drafts written before revisions still restore", () => {
    expect(KEY).toBe("husnalogy_customizer_draft:product-1:template-1:3");
    const storage = memoryStorage({
      [KEY]: JSON.stringify({
        id: "local_old",
        values: { title: "Legacy" },
        selectedOptions: { quantity: 2 },
        renderData: { editorState: { userLayers: [{ id: "u9" }] }, activePage: "back" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
    const snapshot = readRecoverySnapshot(storage, KEY)!;
    expect(snapshot.id).toBe("local_old");
    expect(snapshot.customizationId).toBe("");
    expect(snapshot.values).toEqual({ title: "Legacy" });
    expect(snapshot.renderData.editorState).toEqual({ userLayers: [{ id: "u9" }] });
    expect(snapshot.activePage).toBe("back");
    expect(snapshot.clientRevision).toBe(0);
    expect(chooseRestoreSource({ requestedId: "", server: null, local: snapshot }).source).toBe("local");
  });

  it("stores the exact editor state, options and page in the shape the editor restores from", () => {
    const storage = memoryStorage();
    const written = write(storage, { clientRevision: 4 })!;
    const read = readRecoverySnapshot(storage, KEY)!;
    expect(read.values).toEqual({ title: "Ayesha & Rahim" });
    expect(read.renderData.editorState).toEqual(state("Ayesha & Rahim").editorState);
    expect(read.selectedOptions).toEqual({ paper: "Linen", quantity: 25 });
    expect(read.renderData.activePage).toBe("front");
    expect(read.clientRevision).toBe(4);
    expect(read.id).toBe(written.id);
    expect(read.id.startsWith("local_")).toBe(true);
  });

  it("keeps one stable local id for a guest design across writes", () => {
    const storage = memoryStorage();
    const first = write(storage, { clientRevision: 1 })!;
    const second = write(storage, { clientRevision: 2, title: "Changed" })!;
    expect(second.id).toBe(first.id);
  });

  it("switches to the server id once the design is saved", () => {
    const storage = memoryStorage();
    write(storage, { clientRevision: 1 });
    const synced = write(storage, { clientRevision: 2, customizationId: "c0ffee00-0000-4000-8000-000000000001" })!;
    expect(synced.id).toBe("c0ffee00-0000-4000-8000-000000000001");
    expect(synced.customizationId).toBe("c0ffee00-0000-4000-8000-000000000001");
  });

  it("never records a local_ placeholder as the server id", () => {
    const storage = memoryStorage();
    const snapshot = write(storage, { customizationId: "local_abc" })!;
    expect(snapshot.customizationId).toBe("");
  });

  it("returns null instead of throwing when the browser refuses the write", () => {
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    expect(write(full)).toBeNull();
    expect(writeRecoverySnapshot(null, KEY, { identity, state: state("x"), customizationId: "", cartItemId: "", clientRevision: 1, ackedRevision: 0, guestSessionId: "" })).toBeNull();
  });

  it("ignores corrupt storage", () => {
    expect(readRecoverySnapshot(memoryStorage({ [KEY]: "{not json" }), KEY)).toBeNull();
    expect(readRecoverySnapshot(memoryStorage({ [KEY]: "[1,2]" }), KEY)).toBeNull();
  });

  it("acknowledgement updates only the server bookkeeping, never the stored state", () => {
    const storage = memoryStorage();
    write(storage, { clientRevision: 7, ackedRevision: 3 });
    expect(acknowledgeRecoverySnapshot(storage, KEY, { customizationId: "c0ffee00-0000-4000-8000-000000000002", revision: 6 })).toBe(true);
    const read = readRecoverySnapshot(storage, KEY)!;
    expect(read.ackedRevision).toBe(6);
    expect(read.clientRevision).toBe(7);
    expect(read.customizationId).toBe("c0ffee00-0000-4000-8000-000000000002");
    expect(read.values).toEqual({ title: "Ayesha & Rahim" });
  });

  it("an acknowledgement can never claim more than the snapshot holds", () => {
    const storage = memoryStorage();
    write(storage, { clientRevision: 2 });
    acknowledgeRecoverySnapshot(storage, KEY, { customizationId: "c0ffee00-0000-4000-8000-000000000003", revision: 9 });
    expect(readRecoverySnapshot(storage, KEY)!.ackedRevision).toBe(2);
  });

  it("an acknowledgement for another design is ignored", () => {
    const storage = memoryStorage();
    write(storage, { clientRevision: 5, customizationId: "c0ffee00-0000-4000-8000-00000000000a" });
    expect(acknowledgeRecoverySnapshot(storage, KEY, { customizationId: "c0ffee00-0000-4000-8000-00000000000b", revision: 5 })).toBe(false);
    expect(readRecoverySnapshot(storage, KEY)!.ackedRevision).toBe(0);
  });
});

describe("chooseRestoreSource", () => {
  const id = "c0ffee00-0000-4000-8000-000000000010";
  const serverRow = (revision: number, updatedAt = "2026-10-05T10:00:00.000Z") => ({
    id,
    updatedAt,
    renderData: { clientRevision: revision },
  });
  const localSnapshot = (overrides: Record<string, unknown>) => {
    const storage = memoryStorage();
    write(storage, { customizationId: id, clientRevision: 5, ackedRevision: 5, ...(overrides as any) });
    return readRecoverySnapshot(storage, KEY)!;
  };

  it("restores unconfirmed local edits over an older server copy of the SAME design", () => {
    const decision = chooseRestoreSource({ requestedId: id, server: serverRow(5), local: localSnapshot({ clientRevision: 8, ackedRevision: 5 }) });
    expect(decision.source).toBe("local");
    expect(decision.revision).toBe(8);
  });

  it("uses the server when it already confirmed everything the device holds", () => {
    const decision = chooseRestoreSource({ requestedId: id, server: serverRow(8), local: localSnapshot({ clientRevision: 8, ackedRevision: 8 }) });
    expect(decision.source).toBe("server");
    expect(decision.revision).toBe(8);
  });

  it("uses the server when it is NEWER than the device (edited on another device later)", () => {
    const decision = chooseRestoreSource({ requestedId: id, server: serverRow(12), local: localSnapshot({ clientRevision: 8, ackedRevision: 5 }) });
    expect(decision.source).toBe("server");
    expect(decision.revision).toBe(12);
  });

  it("a keepalive that landed after the crash makes the server copy current", () => {
    // Local holds rev 9 unacknowledged (the response never arrived), the
    // server stored rev 9 from the unload request.
    const decision = chooseRestoreSource({ requestedId: id, server: serverRow(9), local: localSnapshot({ clientRevision: 9, ackedRevision: 7 }) });
    expect(decision.source).toBe("server");
  });

  it("never opens another design's snapshot in place of the one requested", () => {
    const other = localSnapshot({ customizationId: "c0ffee00-0000-4000-8000-0000000000ff", clientRevision: 99, ackedRevision: 1 });
    expect(chooseRestoreSource({ requestedId: id, server: serverRow(2), local: other }).source).toBe("server");
    expect(chooseRestoreSource({ requestedId: id, server: null, local: other }).source).toBe("none");
  });

  it("opens the matching local copy when the server could not be reached", () => {
    const decision = chooseRestoreSource({ requestedId: id, server: null, local: localSnapshot({ clientRevision: 6, ackedRevision: 6 }) });
    expect(decision.source).toBe("local");
  });

  it("a never-synced local design does not replace a specific saved design", () => {
    const fresh = localSnapshot({ customizationId: "", clientRevision: 4, ackedRevision: 0 });
    expect(chooseRestoreSource({ requestedId: id, server: serverRow(3), local: fresh }).source).toBe("server");
  });

  it("with nothing requested, reopens the newer unsaved local work over an older draft", () => {
    const fresh = localSnapshot({ customizationId: "", clientRevision: 4, ackedRevision: 0, now: new Date("2026-10-05T12:00:00.000Z") });
    const decision = chooseRestoreSource({ requestedId: "", server: serverRow(3, "2026-10-04T09:00:00.000Z"), local: fresh });
    expect(decision.source).toBe("local");
  });

  it("with nothing requested, keeps the newer server draft over stale local work", () => {
    const stale = localSnapshot({ customizationId: "", clientRevision: 4, ackedRevision: 0, now: new Date("2026-10-01T12:00:00.000Z") });
    expect(chooseRestoreSource({ requestedId: "", server: serverRow(3, "2026-10-04T09:00:00.000Z"), local: stale }).source).toBe("server");
  });

  it("starts fresh when neither copy exists", () => {
    expect(chooseRestoreSource({ requestedId: "", server: null, local: null })).toEqual({ source: "none", revision: 0 });
  });

  it("reads a server row's revision, treating rows saved before revisions as 0", () => {
    expect(serverRevisionOf({ renderData: { clientRevision: 41 } })).toBe(41);
    expect(serverRevisionOf({ renderData: {} })).toBe(0);
    expect(serverRevisionOf({ renderData: { clientRevision: "nope" } })).toBe(0);
    expect(serverRevisionOf(null)).toBe(0);
  });
});
