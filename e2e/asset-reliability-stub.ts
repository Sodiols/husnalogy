/**
 * A stand-in for Supabase Storage signed URLs, for the image reliability specs.
 *
 * Images are served from same-origin `/__e2e-assets/<assetId>/<variant>.png`
 * URLs carrying a `token` whose JWT `exp` claim is enforced exactly like
 * Storage does: an expired token is refused. `/api/customizer/assets/sign` is
 * answered here too, issuing URLs with a short lifetime, so a "session longer
 * than the signing period" takes seconds instead of an hour. Nothing reaches a
 * real Storage bucket.
 */
import sharp from "sharp";
import type { BrowserContext, Route } from "@playwright/test";

export type EditorMode = "ok" | "404" | "corrupt" | "tiny";

const jwt = (expSeconds: number) => `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.s`;

export function assetUrl(assetId: string, variant: "editor" | "original" | "thumbnail", expiresAtMs: number, serial = 0) {
  return `/__e2e-assets/${assetId}/${variant}.png?v=${serial}&token=${jwt(Math.floor(expiresAtMs / 1000))}`;
}

export class AssetStub {
  /** Lifetime of every URL this stub issues. */
  ttlMs = 10_000;
  editorMode: EditorMode = "ok";
  offline = false;
  readonly signRequests: Array<{ assets: Array<{ assetId: string; variant: string }>; reason?: string; productId?: string }> = [];
  readonly imageRequests: string[] = [];
  private serial = 0;
  private images: Record<string, Buffer> = {};

  async install(context: BrowserContext) {
    this.images = {
      // 2000px editor and 3000px original: both sharp at the studio's sizes.
      editor: await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#2f6fb0" } }).png().toBuffer(),
      original: await sharp({ create: { width: 3000, height: 2250, channels: 3, background: "#1f8f4f" } }).png().toBuffer(),
      tiny: await sharp({ create: { width: 160, height: 120, channels: 3, background: "#aa3333" } }).png().toBuffer(),
      thumbnail: await sharp({ create: { width: 480, height: 360, channels: 3, background: "#aaaaaa" } }).png().toBuffer(),
    };
    await context.route("**/__e2e-assets/**", (route) => this.serve(route));
    await context.route("**/api/customizer/assets/sign", (route) => this.sign(route));
  }

  private async serve(route: Route) {
    if (this.offline) return route.abort("internetdisconnected");
    const url = new URL(route.request().url());
    this.imageRequests.push(url.pathname);
    const token = url.searchParams.get("token") || "";
    const exp = Number(JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString() || "{}").exp || 0) * 1000;
    // Storage refuses an expired token.
    if (!exp || exp < Date.now()) return route.fulfill({ status: 400, json: { statusCode: "403", error: "InvalidJWT", message: "\"exp\" claim timestamp check failed" } });
    const variant = url.pathname.split("/").pop()!.replace(".png", "");
    if (variant === "editor") {
      if (this.editorMode === "404") return route.fulfill({ status: 404, json: { statusCode: "404", error: "not_found" } });
      if (this.editorMode === "corrupt") return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("this is not an image") });
      if (this.editorMode === "tiny") return route.fulfill({ status: 200, contentType: "image/png", body: this.images.tiny });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: this.images[variant] || this.images.editor, headers: { "Cache-Control": "private, max-age=3600" } });
  }

  private async sign(route: Route) {
    if (this.offline) return route.abort("internetdisconnected");
    const body = route.request().postDataJSON() || {};
    this.signRequests.push({ assets: body.assets || [], reason: body.reason, productId: body.productId });
    this.serial += 1;
    const expiresAt = Date.now() + this.ttlMs;
    return route.fulfill({
      json: {
        ok: true,
        assets: (body.assets || []).map((asset: any) => ({
          assetId: asset.assetId,
          variant: asset.variant,
          url: assetUrl(asset.assetId, asset.variant === "original" ? "original" : "editor", expiresAt, this.serial),
          expiresAt: new Date(expiresAt).toISOString(),
        })),
      },
    });
  }
}

/** The JWT expiry (ms) inside an issued URL. */
export function urlExpiry(url: string): number {
  const token = new URL(url, "http://local").searchParams.get("token") || "";
  try {
    return Number(JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString()).exp) * 1000;
  } catch {
    return 0;
  }
}
