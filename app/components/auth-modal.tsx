"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

function validate({ mode, name, email, password, confirmPassword }) {
  if (mode === MODES.SIGNUP && !name.trim()) {
    return "Please enter your name.";
  }

  if (!email.trim()) {
    return "Please enter your email address.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Please enter a valid email address.";
  }

  if (mode !== MODES.FORGOT && !password) {
    return "Please enter your password.";
  }

  if (mode === MODES.SIGNUP && password.length < 6) {
    return "Password must be at least 6 characters.";
  }

  if (mode === MODES.SIGNUP && password !== confirmPassword) {
    return "Passwords do not match.";
  }

  return null;
}

export default function AuthModal({ open, setOpen, mode, setMode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  const isSignup = mode === MODES.SIGNUP;
  const isForgot = mode === MODES.FORGOT;

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
    setShowPassword(false);
    setLoading(false);
    setGoogleLoading(false);
    setMessage("");
    setMessageType("");
  }, [open, mode]);

  if (!open) return null;

  async function handleSubmit(event) {
    event.preventDefault();

    const validationError = validate({
      mode,
      name,
      email,
      password,
      confirmPassword,
    });

    if (validationError) {
      setMessage(validationError);
      setMessageType("error");
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

  return (
    <>
      <div
        className="fixed inset-0 z-[3000] bg-black/65 transition-opacity duration-300 ease-out"
        onClick={() => setOpen(false)}
      />

      <section className="fixed left-1/2 top-1/2 z-[3001] w-[calc(100%-24px)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-visible">
        <div className="max-h-[92vh] overflow-y-auto rounded-none bg-white px-7 py-8 shadow-[0_30px_90px_rgba(48,56,57,0.25)] sm:px-9 sm:py-9">
          <div className="mb-7 text-center">
            <img src="/Brand Kit/Logo-2.png" alt="Husnalogy" className="mx-auto h-12 w-auto object-contain" />
            <div>
              <h2 className="mt-5 font-display text-[1.45rem] font-medium leading-tight text-[#303839]">
                {isForgot
                  ? "Reset Password"
                  : isSignup
                  ? "Get started on Husnalogy"
                  : "Login with your email & password"}
              </h2>

              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#303839]/65">
                {isForgot
                  ? "Enter your email and we will send you a password reset link."
                  : isSignup
                  ? "Create your account with email, password, or Google."
                  : ""}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close modal"
              data-shape="round"
              className="absolute -right-3 -top-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#303839] transition-colors duration-300 ease-out hover:bg-[#303839] hover:text-white"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              >
                <path d="M6 6l12 12" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {isSignup && (
              <Field
                label="Your name"
                type="text"
                value={name}
                onChange={setName}
                placeholder="Enter your name"
                autoComplete="name"
              />
            )}

            <Field
              label="Email address"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoComplete="email"
            />

            {!isForgot && (
              <PasswordField
                value={password}
                onChange={setPassword}
                show={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
              />
            )}

            {isSignup && (
              <Field
                label="Confirm password"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Re-enter your password"
                autoComplete="new-password"
              />
            )}

            {!isSignup && !isForgot && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setMode(MODES.FORGOT)}
                  className="text-xs font-bold text-[#303839]/60 underline transition hover:text-black"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {message && (
              <p
                className={`rounded-none px-4 py-3 text-sm font-semibold ${
                  messageType === "success"
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-600"
                }`}
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="mt-2 w-full rounded-none bg-[#303839] px-6 py-4 text-sm font-extrabold text-white shadow-[0_12px_26px_rgba(32,32,32,0.12)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-[#434c4d] hover:shadow-[0_18px_38px_rgba(32,32,32,0.22)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-[0_12px_26px_rgba(32,32,32,0.12)]"
            >
              {loading
                ? "Please wait..."
                : isForgot
                ? "Send Reset Link"
                : isSignup
                ? "Create Account"
                : "Login"}
            </button>

            {!isForgot && (
              <>
                <div className="flex items-center gap-3 pt-1">
                  <div className="h-px flex-1 bg-[#303839]/15" />

                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#303839]/45">
                    Or
                  </span>

                  <div className="h-px flex-1 bg-[#303839]/15" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={googleLoading || loading}
                  className="flex w-full items-center justify-center gap-3 rounded-none bg-[#303839] px-6 py-4 text-sm font-extrabold text-white shadow-[0_12px_26px_rgba(32,32,32,0.12)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-[#434c4d] hover:shadow-[0_18px_38px_rgba(32,32,32,0.22)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-[0_12px_26px_rgba(32,32,32,0.12)]"
                >
                  <GoogleIcon />
                  {googleLoading ? "Please wait..." : "Continue with Google"}
                </button>
              </>
            )}
          </form>

          <p className="mt-5 text-center text-xs leading-5 text-[#303839]/60 sm:text-sm">
            {isForgot ? (
              <>
                Remembered it?{" "}
                <button
                  type="button"
                  onClick={() => setMode(MODES.LOGIN)}
                  className="font-bold text-black underline"
                >
                  Back to login
                </button>
              </>
            ) : isSignup ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode(MODES.LOGIN)}
                  className="font-bold text-black underline"
                >
                  Login
                </button>
              </>
            ) : (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode(MODES.SIGNUP)}
                  className="font-bold text-black underline"
                >
                  Create one
                </button>
              </>
            )}
          </p>
        </div>
      </section>
    </>
  );
}

function Field({ label, type, value, onChange, placeholder, autoComplete }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-[#303839]">
        {label} *
      </label>

      <input
        type={type}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 w-full border-b border-[#303839]/24 bg-transparent px-0 text-sm text-black outline-none transition placeholder:text-black/35 focus:border-[#303839]"
      />
    </div>
  );
}

function PasswordField({ value, onChange, show, onToggle, autoComplete }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-[#303839]">
        Password *
      </label>

      <div className="relative">
        <input
          type={show ? "text" : "password"}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Minimum 6 characters"
          autoComplete={autoComplete}
          className="h-12 w-full border-b border-[#303839]/24 bg-transparent px-0 pr-12 text-sm text-black outline-none transition placeholder:text-black/35 focus:border-[#303839]"
        />

        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[#303839]/50 transition hover:text-[#303839]"
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20s20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4C16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.3 35.1 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-7.8l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4 5.6l6.2 5.2C36.9 39.4 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
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
