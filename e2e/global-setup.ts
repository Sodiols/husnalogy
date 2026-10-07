/**
 * Local deterministic mode only (see playwright.config.ts): start the
 * server-side Supabase stand-in for the whole run, and stop it afterwards.
 */
import { startSupabaseHttpStub, stopSupabaseHttpStub } from "./supabase-http-stub";

export default async function globalSetup() {
  await startSupabaseHttpStub();
  return async () => {
    await stopSupabaseHttpStub();
  };
}
