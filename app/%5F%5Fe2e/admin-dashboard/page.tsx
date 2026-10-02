import { Suspense } from "react";
import { notFound } from "next/navigation";

import AdminDashboardFixture from "./AdminDashboardFixture";

/**
 * Internal admin-dashboard fixture. Mounts the REAL `AdminDashboardClient` with
 * deterministic in-browser data, so the admin UI can be reviewed and tested at
 * every viewport without an administrator session or a Supabase project.
 *
 * Same availability rule as the other /__e2e fixtures: always in non-production
 * builds, and in production only with ENABLE_CUSTOMIZER_E2E_FIXTURE=1. Nothing
 * here reaches the real admin API — every /api/admin request is answered by the
 * fixture's in-memory mock.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Dashboard E2E Fixture",
  robots: { index: false, follow: false },
};

function fixtureEnabled(): boolean {
  if (process.env.ENABLE_CUSTOMIZER_E2E_FIXTURE === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export default function AdminDashboardE2EFixturePage() {
  if (!fixtureEnabled()) notFound();
  return (
    <Suspense fallback={null}>
      <AdminDashboardFixture />
    </Suspense>
  );
}
