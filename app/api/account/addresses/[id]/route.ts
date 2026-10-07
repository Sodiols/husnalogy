import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { readJsonObject } from "@/lib/http/read-body";
import { ADDRESS_RATE_LIMIT, AddressError, addressPatchSchema, deleteAddress, firstIssue, updateAddress } from "@/lib/account/addresses";

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
  if (error instanceof AddressError) return Response.json({ ok: false, error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
  return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500, headers: PRIVATE_HEADERS });
}

// PATCH /api/account/addresses/[id] — edit, or make default, one of the caller's own addresses.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  const { id } = await params;
  const { supabase, user } = await session();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });
  const limited = rateLimit(request, { ...ADDRESS_RATE_LIMIT, identity: user.id });
  if (limited) return limited;
  const { body, response } = await readJsonObject(request, 16 * 1024);
  if (response) return response;
  const parsed = addressPatchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: firstIssue(parsed.error) }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    return Response.json({ ok: true, address: await updateAddress(supabase, user.id, id, parsed.data) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}

// DELETE /api/account/addresses/[id] — remove one of the caller's own addresses.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  const { id } = await params;
  const { supabase, user } = await session();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });
  const limited = rateLimit(request, { ...ADDRESS_RATE_LIMIT, identity: user.id });
  if (limited) return limited;
  try {
    await deleteAddress(supabase, user.id, id);
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
