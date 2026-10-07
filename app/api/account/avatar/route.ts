import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { readFormData } from "@/lib/http/read-body";
import { AVATAR_MAX_UPLOAD_BYTES, ProfileError, removeAvatar, replaceAvatar } from "@/lib/account/profile";
import { logEvent, requestIdFrom } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

async function sessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

function failure(error: unknown, request: Request, userId: string) {
  if (error instanceof ProfileError) return Response.json({ ok: false, error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
  logEvent("error", "account.avatar_failed", { requestId: requestIdFrom(request), userId, error });
  return Response.json({ ok: false, error: "Your photo could not be saved. Please try again." }, { status: 500, headers: PRIVATE_HEADERS });
}

// POST /api/account/avatar — replace the signed-in customer's profile photo.
// The session is verified first; the file is decoded and re-encoded on the
// server and written with the service role into the account's own folder of
// the private customer-avatars bucket.
export async function POST(request: Request) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  const user = await sessionUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });
  const limited = await rateLimitDistributed(request, { name: "account-avatar", limit: 20, windowMs: 10 * 60 * 1000, identity: user.id });
  if (limited) return limited;
  const upload = await readFormData(request, AVATAR_MAX_UPLOAD_BYTES + 64 * 1024);
  if (upload.response) {
    return upload.response.status === 413
      ? Response.json({ ok: false, error: "Photos must be 8 MB or smaller." }, { status: 413, headers: PRIVATE_HEADERS })
      : upload.response;
  }
  const file = upload.form?.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, error: "Choose a photo to upload." }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const avatarUrl = await replaceAvatar(createServiceRoleClient(), user.id, Buffer.from(await file.arrayBuffer()));
    return Response.json({ ok: true, avatarUrl }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error, request, user.id);
  }
}

// DELETE /api/account/avatar — remove the uploaded profile photo.
export async function DELETE(request: Request) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  const user = await sessionUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });
  const limited = await rateLimitDistributed(request, { name: "account-avatar", limit: 20, windowMs: 10 * 60 * 1000, identity: user.id });
  if (limited) return limited;
  try {
    await removeAvatar(createServiceRoleClient(), user.id);
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error, request, user.id);
  }
}
