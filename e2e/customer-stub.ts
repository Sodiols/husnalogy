/**
 * A signed-in customer and a customization API, both answered INSIDE the
 * browser context — for persistence tests against the in-memory fixture.
 *
 * Safety: these helpers refuse to run unless the dev server was started with
 * NEXT_PUBLIC_SUPABASE_URL pointing at a dead local address (see
 * `supabaseIsStubbed`). Browser requests to that address are fulfilled here;
 * the server's own Supabase calls fail to connect. Nothing can reach a real
 * Supabase project, so no real account, session or row is ever touched.
 */
import type { BrowserContext, Route } from "@playwright/test";

export const STUB_SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
export const supabaseIsStubbed = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(STUB_SUPABASE_URL);

export const STUB_USER_ID = "e2e00000-0000-4000-8000-0000000000a1";
const STUB_EMAIL = "persistence.e2e@example.test";

const b64url = (text: string) => Buffer.from(text).toString("base64url");

function fakeSession() {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 365 * 24 * 3600;
  const user = {
    id: STUB_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: STUB_EMAIL,
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Persistence Tester" },
    created_at: "2026-01-01T00:00:00.000Z",
  };
  // Unsigned: only ever read by the browser client, never verified anywhere.
  const jwt = [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub: STUB_USER_ID, aud: "authenticated", role: "authenticated", email: STUB_EMAIL, exp: expiresAt, iat: now })),
    "e2e-signature",
  ].join(".");
  return {
    user,
    session: {
      access_token: jwt,
      token_type: "bearer",
      expires_in: expiresAt - now,
      expires_at: expiresAt,
      refresh_token: "e2e-refresh-token",
      user,
    },
  };
}

/** Make the browser client believe a customer is signed in. */
export async function signInStubCustomer(context: BrowserContext, baseURL: string): Promise<void> {
  if (!supabaseIsStubbed) throw new Error("Refusing to stub a customer: NEXT_PUBLIC_SUPABASE_URL is not a dead local address.");
  const { user, session } = fakeSession();
  const projectRef = new URL(STUB_SUPABASE_URL).hostname.split(".")[0];
  await context.addCookies([
    { name: `sb-${projectRef}-auth-token`, value: `base64-${b64url(JSON.stringify(session))}`, url: baseURL },
  ]);
  await context.route(`${STUB_SUPABASE_URL}/auth/v1/**`, (route) =>
    route.request().url().includes("/auth/v1/user") ? route.fulfill({ json: user }) : route.fulfill({ json: {} }),
  );
  await context.route(`${STUB_SUPABASE_URL}/rest/v1/**`, (route) => {
    const url = route.request().url();
    if (url.includes("/rest/v1/profiles")) {
      const profile = { full_name: "Persistence Tester", email: STUB_EMAIL, role: "customer", avatar_url: "" };
      const wantsObject = String(route.request().headers()["accept"] || "").includes("vnd.pgrst.object");
      return route.fulfill({ json: wantsObject ? profile : [profile] });
    }
    return route.fulfill({ json: [] });
  });
}

/** A data-URL photo the canvas can actually draw. */
export const STUB_PHOTO_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#7FA38B"/><text x="200" y="170" font-size="64" text-anchor="middle" fill="#fff">UP</text></svg>',
)}`;

type LoggedRequest = { method: string; id: string; revision: number | null; compact: boolean; status: number };

/**
 * An in-memory /api/customizations with the production route's ordering rules:
 * POST creates, PATCH refuses a lower clientRevision, and a compact body
 * (editorState without renderData) merges into the stored render data.
 */
export class StubCustomizationServer {
  readonly rows = new Map<string, any>();
  readonly log: LoggedRequest[] = [];
  /** Respond with this status to the next N design writes (POST/PATCH). */
  failWrites: { status: number; remaining: number } | null = null;
  /** Respond with this status to the next N GETs of a single design. */
  failReads: { status: number; remaining: number } | null = null;
  private sequence = 0;

  async install(context: BrowserContext): Promise<void> {
    await context.route("**/api/customizations**", (route) => this.handle(route));
    await context.route("**/api/customizer/upload", (route) => this.upload(route));
    await context.route("**/api/customizer/assets/resolve", (route) => this.resolve(route));
    await context.route("**/api/customizer/library**", (route) => route.fulfill({ json: { ok: true, assets: [] } }));
  }

  designWrites(): LoggedRequest[] {
    return this.log.filter((entry) => entry.method === "POST" || entry.method === "PATCH");
  }

  only(): any {
    const rows = [...this.rows.values()];
    if (rows.length !== 1) throw new Error(`expected exactly one stored design, found ${rows.length}`);
    return rows[0];
  }

  seed(row: Partial<any>): any {
    const id = row.id || this.newId();
    const stored = {
      id,
      productId: "e2e-fixture-product",
      templateId: "e2e-fixture-template",
      templateVersion: 1,
      status: "draft",
      cartItemId: "",
      values: {},
      selectedOptions: {},
      uploadedFiles: {},
      previewImages: {},
      renderData: {},
      updatedAt: new Date().toISOString(),
      ...row,
    };
    this.rows.set(id, stored);
    return stored;
  }

  private newId(): string {
    this.sequence += 1;
    return `c0ffee00-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
  }

  /** What the real server does on read: private photos get fresh signed URLs. */
  private signed(value: any): any {
    if (Array.isArray(value)) return value.map((item) => this.signed(item));
    if (!value || typeof value !== "object") return value;
    const out: any = {};
    for (const [key, child] of Object.entries(value)) out[key] = this.signed(child);
    if (out.assetReference && out.path) {
      out.url = STUB_PHOTO_URL;
      out.signedUrl = STUB_PHOTO_URL;
      out.src = STUB_PHOTO_URL;
    }
    return out;
  }

  private respond(route: Route, status: number, body: unknown) {
    return route.fulfill({ status, json: body, headers: { "Cache-Control": "no-store" } });
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const id = decodeURIComponent(url.pathname.split("/api/customizations/")[1] || "");
    const body = method === "POST" || method === "PATCH" ? request.postDataJSON() || {} : {};
    const revision = typeof body.clientRevision === "number" ? body.clientRevision : null;
    const compact = body.editorState !== undefined && body.renderData === undefined;
    const record = (status: number) => this.log.push({ method, id, revision, compact, status });

    if (method === "GET" && !id) {
      const productId = url.searchParams.get("productId");
      const rows = [...this.rows.values()]
        .filter((row) => !productId || row.productId === productId)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      record(200);
      return this.respond(route, 200, { ok: true, customizations: rows.slice(0, 1).map((row) => this.signed(row)) });
    }
    if (method === "GET") {
      if (this.failReads && this.failReads.remaining > 0) {
        this.failReads.remaining -= 1;
        record(this.failReads.status);
        return this.respond(route, this.failReads.status, { ok: false, error: "Simulated outage." });
      }
      const row = this.rows.get(id);
      record(row ? 200 : 404);
      return row ? this.respond(route, 200, { ok: true, customization: this.signed(row) }) : this.respond(route, 404, { ok: false, error: "Not found." });
    }
    if (this.failWrites && this.failWrites.remaining > 0) {
      this.failWrites.remaining -= 1;
      record(this.failWrites.status);
      return this.respond(route, this.failWrites.status, { ok: false, error: "Simulated outage." });
    }
    if (method === "POST") {
      const stored = this.seed({
        values: body.values || {},
        selectedOptions: body.selectedOptions || {},
        uploadedFiles: body.uploadedFiles || {},
        renderData: { ...(body.renderData || {}), clientRevision: revision ?? undefined },
        status: body.status || "draft",
      });
      record(200);
      return this.respond(route, 200, { ok: true, customization: this.signed(stored) });
    }
    if (method === "PATCH") {
      const row = this.rows.get(id);
      if (!row) {
        record(404);
        return this.respond(route, 404, { ok: false, error: "Not found." });
      }
      const storedRevision = Number(row.renderData?.clientRevision) || 0;
      if (revision !== null && revision < storedRevision) {
        record(409);
        return this.respond(route, 409, { ok: false, code: "stale-revision", serverRevision: storedRevision });
      }
      const renderData = compact
        ? { ...row.renderData, editorState: body.editorState, activePage: body.activePage || row.renderData?.activePage }
        : { ...(body.renderData || row.renderData) };
      if (revision !== null) renderData.clientRevision = revision;
      const next = {
        ...row,
        ...(body.values !== undefined ? { values: body.values } : {}),
        ...(body.selectedOptions !== undefined ? { selectedOptions: body.selectedOptions } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        renderData,
        updatedAt: new Date().toISOString(),
      };
      this.rows.set(id, next);
      record(200);
      return this.respond(route, 200, { ok: true, customization: this.signed(next) });
    }
    record(405);
    return this.respond(route, 405, { ok: false });
  }

  private async upload(route: Route): Promise<void> {
    this.sequence += 1;
    const n = this.sequence;
    const path = `${STUB_USER_ID}/customizer/editor-${n}.png`;
    const assetReference = {
      version: 1,
      assetId: `asset-${n}`,
      ownerId: STUB_USER_ID,
      bucket: "customer-uploads",
      storagePath: `${STUB_USER_ID}/customizer/original-${n}.png`,
      editorStoragePath: path,
      originalFileName: "photo.png",
      mimeType: "image/png",
      fileSize: 1024,
      width: 400,
      height: 300,
      createdAt: "2026-10-05T00:00:00.000Z",
    };
    return route.fulfill({
      json: {
        ok: true,
        file: {
          assetId: assetReference.assetId,
          ownerId: STUB_USER_ID,
          bucket: "customer-uploads",
          path,
          originalPath: assetReference.storagePath,
          name: "photo.png",
          type: "image/png",
          size: 1024,
          width: 400,
          height: 300,
          assetReference,
          url: STUB_PHOTO_URL,
          signedUrl: STUB_PHOTO_URL,
        },
      },
    });
  }

  private async resolve(route: Route): Promise<void> {
    const body = route.request().postDataJSON() || {};
    const references = Array.isArray(body.references) ? body.references : [];
    return route.fulfill({
      json: {
        ok: true,
        assets: references.map((reference: any) => ({
          reference,
          signedUrl: STUB_PHOTO_URL,
          expiresAt: "2099-01-01T00:00:00.000Z",
          variant: "editor",
        })),
      },
    });
  }
}
