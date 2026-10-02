"use client";

import { useState } from "react";
import { BUSINESS_INFO, LAUNCH_FEATURES } from "@/lib/launch-config";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", subject: "", message: "" });
  const [status, setStatus] = useState({ loading: false, success: "", error: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletter, setNewsletter] = useState({ loading: false, success: "", error: "" });

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  // Mirrors the server's checks (lib/messages) so customers see problems next
  // to the field before anything is sent. The server remains authoritative.
  const validate = () => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Enter your name.";
    if (!form.email.trim()) errors.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Enter a valid email address, like name@example.com.";
    if (!form.message.trim()) errors.message = "Enter your message.";
    return errors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) {
      setStatus({ loading: false, success: "", error: "Please check the highlighted fields." });
      const firstKey = ["name", "email", "message"].find((key) => errors[key]);
      if (firstKey) document.getElementById(`contact-${firstKey}`)?.focus();
      return;
    }
    setStatus({ loading: true, success: "", error: "" });

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();

      if (!response.ok) {
        if (data?.errors && typeof data.errors === "object") setFieldErrors(data.errors);
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(String(firstError || "Your message could not be sent. Please try again."));
      }

      setForm({ name: "", email: "", phone: "", subject: "", message: "" });
      setFieldErrors({});
      setStatus({ loading: false, success: "Thank you. Your message has been sent and we will reply by email.", error: "" });
    } catch (error) {
      setStatus({ loading: false, success: "", error: error.message || "Something went wrong." });
    }
  };

  const handleNewsletter = async (event) => {
    event.preventDefault();
    setNewsletter({ loading: true, success: "", error: "" });

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newsletterEmail, source: "contact-page" }),
      });
      const data = await response.json();

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Could not subscribe.");
      }

      setNewsletterEmail("");
      setNewsletter({ loading: false, success: "You are now subscribed.", error: "" });
    } catch (error) {
      setNewsletter({ loading: false, success: "", error: error.message || "Could not subscribe." });
    }
  };

  return (
    <main className="text-ink">
      <section className="page-container section grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
        <div>
          <p className="eyebrow">Contact</p>
          <h1 className="heading-page mt-3">Get in touch</h1>
          <p className="text-lead mt-4 max-w-[520px]">
            Questions about an order, a custom design or a special request? Send us a message and we will reply by email.
          </p>

          <dl className="mt-10 grid gap-6 border-t border-line pt-8 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <ContactMethod icon={<MailIcon />} title="Email">
              <a href={`mailto:${BUSINESS_INFO.email}`} className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                {BUSINESS_INFO.email}
              </a>
            </ContactMethod>
            <ContactMethod icon={<PhoneIcon />} title="Phone">
              <a href={BUSINESS_INFO.phoneHref} className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                {BUSINESS_INFO.phone}
              </a>
              {BUSINESS_INFO.supportHours && <p className="mt-1 text-muted">{BUSINESS_INFO.supportHours}</p>}
            </ContactMethod>
            <ContactMethod icon={<PinIcon />} title="Address">
              <p>{BUSINESS_INFO.address}</p>
            </ContactMethod>
          </dl>
        </div>

        <div className="rounded-[10px] border border-line bg-white p-6 sm:p-8">
          <h2 className="heading-section text-[1.875rem]">Send us a message</h2>
          <p className="mt-2 text-[14px] text-muted">Fields marked * are required.</p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="contact-name"
                label="Name"
                autoComplete="name"
                value={form.name}
                onChange={(value) => updateForm("name", value)}
                error={fieldErrors.name}
                required
              />
              <Field
                id="contact-email"
                type="email"
                label="Email address"
                autoComplete="email"
                value={form.email}
                onChange={(value) => updateForm("email", value)}
                error={fieldErrors.email}
                required
              />
              <Field
                id="contact-phone"
                type="tel"
                label="Phone number"
                autoComplete="tel"
                value={form.phone}
                onChange={(value) => updateForm("phone", value)}
                error={fieldErrors.phone}
              />
              <Field
                id="contact-subject"
                label="Subject"
                value={form.subject}
                onChange={(value) => updateForm("subject", value)}
                error={fieldErrors.subject}
              />
            </div>

            <div>
              <label htmlFor="contact-message" className="field-label">
                Message <span aria-hidden="true">*</span>
              </label>
              <textarea
                id="contact-message"
                value={form.message}
                onChange={(event) => updateForm("message", event.target.value)}
                required
                aria-required="true"
                aria-invalid={fieldErrors.message ? true : undefined}
                aria-describedby={fieldErrors.message ? "contact-message-error" : undefined}
                rows={6}
                className="field"
              />
              {fieldErrors.message && <FieldError id="contact-message-error">{fieldErrors.message}</FieldError>}
            </div>

            <div aria-live="polite">
              {status.success && <p className="notice notice-success">{status.success}</p>}
              {status.error && <p className="notice notice-error">{status.error}</p>}
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <button type="submit" disabled={status.loading} aria-busy={status.loading} className="btn btn-primary btn-lg">
                <SendIcon />
                {status.loading ? "Sending…" : "Send message"}
              </button>
              <p className="flex items-start gap-2 text-[13px] leading-5 text-muted">
                <ShieldIcon />
                We only use your details to reply to your message.
              </p>
            </div>
          </form>
        </div>
      </section>

      {LAUNCH_FEATURES.marketingEmail && <section className="mx-auto max-w-[1480px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-5 rounded-none p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/70 text-charcoal">
              <MailIcon />
            </span>
            <div>
              <p className="text-sm font-bold text-charcoal sm:text-base">
                Stay inspired with new collections and exclusive offers.
              </p>
              <p className="mt-1 text-xs text-charcoal/60">Join our newsletter.</p>
            </div>
          </div>

          <form onSubmit={handleNewsletter} className="flex w-full max-w-md flex-col gap-3 sm:flex-row sm:items-end">
            <input
              type="email"
              required
              value={newsletterEmail}
              onChange={(event) => setNewsletterEmail(event.target.value)}
              placeholder="Enter your email address"
              aria-label="Email address"
              className="field sm:flex-1"
            />
            <button
              type="submit"
              disabled={newsletter.loading}
              className="btn btn-primary shrink-0"
            >
              {newsletter.loading ? "..." : "Subscribe"}
            </button>
          </form>
        </div>
        {(newsletter.success || newsletter.error) && (
          <p
            className={`mt-3 px-2 text-sm font-semibold ${
              newsletter.success ? "text-green-700" : "text-red-600"
            }`}
          >
            {newsletter.success || newsletter.error}
          </p>
        )}
      </section>}
    </main>
  );
}

function Field({ id, type = "text", label, value, onChange, required = false, error = "", autoComplete = undefined }: any) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label} {required ? <span aria-hidden="true">*</span> : <span className="field-optional">(optional)</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete={autoComplete}
        className="field"
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

function FieldError({ id, children }) {
  return (
    <p id={id} className="field-error">
      <svg {...svgProps} width={16} height={16} className="mt-0.5 shrink-0">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </svg>
      {children}
    </p>
  );
}

function ContactMethod({ icon, title, children }) {
  return (
    <div className="flex items-start gap-4 text-[15px] leading-6">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cream text-ink">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</dt>
        <dd className="mt-1 break-words">{children}</dd>
      </div>
    </div>
  );
}

const svgProps: any = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

function SendIcon() {
  return (
    <svg {...svgProps} width={18} height={18}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...svgProps} width={18} height={18} className="shrink-0">
      <path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg {...svgProps} width={22} height={22}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg {...svgProps} width={22} height={22}>
      <path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg {...svgProps} width={22} height={22}>
      <path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2.2" />
    </svg>
  );
}
