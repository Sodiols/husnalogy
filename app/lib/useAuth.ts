"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatSupabaseUser } from "./format-user";

let authState: any = {
  user: null,
  authLoading: true,
};
let initialized = false;
let seeded = false;
let supabaseClient: any = null;
let authSubscription: any = null;
let loadToken = 0;
const listeners = new Set<(state: any) => void>();

function emit(nextState) {
  authState = nextState;
  listeners.forEach((listener) => listener(authState));
}

// The server already knows the signed-in user from the session cookie (see
// app/layout.tsx), so we seed the client store with it before the first
// render instead of starting from `null` and waiting on an async Supabase
// round-trip. That avoids flashing the logged-out "Login" button on every
// page load/refresh. Only the very first call seeds anything; once the real
// auth listener takes over it owns the state.
function seedAuthState(initialUser) {
  if (seeded || initialized) return;
  seeded = true;
  if (initialUser) {
    authState = { user: initialUser, authLoading: false };
  }
}

async function loadUser(nextUser: any = undefined) {
  const currentToken = ++loadToken;

  try {
    if (!supabaseClient) supabaseClient = createClient();

    if (nextUser === undefined) {
      const {
        data: { user: currentUser },
      } = await supabaseClient.auth.getUser();
      nextUser = currentUser;
    }

    if (currentToken !== loadToken) return;

    if (!nextUser) {
      emit({ user: null, authLoading: false });
      return;
    }

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name,email,role,avatar_url")
      .eq("id", nextUser.id)
      .maybeSingle();

    if (currentToken !== loadToken) return;

    emit({
      user: formatSupabaseUser(nextUser, profile),
      authLoading: false,
    });
  } catch (error) {
    console.warn("Could not load Supabase auth state.", error?.message || error);
    if (currentToken === loadToken) emit({ user: null, authLoading: false });
  }
}

function initAuth() {
  if (initialized) return;
  initialized = true;
  supabaseClient = createClient();
  // If the server already resolved the user (see seedAuthState), skip the
  // redundant client-side re-fetch; the auth listener below stays attached
  // either way and keeps state fresh from here on.
  if (authState.authLoading) loadUser();

  const {
    data: { subscription },
  } = supabaseClient.auth.onAuthStateChange((_event, session) => {
    emit({ ...authState, authLoading: true });
    loadUser(session?.user || null);
  });

  authSubscription = subscription;
}

export function refreshAuthState() {
  if (!initialized) return;
  emit({ ...authState, authLoading: true });
  loadUser();
}

export default function useAuth(initialUser: any = undefined) {
  // The module-level store above is a browser-only optimization: one shared
  // auth state per tab. But this same "use client" module also executes on
  // the SERVER during SSR, and Node.js reuses a single module instance
  // across every concurrent request a dev/production server handles — so
  // mutating that shared state during SSR would leak one request's resolved
  // user into a completely different request's rendered HTML. On the
  // server we must always derive state fresh from this request's own
  // `initialUser` prop and never touch the shared singleton.
  if (typeof window === "undefined") {
    return initialUser
      ? { user: initialUser, authLoading: false }
      : { user: null, authLoading: false };
  }

  if (initialUser !== undefined) seedAuthState(initialUser);

  const [state, setState] = useState(authState);

  useEffect(() => {
    listeners.add(setState);
    initAuth();
    setState(authState);

    return () => {
      listeners.delete(setState);
      if (!listeners.size && authSubscription) {
        // Keep the Supabase subscription alive for route transitions; tearing it down
        // would force another auth bootstrap on the next page.
      }
    };
  }, []);

  return state;
}
