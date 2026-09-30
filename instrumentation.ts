/**
 * Next.js server boot hook. Runs once per server process before any request.
 *
 * In production it validates the environment so a misconfigured Hostinger
 * deployment fails at `npm start` with the missing variable named, rather than
 * serving pages that 500 later. The build phase is skipped, so a build never
 * needs the server secrets.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  // Static generation during `next build` may boot this hook too.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { assertProductionEnv } = await import("./lib/env/server-env");
  assertProductionEnv();
}

/**
 * Every unhandled error in a route handler, server component or server
 * action. Reported to external monitoring (when SENTRY_DSN is set) with the
 * route only — never headers, cookies or bodies.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureError } = await import("./lib/observability/monitor");
  await captureError(error, {
    event: "server.unhandled_error",
    level: "error",
    tags: { route: context.routePath, routeType: context.routeType, method: request.method },
    extra: { path: String(request.path || "").split("?")[0] },
  });
}
