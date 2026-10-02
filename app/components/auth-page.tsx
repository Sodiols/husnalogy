"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  createUserWithEmailAndPassword,
  getPostLoginRedirectPath,
  getSafeRedirectPath,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithGoogle,
  updateUserPassword,
} from "../lib/auth";
import {
  AuthDivider,
  AuthField,
  AuthNotice,
  GoogleButton,
  firstErrorField,
  useAuthIds,
  validateAuthFields,
  type AuthFieldErrors,
} from "./auth-ui";

function friendlyError(error) {
  const message = String(error?.message || "");
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/already registered|already exists/i.test(message)) return "This email already has an account.";
  if (/weak password/i.test(message)) return "Password must be at least 6 characters.";
  if (/provider.*disabled/i.test(message)) return "Google login is not enabled yet.";
  if (/session missing|not authenticated|jwt expired/i.test(message)) {
    return "Your reset link has expired. Please request a new one.";
  }
  return message || "Something went wrong. Please try again.";
}

export default function AuthPage({ mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeRedirectPath(searchParams.get("next") || "/");
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [status, setStatus] = useState(() => ({
    loading: false,
    google: false,
    error: searchParams.get("error") || "",
    message: "",
  }));
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const ids = useAuthIds();
  const [resetLinkState, setResetLinkState] = useState(isReset ? "checking" : "n/a");
  // Read as primitives: the object returned by useSearchParams() is not
  // referentially stable, so depending on it would re-run (and cancel) the
  // verification effect below on every render.
  const resetTokenHash = searchParams.get("token_hash");
  const resetOtpType = searchParams.get("type");

  useEffect(() => {
    if (!isReset) return undefined;

    let cancelled = false;
    let timeoutId;
    const supabase = createClient();

    // Supabase's browser client processes an implicit-flow URL hash
    // asynchronously after load and emits PASSWORD_RECOVERY/SIGNED_IN when it
    // succeeds. Subscribing before the session check matters: a bare
    // getSession() can win that race and report a perfectly good reset link as
    // expired.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (session) setResetLinkState("valid");
      else if (event === "SIGNED_OUT") setResetLinkState("invalid");
    });

    async function verifyResetLink() {
      // A recovery link can also land straight on this page carrying
      // ?token_hash=...&type=recovery, when the Supabase email template points
      // here instead of at /auth/callback.
      if (resetTokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          type: resetOtpType || "recovery",
          token_hash: resetTokenHash,
        });
        if (!cancelled) setResetLinkState(error ? "invalid" : "valid");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (session) {
        setResetLinkState("valid");
        return;
      }

      // No session yet. If there are tokens still being processed out of the
      // URL hash, let the listener above settle it rather than calling the
      // link dead; otherwise there is nothing to wait for.
      const hasPendingHashTokens =
        typeof window !== "undefined" && /access_token=/.test(window.location.hash);

      if (!hasPendingHashTokens) {
        setResetLinkState("invalid");
        return;
      }

      timeoutId = setTimeout(() => {
        if (!cancelled) {
          setResetLinkState((current) => (current === "checking" ? "invalid" : current));
        }
      }, 8000);
    }

    verifyResetLink();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      subscription?.unsubscribe();
    };
  }, [isReset, resetTokenHash, resetOtpType]);

  const title = isReset
    ? "Choose a new password"
    : isForgot
      ? "Reset your password"
      : isSignup
        ? "Create your account"
        : "Welcome back";

  const subtitle = isReset
    ? "Choose a new password for your Husnalogy account."
    : isForgot
      ? "Enter the email you use for Husnalogy and we will send you a reset link."
      : isSignup
        ? "Save your designs, orders and wishlist in one place."
        : "Sign in to see your orders, saved designs and wishlist.";

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  async function submit(event) {
    event.preventDefault();

    const errors = validateAuthFields({
      ...form,
      requireName: isSignup,
      requireEmail: !isReset,
      requirePassword: !isForgot,
      newPassword: isSignup || isReset,
    });
    setFieldErrors(errors);
    const firstInvalid = firstErrorField(errors);
    if (firstInvalid) {
      setStatus({ loading: false, google: false, error: "", message: "" });
      document.getElementById(ids[firstInvalid])?.focus();
      return;
    }

    setStatus({ loading: true, google: false, error: "", message: "" });

    try {
      if (isSignup) {
        if (!form.name.trim()) throw new Error("Please enter your full name.");
        if (form.password !== form.confirmPassword) throw new Error("Passwords do not match.");
        const data = await createUserWithEmailAndPassword(form.email.trim(), form.password, form.name.trim());
        if (!data?.session) {
          setStatus({
            loading: false,
            google: false,
            error: "",
            message: "Account created. Please check your email to confirm your login.",
          });
          return;
        }
        router.replace(next);
        router.refresh();
        return;
      }

      if (isForgot) {
        await sendPasswordResetEmail(form.email.trim());
        setStatus({ loading: false, google: false, error: "", message: "If an account exists, a reset link has been sent." });
        return;
      }

      if (isReset) {
        if (form.password.length < 6) throw new Error("Password must be at least 6 characters.");
        if (form.password !== form.confirmPassword) throw new Error("Passwords do not match.");
        await updateUserPassword(form.password);
        setStatus({
          loading: false,
          google: false,
          error: "",
          message: "Password updated. Signing you in...",
        });
        router.replace("/account");
        router.refresh();
        return;
      }

      const user = await signInWithEmailAndPassword(form.email.trim(), form.password);
      const redirectPath = await getPostLoginRedirectPath(user, next);
      router.replace(redirectPath);
      router.refresh();
    } catch (error) {
      setStatus({ loading: false, google: false, error: friendlyError(error), message: "" });
    }
  }

  async function googleLogin() {
    setStatus({ loading: false, google: true, error: "", message: "" });

    try {
      await signInWithGoogle(next);
    } catch (error) {
      setStatus({ loading: false, google: false, error: friendlyError(error), message: "" });
    }
  }

  const nextQuery = `?next=${encodeURIComponent(next)}`;

  return (
    <main className="bg-cream text-ink">
      <div className="page-container grid min-h-[72vh] place-items-center py-12 sm:py-16">
        <section aria-labelledby={ids.title} className="w-full max-w-[440px] rounded-[10px] border border-line bg-white px-6 py-8 sm:px-8">
          <img src="/Brand Kit/Logo-5.png" alt="Husnalogy" className="mx-auto h-9 w-auto object-contain" />

          {!isForgot && !isReset && (
            <nav className="mt-6 flex gap-1 rounded-[8px] border border-line bg-cream p-1" aria-label="Account">
              <Link
                href={`/login${nextQuery}`}
                aria-current={!isSignup ? "page" : undefined}
                className={`flex min-h-10 flex-1 items-center justify-center rounded-[6px] px-3 text-[14px] font-semibold transition-colors ${!isSignup ? "bg-white text-ink shadow-[0_1px_2px_rgba(48,56,57,0.12)]" : "text-muted hover:text-ink"}`}
              >
                Sign in
              </Link>
              <Link
                href={`/signup${nextQuery}`}
                aria-current={isSignup ? "page" : undefined}
                className={`flex min-h-10 flex-1 items-center justify-center rounded-[6px] px-3 text-[14px] font-semibold transition-colors ${isSignup ? "bg-white text-ink shadow-[0_1px_2px_rgba(48,56,57,0.12)]" : "text-muted hover:text-ink"}`}
              >
                Create account
              </Link>
            </nav>
          )}

          <div className="mt-6 text-center">
            <h1 id={ids.title} className="font-display text-[2rem] font-medium leading-tight text-ink">
              {title}
            </h1>
            <p className="mx-auto mt-2 max-w-[340px] text-[14px] leading-6 text-muted">{subtitle}</p>
          </div>

          {isReset && resetLinkState === "checking" && (
            <div className="mt-6">
              <AuthNotice tone="info">Checking your reset link…</AuthNotice>
            </div>
          )}

          {isReset && resetLinkState === "invalid" && (
            <div className="mt-6 space-y-4">
              <AuthNotice tone="error">This password reset link is invalid or has expired. Please request a new one.</AuthNotice>
              <Link href="/forgot-password" className="btn btn-primary btn-lg btn-block">
                Request a new link
              </Link>
            </div>
          )}

          {(!isReset || resetLinkState === "valid") && (
            <form onSubmit={submit} noValidate className="mt-6 space-y-4">
              {isSignup && (
                <AuthField id={ids.name} label="Name" value={form.name} onChange={(value) => set("name", value)} autoComplete="name" error={fieldErrors.name} />
              )}
              {!isReset && (
                <AuthField
                  id={ids.email}
                  label="Email address"
                  type="email"
                  value={form.email}
                  onChange={(value) => set("email", value)}
                  autoComplete="email"
                  error={fieldErrors.email}
                />
              )}
              {!isForgot && (
                <AuthField
                  id={ids.password}
                  label={isReset ? "New password" : "Password"}
                  password
                  value={form.password}
                  onChange={(value) => set("password", value)}
                  autoComplete={isSignup || isReset ? "new-password" : "current-password"}
                  hint={isSignup || isReset ? "Use at least 6 characters." : ""}
                  error={fieldErrors.password}
                />
              )}
              {(isSignup || isReset) && (
                <AuthField
                  id={ids.confirmPassword}
                  label="Confirm password"
                  password
                  value={form.confirmPassword}
                  onChange={(value) => set("confirmPassword", value)}
                  autoComplete="new-password"
                  error={fieldErrors.confirmPassword}
                />
              )}

              {!isSignup && !isForgot && !isReset && (
                <div className="-mt-1 text-right">
                  <Link href="/forgot-password" className="btn btn-text text-[13px]">
                    Forgot your password?
                  </Link>
                </div>
              )}

              {status.error && <AuthNotice tone="error">{status.error}</AuthNotice>}
              {status.message && <AuthNotice tone="success">{status.message}</AuthNotice>}

              <button type="submit" disabled={status.loading || status.google} aria-busy={status.loading} className="btn btn-primary btn-lg btn-block">
                {status.loading
                  ? "Please wait…"
                  : isForgot
                    ? "Send reset link"
                    : isReset
                      ? "Update password"
                      : isSignup
                        ? "Create account"
                        : "Sign in"}
              </button>
            </form>
          )}

          {!isForgot && !isReset && (
            <div className="mt-5 space-y-5">
              <AuthDivider label="or" />
              <GoogleButton onClick={googleLogin} loading={status.google} disabled={status.loading || status.google} />
            </div>
          )}

          {(isForgot || isReset) && (
            <p className="mt-5 text-center text-[14px] text-muted">
              Remembered it?{" "}
              <Link href={`/login${nextQuery}`} className="btn btn-text text-[14px] font-semibold">
                Back to sign in
              </Link>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
