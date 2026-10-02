"use client";

import { useId, useState } from "react";

/**
 * Shared presentation for the sign-in modal and the /login, /signup,
 * /forgot-password and /reset-password pages. Logic (Supabase calls,
 * redirects) stays in the callers; this file only renders.
 */

export type AuthFieldErrors = Partial<Record<"name" | "email" | "password" | "confirmPassword", string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 6;

/** Field-level checks shared by every auth form. */
export function validateAuthFields({
  name = "",
  email = "",
  password = "",
  confirmPassword = "",
  requireName = false,
  requireEmail = true,
  requirePassword = true,
  newPassword = false,
}: {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  requireName?: boolean;
  requireEmail?: boolean;
  requirePassword?: boolean;
  newPassword?: boolean;
}): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  if (requireName && !name.trim()) errors.name = "Enter your name.";
  if (requireEmail) {
    if (!email.trim()) errors.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = "Enter a valid email address, like name@example.com.";
  }
  if (requirePassword) {
    if (!password) errors.password = "Enter your password.";
    else if (newPassword && password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (newPassword) {
    if (!confirmPassword) errors.confirmPassword = "Re-enter your password.";
    else if (password && confirmPassword !== password) errors.confirmPassword = "Passwords do not match.";
  }
  return errors;
}

export function firstErrorField(errors: AuthFieldErrors) {
  return (["name", "email", "password", "confirmPassword"] as const).find((key) => errors[key]);
}

export function AuthField({
  id,
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  error = "",
  hint = "",
  password = false,
  autoFocus = false,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  error?: string;
  hint?: string;
  password?: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const describedBy = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={password ? (visible ? "text" : "password") : type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`field ${password ? "pr-12" : ""}`}
        />
        {password && (
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={visible}
            data-shape="round"
            className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink"
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          <ErrorIcon />
          {error}
        </p>
      )}
    </div>
  );
}

export function AuthNotice({ tone, children }: { tone: "error" | "success" | "info"; children: React.ReactNode }) {
  const className = tone === "error" ? "notice notice-error" : tone === "success" ? "notice notice-success" : "notice bg-cream";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={className}>
      {children}
    </p>
  );
}

export function GoogleButton({ onClick, loading, disabled }: { onClick: () => void; loading: boolean; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-busy={loading} className="btn btn-secondary btn-block gap-3">
      <GoogleIcon />
      {loading ? "Connecting to Google…" : "Continue with Google"}
    </button>
  );
}

export function AuthDivider({ label = "or use your email" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-line" />
      <span className="text-[13px] text-muted">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Sign in / Create account switch shown at the top of both forms. */
export function AuthModeSwitch({
  mode,
  onSignIn,
  onSignUp,
}: {
  mode: "login" | "signup";
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  const base = "flex-1 min-h-10 rounded-[6px] px-3 text-[14px] font-semibold transition-colors";
  return (
    <div className="flex gap-1 rounded-[8px] border border-line bg-cream p-1" role="group" aria-label="Account">
      <button
        type="button"
        onClick={onSignIn}
        aria-pressed={mode === "login"}
        className={`${base} ${mode === "login" ? "bg-white text-ink shadow-[0_1px_2px_rgba(48,56,57,0.12)]" : "text-muted hover:text-ink"}`}
      >
        Sign in
      </button>
      <button
        type="button"
        onClick={onSignUp}
        aria-pressed={mode === "signup"}
        className={`${base} ${mode === "signup" ? "bg-white text-ink shadow-[0_1px_2px_rgba(48,56,57,0.12)]" : "text-muted hover:text-ink"}`}
      >
        Create account
      </button>
    </div>
  );
}

export function useAuthIds() {
  const base = useId();
  return {
    name: `${base}-name`,
    email: `${base}-email`,
    password: `${base}-password`,
    confirmPassword: `${base}-confirm`,
    title: `${base}-title`,
  };
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.9 17.9A10 10 0 0 1 12 20c-7 0-10-8-10-8a18 18 0 0 1 5.1-5.9" />
      <path d="M9.9 4.2A9 9 0 0 1 12 4c7 0 10 8 10 8a18 18 0 0 1-2.2 3.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20s20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4C16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.3 35.1 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-7.8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4 5.6l6.2 5.2C36.9 39.4 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
