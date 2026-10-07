import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { readJsonObject } from "@/lib/http/read-body";
import { ProfileError, profilePatchSchema, readProfile, updateProfile } from "@/lib/account/profile";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function failure(error: unknown) {
  if (error instanceof ProfileError) return Response.json({ ok: false, error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
  return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500, headers: PRIVATE_HEADERS });
}

// GET /api/account/profile — the signed-in customer's own profile.
export async function GET() {
  const { supabase, user } = await session();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });
  try {
    return Response.json({ ok: true, profile: await readProfile(supabase, createServiceRoleClient(), user) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}

// PATCH /api/account/profile — name and phone. The session client writes, so
// RLS (id = auth.uid()) decides; role and email are trigger-protected.
export async function PATCH(request: Request) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  const { supabase, user } = await session();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });
  const limited = rateLimit(request, { name: "account-profile", limit: 30, windowMs: 10 * 60 * 1000, identity: user.id });
  if (limited) return limited;
  const { body, response } = await readJsonObject(request, 8 * 1024);
  if (response) return response;
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message || "The profile is invalid." }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    await updateProfile(supabase, user.id, parsed.data);
    return Response.json({ ok: true, profile: await readProfile(supabase, createServiceRoleClient(), user) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
