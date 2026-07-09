import { createContactMessage } from "@/lib/messages";
import { rateLimit, rejectLargeRequest } from "@/lib/security/rate-limit";

export async function POST(request) {
  try {
    const largeRequest = rejectLargeRequest(request, 24 * 1024);
    if (largeRequest) return largeRequest;

    const limited = rateLimit(request, {
      name: "contact",
      limit: 6,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json();
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
