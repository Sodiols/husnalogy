import { withAdminMutation } from "@/lib/security/admin-mutation";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const POST = withAdminMutation(async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}, { maxBytes: 1024, logout: true });
