"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPostLoginRedirectPath, getSafeRedirectPath } from "@/app/lib/auth";

function parseHashParams(hash) {
  return new URLSearchParams(String(hash || "").replace(/^#/, ""));
}

function friendlyCallbackError(err) {
  const message = String(err?.message || err || "");
  if (/expired|invalid/i.test(message)) {
    return "This link is invalid or has expired. Please request a new one.";
  }
  return message || "Could not complete sign-in.";
}

function AuthCallbackFinishInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const next = getSafeRedirectPath(searchParams.get("next") || "/");
      const hashParams = parseHashParams(window.location.hash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const providerError =
        hashParams.get("error_description") || hashParams.get("error");

      if (providerError) {
        if (!cancelled) router.replace(`/login?error=${encodeURIComponent(providerError)}`);
        return;
      }

      if (!accessToken || !refreshToken) {
        if (!cancelled) router.replace(`/login?error=${encodeURIComponent("Could not complete sign-in.")}`);
        return;
      }

      const supabase = createClient();

      try {
        const { data, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) throw sessionError;

        const redirectPath = await getPostLoginRedirectPath(data?.user, next);
        if (!cancelled) {
          router.replace(redirectPath);
          router.refresh();
        }
        return;
      } catch (err: any) {
        if (!cancelled) {
          const friendly = friendlyCallbackError(err);
          console.error("Could not complete sign-in:", err?.message || err);
          setError(friendly);
          router.replace(`/login?error=${encodeURIComponent(friendly)}`);
        }
        return;
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <main className="grid min-h-[60vh] place-items-center bg-[#f8f6f1] px-4 text-center text-[#303839]">
      <p className="text-sm font-semibold text-[#303839]/70">
        {error || "Signing you in..."}
      </p>
    </main>
  );
}

export default function AuthCallbackFinishPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackFinishInner />
    </Suspense>
  );
}
