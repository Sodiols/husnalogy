import { requireAdmin } from "@/lib/auth/admin-server";
import { getSettings } from "@/lib/settings";
import { isValidEmail } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const recipient = String(body.recipient || "").trim();
  const settings = await getSettings();
  const email = settings.email || {};

  if (!isValidEmail(recipient)) {
    return Response.json({ ok: false, error: "Enter a valid test recipient email." }, { status: 400 });
  }

  if (!email.provider && !email.smtpHost) {
    return Response.json(
      { ok: false, error: "Email provider is not configured yet. Save provider or SMTP settings first." },
      { status: 400 }
    );
  }

  // No transactional email provider is wired into the application yet (see
  // HOSTINGER_DEPLOYMENT.md, "Transactional email"). Saved SMTP settings are
  // stored but nothing sends with them, so this must not report success.
  return Response.json(
    {
      ok: false,
      configured: false,
      error: "Transactional email is not connected yet. Settings are saved, but no email was sent.",
    },
    { status: 501 }
  );
}
