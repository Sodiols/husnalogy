import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { readJsonObject } from "@/lib/http/read-body";
import { ADDRESS_RATE_LIMIT, AddressError, addressInputSchema, createAddress, firstIssue, listAddresses } from "@/lib/account/addresses";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

// The session-scoped client: Row Level Security (user_id = auth.uid()) decides
// what this account can read and write. The service role is never used here.
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

// GET /api/account/addresses — the signed-in customer's own saved addresses.
export async function GET() {
  const { supabase, user } = await session();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });
  try {
    return Response.json({ ok: true, addresses: await listAddresses(supabase, user.id) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}

// POST /api/account/addresses — save a new address to the signed-in account.
export async function POST(request: Request) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  const { supabase, user } = await session();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401, headers: PRIVATE_HEADERS });
  const limited = rateLimit(request, { ...ADDRESS_RATE_LIMIT, identity: user.id });
  if (limited) return limited;
  const { body, response } = await readJsonObject(request, 16 * 1024);
  if (response) return response;
  const parsed = addressInputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: firstIssue(parsed.error) }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    return Response.json({ ok: true, address: await createAddress(supabase, user.id, parsed.data) }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
