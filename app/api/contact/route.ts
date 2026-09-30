import { createContactMessage } from "@/lib/messages";
import { rateLimitDistributed, rejectLargeRequest } from "@/lib/security/rate-limit";
import { readJsonObject } from "@/lib/http/read-body";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";

export async function POST(request) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  try {
    const largeRequest = rejectLargeRequest(request, 24 * 1024);
    if (largeRequest) return largeRequest;

    const limited = await rateLimitDistributed(request, {
      name: "contact",
      limit: 6,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const bodyRead31 = await readJsonObject(request, 24 * 1024);
    if (bodyRead31.response) return bodyRead31.response;
    const body = bodyRead31.body;
    const result = await createContactMessage(body);

    if (!result.ok) {
      return Response.json({ ok: false, errors: result.errors }, { status: 400 });
    }

    return Response.json({ ok: true, message: result.message }, { status: 201 });
  } catch (error) {
    console.error("Contact message failed:", error);
    return Response.json({ ok: false, error: "Could not send your message." }, { status: 500 });
  }
}
