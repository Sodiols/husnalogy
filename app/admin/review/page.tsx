import { notFound } from "next/navigation";

import { getCurrentAdmin } from "@/lib/auth/admin-server";
import AdminReviewClient from "./admin-review-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Review queue",
  robots: { index: false, follow: false },
};

/**
 * The admin's review queue for designer submissions.
 *
 * A separate surface rather than another section inside the 5,000-line
 * dashboard client: it is additive, it cannot regress anything already there,
 * and the publishing it triggers goes through the SAME endpoints the dashboard
 * uses, so there is one publish implementation.
 */
export default async function AdminReviewPage() {
  const admin = await getCurrentAdmin();
  if (!admin) notFound();

  return <AdminReviewClient />;
}
