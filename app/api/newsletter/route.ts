import { createSubscriber } from "@/lib/newsletter";
import { rateLimit, rejectLargeRequest } from "@/lib/security/rate-limit";
import { getSettings } from "@/lib/settings";
import { LAUNCH_FEATURES } from "@/lib/launch-config";
import { readJsonObject } from "@/lib/http/read-body";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";

export async function POST(request) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  try {
    if (!LAUNCH_FEATURES.marketingEmail) {
      return Response.json({ ok: false, error: "Newsletter subscriptions are not available at launch." }, { status: 403 });
    }
    const largeRequest = rejectLargeRequest(request, 4 * 1024);
    if (largeRequest) return largeRequest;

    const limited = rateLimit(request, {
      name: "newsletter",
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const settings = await getSettings();

    if (!settings.preferences.newsletterEnabled) {
      return Response.json(
        { ok: false, error: "Newsletter subscriptions are currently disabled." },
        { status: 403 }
      );
    }

    const bodyRead36 = await readJsonObject(request, 4 * 1024);
    if (bodyRead36.response) return bodyRead36.response;
    const body = bodyRead36.body;
    const result = await createSubscriber(body);

    if (!result.ok) {
      return Response.json({ ok: false, errors: result.errors }, { status: 400 });
    }

    return Response.json({ ok: true, subscriber: result.subscriber }, { status: 201 });
  } catch (error) {
    console.error("Newsletter subscription failed:", error);
    return Response.json({ ok: false, error: "Could not save your subscription." }, { status: 500 });
  }
}
