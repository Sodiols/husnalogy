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
  const [resetLinkState, setResetLinkState] = useState(isReset ? "checking" : "n/a");

  useEffect(() => {
    if (!isReset) return undefined;

    let cancelled = false;
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setResetLinkState(session ? "valid" : "invalid");
    });

    return () => {
      cancelled = true;
    };
  }, [isReset]);

  const title = isReset
    ? "Reset Password"
    : isForgot
      ? "Forgot Password"
      : isSignup
        ? "Create Account"
        : "Login with your email & password";

  const subtitle = isReset
    ? "Choose a new secure password for your account."
    : isForgot
      ? "Enter your email and we will send a password reset link."
      : isSignup
        ? "Create your account to save orders, wishlist items, and uploads."
        : "";

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
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

  return (
    <main className="grid min-h-[72vh] place-items-center px-4 py-12 text-[#303839]">
      <section className="w-full max-w-[460px] overflow-hidden rounded-none bg-white px-7 py-8 shadow-[0_28px_90px_rgba(48,56,57,0.06)] sm:px-9 sm:py-9">
        <img src="/Brand Kit/Logo-2.png" alt="Husnalogy" className="mx-auto h-12 w-auto object-contain" />
        <h1 className="mt-6 text-center font-display text-[1.45rem] font-medium leading-tight text-[#303839]">{title}</h1>
        {subtitle && <p className="mx-auto mt-2 max-w-sm text-center text-sm leading-6 text-[#303839]/65">{subtitle}</p>}

        {isReset && resetLinkState === "checking" && (
          <p className="mt-7 rounded-none bg-[#f8f6f1] px-4 py-3 text-center text-sm font-semibold text-[#303839]/70">
            Verifying your reset link...
          </p>
        )}

        {isReset && resetLinkState === "invalid" && (
          <div className="mt-7 space-y-4">
            <p className="rounded-none bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-600">
              This password reset link is invalid or has expired. Please request a new one.
            </p>
            <Link
              href="/forgot-password"
              className="block w-full rounded-none bg-[#303839] px-6 py-4 text-center text-sm font-extrabold uppercase tracking-[0.14em] text-white shadow-[0_12px_26px_rgba(48,56,57,0.12)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-[#434c4d] hover:shadow-[0_18px_38px_rgba(48,56,57,0.22)]"
            >
              Request New Link
            </Link>
          </div>
        )}

        {(!isReset || resetLinkState === "valid") && (
          <form onSubmit={submit} className="mt-7 space-y-5">
            {isSignup && <Field label="Full name" value={form.name} onChange={(value) => set("name", value)} autoComplete="name" />}
            {!isReset && <Field label="Email address" type="email" value={form.email} onChange={(value) => set("email", value)} autoComplete="email" />}
            {!isForgot && <Field label="Password" type="password" toggleable value={form.password} onChange={(value) => set("password", value)} autoComplete={isSignup || isReset ? "new-password" : "current-password"} />}
            {(isSignup || isReset) && <Field label="Confirm password" type="password" toggleable value={form.confirmPassword} onChange={(value) => set("confirmPassword", value)} autoComplete="new-password" />}

            {status.error && <p className="rounded-none bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{status.error}</p>}
            {status.message && <p className="rounded-none bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">{status.message}</p>}

            <button type="submit" disabled={status.loading || status.google} className="w-full rounded-none bg-[#303839] px-6 py-4 text-sm font-extrabold text-white transition-all duration-300 ease-out hover:bg-[#434c4d]  disabled:opacity-60 ">
              {status.loading ? "Please wait..." : isForgot ? "Send Reset Link" : isReset ? "Update Password" : isSignup ? "Create Account" : "Login"}
            </button>

            {!isForgot && !isReset && (
              <>
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-[#303839]/12" />
                  <span className="text-sm text-[#303839]/70">Or</span>
                  <span className="h-px flex-1 bg-[#303839]/12" />
                </div>

                <button type="button" onClick={googleLogin} disabled={status.loading || status.google} className="flex w-full items-center justify-center gap-3 rounded-none bg-[#303839] px-6 py-4 text-sm font-extrabold text-white transition-all duration-300 ease-out hover:bg-[#434c4d] disabled:opacity-60">
                  <GoogleIcon />
                  {status.google ? "Please wait..." : "Continue with Google"}
                </button>
              </>
            )}
          </form>
        )}

        <div className="mt-5 text-center text-sm text-[#303839]/60">
          {isSignup ? (
            <Link className="font-bold text-black underline" href={`/login?next=${encodeURIComponent(next)}`}>Already have an account?</Link>
          ) : isForgot || isReset ? (
            <Link className="font-bold text-black underline" href={`/login?next=${encodeURIComponent(next)}`}>Back to login</Link>
          ) : (
            <div className="flex items-center justify-center gap-4">
              <Link className="font-bold text-black underline" href={`/signup?next=${encodeURIComponent(next)}`}>Create account</Link>
              <Link className="font-bold text-black underline" href="/forgot-password">Forgot password?</Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function Field({ label, type = "text", value, onChange, autoComplete, toggleable = false }) {
  const [visible, setVisible] = useState(false);
  const inputType = toggleable ? (visible ? "text" : "password") : type;

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-[#303839]">{label} *</span>
      <div className="relative">
        <input
          type={inputType}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          className={`h-12 w-full border-b border-[#303839]/24 bg-transparent px-0 text-sm text-black outline-none transition focus:border-[#303839] ${toggleable ? "pr-12" : ""}`}
        />

        {toggleable && (
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "Hide password" : "Show password"}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#303839]/50 transition hover:text-[#303839]"
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    </label>
  );
}

function EyeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8s11 8 11 8s-4 8-11 8s-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20s20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4C16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.3 35.1 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-7.8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4 5.6l6.2 5.2C36.9 39.4 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
