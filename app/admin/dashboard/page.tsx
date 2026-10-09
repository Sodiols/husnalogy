import { Suspense } from "react";
import { notFound } from "next/navigation";
import AdminDashboardClient from "./admin-dashboard-client";
import { StudioActorProvider } from "./design-builder/studio-actor";
import { getCurrentAdmin } from "@/lib/auth/admin-server";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = privatePageMetadata("Admin Dashboard");

export default async function AdminDashboardPage() {
  const admin = await getCurrentAdmin();

  if (!admin) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <StudioActorProvider actorId={admin.id}>
        <AdminDashboardClient />
      </StudioActorProvider>
    </Suspense>
  );
}
