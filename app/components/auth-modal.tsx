"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AuthDivider,
  AuthField,
  AuthModeSwitch,
  AuthNotice,
  GoogleButton,
  firstErrorField,
  useAuthIds,
  validateAuthFields,
  type AuthFieldErrors,
} from "./auth-ui";

import {
  createUserWithEmailAndPassword,
  getPostLoginRedirectPath,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithGoogle,
} from "../lib/auth";

const MODES = {
  LOGIN: "login",
  SIGNUP: "signup",
  FORGOT: "forgot",
};

const AUTH_ERRORS = {
  email_exists: "This email already has an account.",
  user_already_exists: "This email already has an account.",
  invalid_email: "Please enter a valid email address.",
  weak_password: "Password must be at least 6 characters.",
  invalid_credentials: "Email or password is incorrect.",
  email_not_confirmed: "Please confirm your email before logging in.",
  too_many_requests: "Too many attempts. Please try again later.",
  over_email_send_rate_limit: "Please wait a moment before requesting another email.",
  provider_disabled: "Google login is not enabled yet.",
};

function getAuthError(error) {
  const code = error?.code || error?.name || "";
  const message = String(error?.message || "");
  if (AUTH_ERRORS[code]) return AUTH_ERRORS[code];
  if (/invalid login credentials/i.test(message)) return AUTH_ERRORS.invalid_credentials;
  if (/already registered|already exists/i.test(message)) return AUTH_ERRORS.email_exists;
  return message || "Something went wrong. Please try again.";
}

export default function AuthModal({ open, setOpen, mode, setMode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  const isSignup = mode === MODES.SIGNUP;
  const isForgot = mode === MODES.FORGOT;
  const ids = useAuthIds();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    setName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setFieldErrors({});
    setLoading(false);
    setGoogleLoading(false);
    setMessage("");
    setMessageType("");
  }, [open, mode]);

  if (!open) return null;

  const edit = (key: keyof AuthFieldErrors, setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  async function handleSubmit(event) {
    event.preventDefault();

    const errors = validateAuthFields({
      name,
      email,
      password,
      confirmPassword,
      requireName: isSignup,
      requirePassword: !isForgot,
      newPassword: isSignup,
    });
    setFieldErrors(errors);

    const firstInvalid = firstErrorField(errors);
    if (firstInvalid) {
      setMessage("");
      setMessageType("");
      document.getElementById(ids[firstInvalid])?.focus();
      return;
    }

    setLoading(true);
    setMessage("");
    setMessageType("");

    try {
      if (isForgot) {
        await sendPasswordResetEmail(email.trim());

        setMessage("If an account exists, a reset link has been sent.");
        setMessageType("success");
        return;
      }

      if (isSignup) {
        const data = await createUserWithEmailAndPassword(
          email.trim(),
          password,
          name.trim()
        );

        if (!data?.session) {
          setMessage("Account created. Please check your email to confirm your login.");
          setMessageType("success");
          return;
        }

        setOpen(false);
        router.push("/");
        return;
      }

      const user = await signInWithEmailAndPassword(email.trim(), password);
      const redirectPath = await getPostLoginRedirectPath(user);
      setOpen(false);
      router.push(redirectPath);
    } catch (error) {
      setMessage(getAuthError(error));
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    setMessage("");
    setMessageType("");

    try {
      await signInWithGoogle();
      setOpen(false);
    } catch (error) {
      setMessage(getAuthError(error));
      setMessageType("error");
    } finally {
      setGoogleLoading(false);
    }
  }

  const title = isForgot ? "Reset your password" : isSignup ? "Create your account" : "Welcome back";
  const subtitle = isForgot
    ? "Enter the email you use for Husnalogy and we will send you a reset link."
    : isSignup
      ? "Save your designs, orders and wishlist in one place."
      : "Sign in to see your orders, saved designs and wishlist.";

  return (
    <>
      <div className="fixed inset-0 z-[3000] bg-ink/50" onClick={() => setOpen(false)} aria-hidden="true" />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        className="fixed left-1/2 top-1/2 z-[3001] w-[calc(100%-24px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2"
      >
        <div className="relative max-h-[92vh] overflow-y-auto rounded-[10px] border border-line bg-white px-6 pb-7 pt-6 shadow-[var(--shadow-overlay)] sm:px-8 sm:pb-8">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            data-shape="round"
            className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-ink transition-colors hover:bg-cream"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8">
              <path d="M6 6l12 12" />
              <path d="M18 6 6 18" />
            </svg>
          </button>

          <img src="/Brand Kit/Logo-5.png" alt="Husnalogy" className="mx-auto h-9 w-auto object-contain" />

          {!isForgot && (
            <div className="mt-6">
              <AuthModeSwitch mode={isSignup ? "signup" : "login"} onSignIn={() => setMode(MODES.LOGIN)} onSignUp={() => setMode(MODES.SIGNUP)} />
            </div>
          )}

          <div className="mt-6 text-center">
            <h2 id={ids.title} className="font-display text-[2rem] font-medium leading-tight text-ink">
              {title}
            </h2>
            <p className="mx-auto mt-2 max-w-[340px] text-[14px] leading-6 text-muted">{subtitle}</p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            {isSignup && (
              <AuthField id={ids.name} label="Name" value={name} onChange={edit("name", setName)} autoComplete="name" error={fieldErrors.name} />
            )}

            <AuthField
              id={ids.email}
              label="Email address"
              type="email"
              value={email}
              onChange={edit("email", setEmail)}
              autoComplete="email"
              error={fieldErrors.email}
            />

            {!isForgot && (
              <AuthField
                id={ids.password}
                label="Password"
                password
                value={password}
                onChange={edit("password", setPassword)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                hint={isSignup ? "Use at least 6 characters." : ""}
                error={fieldErrors.password}
              />
            )}

            {isSignup && (
              <AuthField
                id={ids.confirmPassword}
                label="Confirm password"
                password
                value={confirmPassword}
                onChange={edit("confirmPassword", setConfirmPassword)}
                autoComplete="new-password"
                error={fieldErrors.confirmPassword}
              />
            )}

            {!isSignup && !isForgot && (
              <div className="-mt-1 text-right">
                <button type="button" onClick={() => setMode(MODES.FORGOT)} className="btn btn-text text-[13px]">
                  Forgot your password?
                </button>
              </div>
            )}

            {message && <AuthNotice tone={messageType === "success" ? "success" : "error"}>{message}</AuthNotice>}

            <button type="submit" disabled={loading || googleLoading} aria-busy={loading} className="btn btn-primary btn-lg btn-block">
              {loading
                ? isForgot
                  ? "Sending…"
                  : isSignup
                    ? "Creating your account…"
                    : "Signing in…"
                : isForgot
                  ? "Send reset link"
                  : isSignup
                    ? "Create account"
                    : "Sign in"}
            </button>
          </form>

          {!isForgot && (
            <div className="mt-5 space-y-5">
              <AuthDivider label="or" />
              <GoogleButton onClick={handleGoogleLogin} loading={googleLoading} disabled={googleLoading || loading} />
            </div>
          )}

          {isForgot && (
            <p className="mt-5 text-center text-[14px] text-muted">
              Remembered it?{" "}
              <button type="button" onClick={() => setMode(MODES.LOGIN)} className="btn btn-text text-[14px] font-semibold">
                Back to sign in
              </button>
            </p>
          )}
        </div>
      </section>
    </>
  );
}
