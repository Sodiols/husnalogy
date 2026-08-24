// Public liveness endpoint for uptime monitors (UptimeRobot, Better Uptime,
// Pingdom, etc.). Deliberately minimal: no database round trip, no internal
// details, so it stays fast and reliable and never leaks anything sensitive.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, status: "healthy" }, { status: 200 });
}
