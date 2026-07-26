import { Suspense } from "react";
import { notFound } from "next/navigation";
import AdminDashboardClient from "./admin-dashboard-client";
import { getCurrentAdmin } from "@/lib/auth/admin-server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Dashboard",
};

export default async function AdminDashboardPage() {
  const admin = await getCurrentAdmin();

  if (!admin) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <AdminDashboardClient />
    </Suspense>
  );
}
