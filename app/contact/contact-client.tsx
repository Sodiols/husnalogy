"use client";

import { useState } from "react";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", subject: "", message: "" });
  const [status, setStatus] = useState({ loading: false, success: "", error: "" });

  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletter, setNewsletter] = useState({ loading: false, success: "", error: "" });

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, success: "", error: "" });

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();

      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Message could not be sent.");
      }

      setForm({ name: "", email: "", phone: "", subject: "", message: "" });
      setStatus({ loading: false, success: "Your message has been sent successfully.", error: "" });
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
    <main className="text-charcoal">
      <section className="mx-auto grid min-h-[90vh] max-w-[1480px] items-center gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_0.96fr] lg:gap-14 lg:px-8 lg:py-10">
        <div className="flex flex-col justify-center">
          <p className="flex items-center gap-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/55">
            <span aria-hidden="true" className="h-px w-10 bg-[#303839]/45" />
            We would love to hear from you
          </p>
          <h1 className="mt-7 font-display text-[3.4rem] font-medium leading-[0.96] text-[#303839] sm:text-[4.6rem] lg:text-[5.3rem]">
            Get in touch
          </h1>
          <p className="mt-6 max-w-xl text-[16px] leading-8 text-charcoal/72">
            We&rsquo;re here to help with any questions about your order, custom designs, or special requests. Reach out to us and we&rsquo;ll get back to you as soon as possible.
          </p>

          <div className="mt-12 grid gap-y-9 sm:grid-cols-3 sm:divide-x sm:divide-[#303839]/14">
            <ContactMethod icon={<MailIcon />} title="Email">
              <a href="mailto:hello@husnalogy.com" className="font-semibold hover:text-black">
                hello@husnalogy.com
              </a>
              <p className="mt-2 text-charcoal/58">We usually reply within 24 hours</p>
            </ContactMethod>
            <ContactMethod icon={<PhoneIcon />} title="Phone">
              <a href="tel:+8801760074435" className="font-semibold hover:text-black">
                +880 1575 004432
              </a>
              <p className="mt-2 text-charcoal/58">Sun - Thu, 10:00 AM - 8:00 PM (BDT)</p>
            </ContactMethod>
            <ContactMethod icon={<PinIcon />} title="Studio">
              <p className="font-semibold">Sylhet, Bangladesh</p>
              <p className="mt-2 text-charcoal/58">By appointment only</p>
            </ContactMethod>
          </div>
        </div>

        <div className="rounded-none bg-white/95 p-6 sm:p-8 md:p-10 lg:p-12">
          <h2 className="font-display text-4xl font-medium leading-tight text-[#303839] sm:text-[2.65rem]">Send Us a Message</h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-charcoal/60">
            Fill out the form below and we&rsquo;ll get back to you as soon as possible.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
              <Field
                placeholder="Your Name"
                value={form.name}
                onChange={(value) => updateForm("name", value)}
                required
              />
              <Field
                type="email"
                placeholder="Email Address"
                value={form.email}
                onChange={(value) => updateForm("email", value)}
                required
              />
              <Field
                type="tel"
                placeholder="Phone Number"
                value={form.phone}
                onChange={(value) => updateForm("phone", value)}
              />
              <Field
                placeholder="Subject"
                value={form.subject}
                onChange={(value) => updateForm("subject", value)}
              />
            </div>
            <textarea
              value={form.message}
              onChange={(event) => updateForm("message", event.target.value)}
              placeholder="Your Message"
              required
              rows={5}
              className="min-h-[150px] w-full resize-y rounded-none border-0 border-b border-[#303839]/22 bg-transparent px-0 py-3 text-sm outline-none transition placeholder:text-charcoal/42 focus:border-charcoal"
            />

            {status.success && (
              <p className="text-sm font-semibold text-green-700">{status.success}</p>
            )}
            {status.error && <p className="text-sm font-semibold text-red-600">{status.error}</p>}

            <div className="flex flex-col gap-5 pt-1 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={status.loading}
                className="inline-flex h-14 shrink-0 items-center justify-center gap-3 rounded-none bg-[#303839] px-8 text-sm font-extrabold text-white transition hover:bg-[#434c4d] disabled:opacity-60"
              >
                <SendIcon />
                {status.loading ? "Sending..." : "Send Message"}
              </button>

              <div className="flex items-start gap-3 text-charcoal/58">
                <ShieldIcon />
                <p className="text-sm leading-6">
                  <span className="block font-extrabold text-charcoal">We respect your privacy.</span>
                  Your information is safe with us.
                </p>
              </div>
            </div>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-[1480px] px-4 pt-6 sm:px-6 lg:px-8">
        <div className="grid gap-y-6 rounded-none bg-white p-6 sm:grid-cols-2 sm:p-8 lg:grid-cols-4 lg:divide-x lg:divide-charcoal/10">
          <Feature icon={<SupportIcon />} title="Dedicated Support" text="We're here to help with care and attention." />
          <Feature icon={<PencilIcon />} title="Custom Design Help" text="Share your ideas and we'll bring them to life." />
          <Feature icon={<TruckIcon />} title="Fast & Reliable" text="Quick responses and timely delivery." />
          <Feature icon={<HeartIcon />} title="Made with Love" text="Every piece is designed with meaning." />
        </div>
      </section>

      <section className="mx-auto max-w-[1480px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
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
              className="h-12 w-full rounded-none border-0 border-b border-charcoal/24 bg-transparent px-0 text-sm outline-none transition placeholder:text-charcoal/42 focus:border-charcoal sm:flex-1"
            />
            <button
              type="submit"
              disabled={newsletter.loading}
              className="h-12 shrink-0 rounded-none bg-charcoal px-7 text-sm font-bold text-white transition hover:bg-[#434c4d] disabled:opacity-60"
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
      </section>
    </main>
  );
}

function Field({ type = "text", placeholder, value, onChange, required = false }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      required={required}
      className="h-12 w-full rounded-none border-0 border-b border-[#303839]/22 bg-transparent px-0 text-sm outline-none transition placeholder:text-charcoal/42 focus:border-charcoal"
    />
  );
}

function ContactMethod({ icon, title, children }) {
  return (
    <div className="px-0 text-center text-sm text-charcoal/74 sm:px-6 sm:first:pl-0 sm:last:pr-0">
      <span className="mx-auto grid h-12 w-12 place-items-center text-charcoal">
        {icon}
      </span>
      <p className="mt-4 text-[12px] font-extrabold uppercase tracking-[0.14em] text-charcoal">{title}</p>
      <div className="mt-3 leading-6">{children}</div>
    </div>
  );
}

function Feature({ icon, title, text }) {
  return (
    <div className="flex items-start gap-4 lg:px-6 lg:first:pl-0 lg:last:pr-0">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f8f6f1] text-charcoal">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-charcoal">{title}</p>
        <p className="mt-1 text-xs leading-5 text-charcoal/60">{text}</p>
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
    <svg {...svgProps} width={24} height={24} className="mt-0.5 shrink-0 text-charcoal/45">
      <path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg {...svgProps} width={32} height={32}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg {...svgProps} width={32} height={32}>
      <path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg {...svgProps} width={32} height={32}>
      <path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2.2" />
    </svg>
  );
}
function SupportIcon() {
  return (
    <svg {...svgProps} width={22} height={22}>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="2.5" y="13" width="4" height="6" rx="1.4" />
      <rect x="17.5" y="13" width="4" height="6" rx="1.4" />
      <path d="M20 19a4 4 0 0 1-4 3h-3" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg {...svgProps} width={22} height={22}>
      <path d="m4 20 4-1 10-10a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" />
      <path d="m14 7 3 3" />
    </svg>
  );
}
function TruckIcon() {
  return (
    <svg {...svgProps} width={22} height={22}>
      <path d="M3 6h11v9H3z" />
      <path d="M14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}
function HeartIcon() {
  return (
    <svg {...svgProps} width={22} height={22}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" />
    </svg>
  );
}
