/**
 * Customer customizer recovery: ACCOUNT ISOLATION and NO STORED CREDENTIALS.
 *
 * A shared browser is the threat model: customer A designs, signs out,
 * customer B signs in on the same browser and opens the same product. B must
 * never receive anything of A's local recovery copy.
 */
import { describe, expect, it } from "vitest";
import {
  RECOVERY_HANDOFF_KEY,
  RECOVERY_HANDOFF_TTL_MS,
  adoptGuestHandoff,
  chooseRestoreSource,
  offerGuestHandoff,
  purgeLegacyRecoverySnapshots,
  readRecoverySnapshot,
  recoveryOwnerScope,
  recoveryStorageKey,
  writeRecoverySnapshot,
  type EnumerableStorage,
} from "../recovery-store";

function memoryStorage(initial: Record<string, string> = {}): EnumerableStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    key: (index) => Object.keys(data)[index] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  };
}

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = recoveryOwnerScope({ kind: "user", id: USER_A });
const B = recoveryOwnerScope({ kind: "user", id: USER_B });
const GUEST = recoveryOwnerScope({ kind: "guest", id: "5d0c3f7e-1111-4222-8333-444455556666" });
const identity = { productId: "product-x", templateId: "template-1", templateVersion: 4 };
const keyFor = (owner: string) => recoveryStorageKey(owner, identity.productId, identity.templateId, identity.templateVersion);

const SIGNED = "https://proj.supabase.co/storage/v1/object/sign/customer-uploads/x?token=eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE5MDAwMDAwMDB9.sig";

/** User A's private design: a photo upload (with signed URLs), event details, crop and a library element. */
function privateDesign() {
  return {
    values: {
      couple: "Ayesha & Rahim",
      venue: "Private venue, Road 12",
      photo: {
        assetId: "11111111-1111-4111-8111-111111111111",
        ownerId: USER_A,
        bucket: "customer-uploads",
        path: `${USER_A}/customizer/1-photo/editor.webp`,
        originalPath: `${USER_A}/customizer/1-photo/original.jpg`,
        thumbnailPath: `${USER_A}/customizer/1-photo/thumb.webp`,
        url: SIGNED,
        src: SIGNED,
        signedUrl: SIGNED,
        expiresAt: "2026-10-07T12:00:00.000Z",
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
      },
    },
    editorState: {
      layerOverrides: { photo: { crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, mask: { shape: "circle" } } },
      userLayers: [
        {
          id: "el-1",
          type: "image",
          assetId: "22222222-2222-4222-8222-222222222222",
          bucket: "customizer-elements",
          editorPath: "assets/22/editor/e.webp",
          src: SIGNED,
          editorUrl: SIGNED,
          thumbnailUrl: SIGNED,
          x: 40,
          y: 50,
          width: 120,
          height: 80,
          rotation: 12,
        },
      ],
    },
    selectedOptions: { paper: "Linen", quantity: 50 },
    activePage: "front",
  };
}

function writeAs(storage: EnumerableStorage, owner: string, overrides: Record<string, unknown> = {}) {
  return writeRecoverySnapshot(storage, keyFor(owner), {
    owner,
    identity,
    state: privateDesign(),
    customizationId: "c0ffee00-0000-4000-8000-0000000000aa",
    cartItemId: "",
    clientRevision: 7,
    ackedRevision: 3,
    guestSessionId: "",
    ...overrides,
  });
}

describe("recovery owner scope", () => {
  it("names the account or guest session, and refuses anything else", () => {
    expect(A).toBe(`user:${USER_A}`);
    expect(GUEST.startsWith("guest:")).toBe(true);
    expect(recoveryOwnerScope({ kind: "user", id: "" })).toBe("");
    expect(recoveryOwnerScope({ kind: "user", id: "a:b" })).toBe("");
    expect(recoveryOwnerScope({ kind: "user", id: "../x" })).toBe("");
    expect(recoveryOwnerScope({ kind: "admin" as any, id: USER_A })).toBe("");
    expect(recoveryOwnerScope(null)).toBe("");
  });

  it("gives different accounts different keys for the same product, template and version", () => {
    expect(keyFor(A)).not.toBe(keyFor(B));
    expect(keyFor(A)).toContain(`:user:${USER_A}:product:product-x:template:template-1:version:4`);
    expect(recoveryStorageKey("", "p", "t", 1)).toBe("");
  });
});

describe("account switch on a shared browser", () => {
  it("customer B never receives customer A's recovery copy; A still gets their own", () => {
    const storage = memoryStorage();
    expect(writeAs(storage, A)).not.toBeNull();

    // B signs in on the same browser and opens the same product.
    expect(readRecoverySnapshot(storage, keyFor(B), B)).toBeNull();
    const decision = chooseRestoreSource({ requestedId: "", server: null, local: readRecoverySnapshot(storage, keyFor(B), B) });
    expect(decision.source).toBe("none");
    // Nothing of A's (names, venue, photo, crop, element, id) is reachable under B's key.
    expect(Object.keys(storage.data).some((key) => key.includes(USER_B))).toBe(false);

    // A signs back in: their own copy is intact.
    const own = readRecoverySnapshot(storage, keyFor(A), A)!;
    expect(own.values.couple).toBe("Ayesha & Rahim");
    expect(own.customizationId).toBe("c0ffee00-0000-4000-8000-0000000000aa");
    expect(own.owner).toBe(A);
  });

  it("a snapshot copied into another account's key is still refused (owner stamp, not just the key)", () => {
    const storage = memoryStorage();
    writeAs(storage, A);
    storage.setItem(keyFor(B), storage.getItem(keyFor(A))!);
    expect(readRecoverySnapshot(storage, keyFor(B), B)).toBeNull();
  });

  it("a snapshot without an owner stamp is never read", () => {
    const storage = memoryStorage();
    const { owner: _owner, ...unstamped } = JSON.parse(JSON.stringify(writeAs(storage, A)));
    storage.setItem(keyFor(B), JSON.stringify(unstamped));
    expect(readRecoverySnapshot(storage, keyFor(B), B)).toBeNull();
  });

  it("nothing can be written into another actor's slot", () => {
    const storage = memoryStorage();
    expect(writeRecoverySnapshot(storage, keyFor(B), { owner: A, identity, state: privateDesign(), customizationId: "", cartItemId: "", clientRevision: 1, ackedRevision: 0, guestSessionId: "" })).toBeNull();
    expect(storage.length).toBe(0);
    expect(writeRecoverySnapshot(storage, keyFor(A), { owner: "", identity, state: privateDesign(), customizationId: "", cartItemId: "", clientRevision: 1, ackedRevision: 0, guestSessionId: "" })).toBeNull();
  });

  it("a guest never reads a signed-in customer's copy, and a customer never reads a guest's", () => {
    const storage = memoryStorage();
    writeAs(storage, A);
    writeAs(storage, GUEST, { customizationId: "" });
    expect(readRecoverySnapshot(storage, keyFor(GUEST), GUEST)!.customizationId).toBe("");
    expect(readRecoverySnapshot(storage, keyFor(A), GUEST)).toBeNull();
    expect(readRecoverySnapshot(storage, keyFor(GUEST), A)).toBeNull();
    expect(readRecoverySnapshot(storage, keyFor(GUEST), B)).toBeNull();
  });
});

describe("legacy (unscoped) snapshots", () => {
  it("are never read and are purged, leaving scoped and unrelated keys alone", () => {
    const legacyKey = "husnalogy_customizer_draft:product-x:template-1:4";
    const storage = memoryStorage({
      [legacyKey]: JSON.stringify({ id: "local_old", values: { couple: "Someone else" } }),
      "husnalogy_customizer_draft:other:t:1": "{}",
      husnalogy_guest_session_id: "g",
      unrelated: "keep",
    });
    writeAs(storage, A);
    expect(purgeLegacyRecoverySnapshots(storage)).toBe(2);
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
    expect(storage.getItem("husnalogy_guest_session_id")).toBe("g");
    expect(readRecoverySnapshot(storage, keyFor(A), A)).not.toBeNull();
    expect(purgeLegacyRecoverySnapshots(null)).toBe(0);
  });
});

describe("no runtime credentials are stored", () => {
  it("strips signed URLs on write and keeps durable identity, crop, mask and geometry", () => {
    const storage = memoryStorage();
    writeAs(storage, A);
    const raw = storage.getItem(keyFor(A))!;
    expect(raw).not.toContain("token=");
    expect(raw).not.toContain("/object/sign/");
    const stored = JSON.parse(raw);
    const photo = stored.values.photo;
    for (const field of ["url", "src", "signedUrl", "expiresAt"]) expect(photo[field]).toBeUndefined();
    expect(photo.assetId).toBe("11111111-1111-4111-8111-111111111111");
    expect(photo.bucket).toBe("customer-uploads");
    expect(photo.originalPath).toBe(`${USER_A}/customizer/1-photo/original.jpg`);
    expect(photo.thumbnailPath).toBe(`${USER_A}/customizer/1-photo/thumb.webp`);
    expect(photo.assetReference.editorStoragePath).toBe(`${USER_A}/customizer/1-photo/editor.webp`);
    expect(photo.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 });

    const element = stored.renderData.editorState.userLayers[0];
    for (const field of ["src", "editorUrl", "thumbnailUrl"]) expect(element[field]).toBeUndefined();
    expect(element).toMatchObject({ assetId: "22222222-2222-4222-8222-222222222222", editorPath: "assets/22/editor/e.webp", x: 40, y: 50, width: 120, height: 80, rotation: 12 });
    expect(stored.renderData.editorState.layerOverrides.photo).toEqual({ crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, mask: { shape: "circle" } });
  });

  it("also strips credentials from a snapshot written by an older build", () => {
    const storage = memoryStorage();
    const design = privateDesign();
    storage.setItem(keyFor(A), JSON.stringify({ owner: A, id: "local_x", values: design.values, selectedOptions: design.selectedOptions, renderData: { editorState: design.editorState, activePage: "front" } }));
    const read = readRecoverySnapshot(storage, keyFor(A), A)!;
    expect(JSON.stringify(read)).not.toContain("token=");
    expect(read.values.photo.assetId).toBe("11111111-1111-4111-8111-111111111111");
  });
});

describe("guest -> account handoff", () => {
  const T0 = Date.parse("2026-10-07T10:00:00.000Z");

  function guestDraft(storage: EnumerableStorage) {
    return writeRecoverySnapshot(storage, keyFor(GUEST), { owner: GUEST, identity, state: privateDesign(), customizationId: "", cartItemId: "", clientRevision: 5, ackedRevision: 0, guestSessionId: "g", now: new Date(T0) });
  }

  it("moves the handed-off guest draft into the account that signed in from the editor, once", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    guestDraft(local);
    expect(offerGuestHandoff(session, { guestOwner: GUEST, identity, now: T0 })).toBe(true);

    const adopted = adoptGuestHandoff(local, session, { userOwner: A, identity, now: T0 + 60_000 })!;
    expect(adopted.owner).toBe(A);
    expect(adopted.customizationId).toBe("");
    expect(adopted.ackedRevision).toBe(0);
    expect(adopted.clientRevision).toBe(5);
    expect(readRecoverySnapshot(local, keyFor(A), A)!.values.couple).toBe("Ayesha & Rahim");
    // The guest copy and the handoff are gone: nobody else can adopt it again.
    expect(local.getItem(keyFor(GUEST))).toBeNull();
    expect(session.getItem(RECOVERY_HANDOFF_KEY)).toBeNull();
    expect(adoptGuestHandoff(local, session, { userOwner: B, identity, now: T0 + 61_000 })).toBeNull();
    expect(readRecoverySnapshot(local, keyFor(B), B)).toBeNull();
  });

  it("signing in WITHOUT a handoff never reads the guest draft", () => {
    const local = memoryStorage();
    guestDraft(local);
    expect(adoptGuestHandoff(local, memoryStorage(), { userOwner: B, identity, now: T0 })).toBeNull();
    expect(readRecoverySnapshot(local, keyFor(B), B)).toBeNull();
    expect(local.getItem(keyFor(GUEST))).not.toBeNull();
  });

  it("an expired handoff is discarded and adopts nothing", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    guestDraft(local);
    offerGuestHandoff(session, { guestOwner: GUEST, identity, now: T0 });
    expect(adoptGuestHandoff(local, session, { userOwner: A, identity, now: T0 + RECOVERY_HANDOFF_TTL_MS + 1 })).toBeNull();
    expect(session.getItem(RECOVERY_HANDOFF_KEY)).toBeNull();
    expect(readRecoverySnapshot(local, keyFor(A), A)).toBeNull();
  });

  it("a handoff for a different design is left for that design", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    guestDraft(local);
    offerGuestHandoff(session, { guestOwner: GUEST, identity, now: T0 });
    expect(adoptGuestHandoff(local, session, { userOwner: A, identity: { ...identity, templateVersion: 5 }, now: T0 })).toBeNull();
    expect(session.getItem(RECOVERY_HANDOFF_KEY)).not.toBeNull();
  });

  it("an untouched guest template (revision 0) is not adopted", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    writeRecoverySnapshot(local, keyFor(GUEST), { owner: GUEST, identity, state: privateDesign(), customizationId: "", cartItemId: "", clientRevision: 0, ackedRevision: 0, guestSessionId: "g", now: new Date(T0) });
    offerGuestHandoff(session, { guestOwner: GUEST, identity, now: T0 });
    expect(adoptGuestHandoff(local, session, { userOwner: A, identity, now: T0 })).toBeNull();
    expect(readRecoverySnapshot(local, keyFor(A), A)).toBeNull();
  });

  it("only a signed-in account can adopt, and only a guest draft can be handed off", () => {
    const session = memoryStorage();
    expect(offerGuestHandoff(session, { guestOwner: A, identity })).toBe(false);
    expect(adoptGuestHandoff(memoryStorage(), session, { userOwner: GUEST, identity })).toBeNull();
  });

  it("never replaces newer unsaved work the account already holds for this design", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    guestDraft(local);
    writeRecoverySnapshot(local, keyFor(A), { owner: A, identity, state: { ...privateDesign(), values: { couple: "Newer" } }, customizationId: "", cartItemId: "", clientRevision: 9, ackedRevision: 2, guestSessionId: "", now: new Date(T0 + 5_000) });
    offerGuestHandoff(session, { guestOwner: GUEST, identity, now: T0 + 6_000 });
    expect(adoptGuestHandoff(local, session, { userOwner: A, identity, now: T0 + 7_000 })).toBeNull();
    expect(readRecoverySnapshot(local, keyFor(A), A)!.values.couple).toBe("Newer");
  });
});
