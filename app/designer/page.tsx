import { notFound, redirect } from "next/navigation";

import { canAccessStudio, getCurrentActor } from "@/lib/auth/roles";
import DesignerWorkspaceClient from "./designer-workspace-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Designer workspace",
  robots: { index: false, follow: false },
};

/**
 * The designer's entire surface.
 *
 * Deliberately NOT the admin dashboard with things hidden: a designer never
 * loads the admin shell, so there is no navigation to orders, customers,
 * revenue, settings or users to hide in the first place. The API routes enforce
 * the same boundary independently — this page is the experience, not the
 * security.
 *
 * An admin is sent to their own dashboard rather than shown a reduced view of
 * their own product catalogue.
 */
export default async function DesignerPage() {
  const actor = await getCurrentActor();

  // Not signed in, or a customer: the workspace simply does not exist for them.
  // 404 rather than 403 so the route reveals nothing about what it is.
  if (!actor || !canAccessStudio(actor)) notFound();
  if (actor.role === "admin") redirect("/admin/dashboard");

  return <DesignerWorkspaceClient designer={{ id: actor.id, name: actor.name, email: actor.email }} />;
}
