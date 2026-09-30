/** Required wrapper for every /api/admin mutation, including studio capabilities. */
import { getCurrentActor } from "@/lib/auth/roles";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { hasWorkerSecret } from "@/lib/security/worker-auth";
import { bodyErrorResponse, readBodyBytes } from "@/lib/http/read-body";
import { logEvent } from "@/lib/observability/logger";

export function withAdminMutation<Args extends any[]>(handler: (request: Request, ...args: Args) => Promise<Response>, options: { maxBytes?: number; studio?: boolean; worker?: boolean; logout?: boolean } = {}): (request: Request, ...args: Args) => Promise<Response> {
  return async (request: Request, ...args: Args) => {
    try {
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
      if (!(options.worker && hasWorkerSecret(request))) {
        const denied = rejectCrossSiteRequest(request);
        if (denied) return denied;
        // Logout may clear an expired or downgraded session. This exemption is
        // restricted to that exact route and keeps origin/body/method checks.
        if (!(options.logout && new URL(request.url).pathname === "/api/admin/logout")) {
          const actor = await getCurrentActor();
          if (!actor) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
          if (actor.role !== "admin" && !(options.studio && actor.role === "designer")) return Response.json({ ok: false, error: "Admin access required." }, { status: 403 });
        }
      }
      const bytes = await readBodyBytes(request, options.maxBytes ?? 256 * 1024);
      const bounded = new Request(request, { body: bytes.length ? bytes : null });
      return await handler(bounded, ...args);
    } catch (error) {
      const response = bodyErrorResponse(error);
      if (response) return response;
      logEvent("error", "admin.mutation_failed", { path: new URL(request.url).pathname, error });
      return Response.json({ ok: false, error: "The operation could not be completed." }, { status: 500 });
    }
  };
}
