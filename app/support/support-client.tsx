"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import RightArrowIcon from "../components/RightArrowIcon";

const TOPICS = [
  { icon: "bag", title: "Orders", text: "Track, view, or manage your order.", href: "/orders" },
  { icon: "pencil", title: "Personalization", text: "Add names, wording, dates, or photos.", href: "/contact" },
  { icon: "box", title: "Design Requests", text: "Get help with customization or proofs.", href: "/contact" },
  { icon: "truck", title: "Shipping & Delivery", text: "Find delivery time and shipping details.", href: "/contact" },
  { icon: "file", title: "Digital Products", text: "Download and use your digital files.", href: "/products" },
  { icon: "printer", title: "Printed Products", text: "Premium printed cards and stationery.", href: "/products" },
  { icon: "refresh", title: "Returns & Refunds", text: "Understand return and refund support.", href: "/contact" },
  { icon: "card", title: "Payments", text: "Questions about payment or checkout.", href: "/contact" },
];

// Ordered so a 2-column grid fills the columns to match the reference layout.
const FAQS = [
  { q: "How can I track my order?", a: "Once your order has shipped you'll receive a shipping confirmation email with a tracking link. You can also sign in and view live status anytime under My Orders. Please allow up to 24 hours for tracking updates to appear." },
  { q: "Can I cancel or change my order?", a: "Reach out through the contact page as soon as possible and we'll help with cancellations or changes wherever production hasn't started yet." },
  { q: "Can I request changes after placing an order?", a: "Yes — contact us as soon as possible and we'll update the details before production begins." },
  { q: "How do personalized orders work?", a: "Choose a design, add your names, wording, dates, or photos during personalization, and our team prepares a proof for your approval before printing." },
  { q: "How long does a custom design take?", a: "It depends on the product and customization; the team confirms the timeline after reviewing your request." },
  { q: "Do you ship internationally?", a: "Delivery options and timing are confirmed after your order; contact us for international requests." },
  { q: "Can I upload my own photo or wording?", a: "Yes, many designs let you add your own names, wording, and photos during personalization." },
  { q: "When will I receive my proof?", a: "After your request is reviewed, the team prepares a digital proof and shares it for approval, usually within a few working days." },
  { q: "Do you offer digital and printed products?", a: "Yes — both digital and printed options are available on selected designs." },
  { q: "What file type will I receive for digital products?", a: "Digital products are delivered as high-resolution PDF or PNG files, ready to print or share." },
];

// Split into two independent columns so opening a card only pushes items in its own column.
const FAQ_HALF = Math.ceil(FAQS.length / 2);
const FAQ_COLUMNS = [FAQS.slice(0, FAQ_HALF), FAQS.slice(FAQ_HALF)];

export default function SupportClient() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [openFaq, setOpenFaq] = useState(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ loading: false, message: "", error: "" });

  const submitSearch = (event) => {
    event.preventDefault();
    const q = search.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  const subscribe = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, message: "", error: "" });
    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "support-page" }),
      });
      const data = await response.json();
      if (!response.ok) {
        const firstError = data?.errors ? Object.values(data.errors)[0] : data?.error;
        throw new Error(firstError || "Could not subscribe.");
      }
      setEmail("");
      setStatus({ loading: false, message: "You are now subscribed.", error: "" });
    } catch (error) {
      setStatus({ loading: false, message: "", error: error.message || "Could not subscribe." });
    }
  };

  return (
    <main className="text-[#303839]">
      {/* Hero */}
      <section className="bg-gradient-to-b from-[#f8f6f1] to-[#f8f6f1] px-4 py-16 text-center sm:px-6 lg:py-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]">Customer Support</p>
        <h1 className="mx-auto mt-4 max-w-[760px] font-display text-[2.4rem] font-medium leading-[1.08] text-[#303839] sm:text-[3.2rem]">
          How can we help you today?
        </h1>
        <p className="mx-auto mt-4 max-w-[560px] text-[0.95rem] leading-7 text-[#303839]/65">
          Find answers about orders, personalization, delivery, design requests, and everything you need for your Husnalogy experience.
        </p>

        <form onSubmit={submitSearch} className="mx-auto mt-8 flex max-w-[660px] items-center gap-2 rounded-none border border-[#303839]/12 bg-white p-1.5 shadow-[0_14px_40px_rgba(48,56,57,0.07)]">
          <SIcon name="search" className="ml-3 h-5 w-5 shrink-0 text-[#303839]/45" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search for help, orders, delivery, returns..."
            className="min-w-0 flex-1 bg-transparent px-2 text-sm text-[#303839] outline-none placeholder:text-[#303839]/45"
          />
          <button type="submit" className="shrink-0 rounded-full bg-[#303839] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#434c4d]">
            Search
          </button>
        </form>
      </section>

      {/* Browse help by topic */}
      <section id="help-topics" className="scroll-mt-28 bg-white px-4 py-16 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-[1280px]">
          <header className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]">Quick Help</p>
            <h2 className="mt-2 font-display text-[2rem] font-medium text-[#303839] sm:text-[2.4rem]">Browse help by topic</h2>
          </header>

          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-4">
            {TOPICS.map((topic) => (
              <Link
                key={topic.title}
                href={topic.href}
                className="group flex flex-col rounded-none border border-[#303839]/8 bg-white p-5 text-center shadow-[0_10px_30px_rgba(48,56,57,0.04)] transition hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(48,56,57,0.1)]"
              >
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f8f6f1] text-[#303839]">
                  <SIcon name={topic.icon} className="h-6 w-6" />
                </span>
                <p className="mt-4 text-[0.95rem] font-bold text-[#303839]">{topic.title}</p>
                <p className="mt-2 flex-1 text-xs leading-5 text-[#303839]/55">{topic.text}</p>
                <RightArrowIcon className="mx-auto mt-4 text-[#303839]/40 group-hover:translate-x-1 group-hover:text-[#303839]" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-28 bg-[#f8f6f1] px-4 py-16 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-[1000px]">
          <header className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]">Popular Questions</p>
            <h2 className="mt-2 font-display text-[2rem] font-medium text-[#303839] sm:text-[2.4rem]">Find quick answers</h2>
          </header>

          <div className="mt-10 grid items-start gap-3 md:grid-cols-2">
            {FAQ_COLUMNS.map((column, columnIndex) => (
              <div key={columnIndex} className="flex flex-col gap-3">
                {column.map((faq) => {
                  const open = openFaq === faq.q;
                  return (
                    <div key={faq.q} className="rounded-none border border-[#303839]/10 bg-white">
                      <button
                        type="button"
                        onClick={() => setOpenFaq(open ? null : faq.q)}
                        aria-expanded={open}
                        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                      >
                        <span className="text-sm font-semibold text-[#303839]">{faq.q}</span>
                        <SIcon name={open ? "minus" : "plus"} className="h-4 w-4 shrink-0 text-[#303839]" />
                      </button>
                      <div className={`grid transition-all duration-300 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                        <div className="overflow-hidden">
                          <p className="px-5 pb-4 text-xs leading-6 text-[#303839]/65">{faq.a}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link href="/contact" className="group inline-flex items-center gap-2 text-sm font-bold text-[#303839] hover:text-[#303839]">
              View all questions <RightArrowIcon className="group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* Personal help */}
      <section className="bg-white px-4 pt-12 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-[1280px] gap-5 lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-none bg-[#f8f6f1] p-7 sm:p-9">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#303839]">We&rsquo;re here for you</p>
            <h3 className="mt-3 font-display text-[1.9rem] font-medium text-[#303839]">Need personal help?</h3>
            <p className="mt-3 max-w-[320px] text-sm leading-6 text-[#303839]/65">
              Our support team is here to help with your order, design request, or product question.
            </p>
            <Link href="/contact" className="mt-6 inline-flex h-12 items-center justify-center rounded-none bg-[#303839] px-7 text-sm font-bold text-white transition hover:bg-[#434c4d]">
              Contact Us
            </Link>
            <SIcon name="branch" className="pointer-events-none absolute -bottom-3 right-2 h-32 w-32 text-[#303839]/30" />
          </div>

          <div className="rounded-none border border-[#303839]/8 bg-white p-3 shadow-[0_10px_30px_rgba(48,56,57,0.04)]">
            <ContactRow icon="mail" title="Email Support" detail="hello@husnalogy.com" href="mailto:hello@husnalogy.com" />
            <ContactRow icon="phone" title="Call or WhatsApp" detail="+880 1712 345678" href="tel:+8801712345678" />
            <ContactRow icon="clock" title="Support Hours" detail="Sun to Thu, 10:00 AM – 8:00 PM" />
          </div>
        </div>
      </section>

      {/* Account banner */}
      <section className="bg-white px-4 pt-5 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-5 rounded-none bg-[#f8f6f1] p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white text-[#303839]">
              <SIcon name="bag" className="h-7 w-7" />
            </span>
            <div>
              <h3 className="font-display text-[1.6rem] font-medium text-[#303839]">Need help with an order?</h3>
              <p className="mt-1 text-sm leading-6 text-[#303839]/65">Sign in to view your orders and request support directly from your account.</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/profile" className="inline-flex h-12 items-center justify-center rounded-none bg-[#303839] px-7 text-sm font-bold text-white transition hover:bg-[#434c4d]">
              Go to My Account
            </Link>
            <Link href="/orders" className="inline-flex h-12 items-center justify-center rounded-none border border-[#303839]/30 px-7 text-sm font-bold text-[#303839] transition hover:bg-white">
              Track Order
            </Link>
          </div>
        </div>
      </section>

      {/* Newsletter */}
      <section className="bg-white px-4 py-12 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-5 rounded-none border border-[#303839]/8 bg-white p-6 shadow-[0_10px_30px_rgba(48,56,57,0.05)] sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#f8f6f1] text-[#303839]">
              <SIcon name="mail" className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-[#303839]">Be the first to know</h3>
              <p className="mt-1 text-xs leading-5 text-[#303839]/60">New designs, helpful tips, and exclusive offers — straight to your inbox.</p>
            </div>
          </div>
          <form onSubmit={subscribe} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email address"
              className="h-12 w-full rounded-none border border-[#303839]/15 bg-white px-5 text-sm outline-none transition focus:border-[#303839]/40 sm:flex-1"
            />
            <button type="submit" disabled={status.loading} className="h-12 shrink-0 rounded-full bg-[#303839] px-7 text-sm font-bold text-white transition hover:bg-[#434c4d] disabled:opacity-60">
              {status.loading ? "..." : "Subscribe"}
            </button>
          </form>
        </div>
        {(status.message || status.error) && (
          <p className={`mx-auto mt-3 max-w-[1280px] text-sm font-semibold ${status.message ? "text-green-700" : "text-red-600"}`}>
            {status.message || status.error}
          </p>
        )}
      </section>
    </main>
  );
}

function ContactRow({ icon, title, detail, href }: any) {
  const inner = (
    <div className="flex items-center gap-4 rounded-none px-4 py-4 transition hover:bg-[#E6E6E6]">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f8f6f1] text-[#303839]">
        <SIcon name={icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-[#303839]">{title}</p>
        <p className="truncate text-xs text-[#303839]/60">{detail}</p>
      </div>
      {href && <SIcon name="chevron" className="h-4 w-4 shrink-0 text-[#303839]/40" />}
    </div>
  );
  return href ? <a href={href}>{inner}</a> : inner;
}

function SIcon({ name, className = "h-5 w-5" }: any) {
  const base: any = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };
  switch (name) {
    case "search":
      return <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case "box":
      return <svg {...base}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4.5 8 12 12.2 19.5 8" /><path d="M12 12.2V21" /></svg>;
    case "pencil":
      return <svg {...base}><path d="m4 20 4-1 11-11a2.2 2.2 0 0 0-3.1-3.1L5 16l-1 4Z" /><path d="m14.5 6.5 3 3" /></svg>;
    case "truck":
      return <svg {...base}><path d="M3 6h11v9H3z" /><path d="M14 9h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.7" /><circle cx="17" cy="18" r="1.7" /></svg>;
    case "refresh":
      return <svg {...base}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>;
    case "card":
      return <svg {...base}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>;
    case "file":
      return <svg {...base}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>;
    case "printer":
      return <svg {...base}><path d="M6 9V4h12v5" /><rect x="3" y="9" width="18" height="7" rx="2" /><path d="M7 16h10v4H7z" /><path d="M17 12h.01" /></svg>;
    case "headset":
      return <svg {...base}><path d="M4 13v-1a8 8 0 0 1 16 0v1" /><rect x="2.5" y="13" width="4" height="6" rx="1.4" /><rect x="17.5" y="13" width="4" height="6" rx="1.4" /><path d="M20 19a4 4 0 0 1-4 3h-3" /></svg>;
    case "arrow":
      return <svg {...base}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
    case "chevron":
      return <svg {...base}><path d="m9 6 6 6-6 6" /></svg>;
    case "plus":
      return <svg {...base}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
    case "minus":
      return <svg {...base}><path d="M5 12h14" /></svg>;
    case "mail":
      return <svg {...base}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
    case "phone":
      return <svg {...base}><path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>;
    case "clock":
      return <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "bag":
      return <svg {...base}><path d="M6 8h12l1 12H5L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="M12 12.5c1.2-1.2 3-.2 3 1.2 0 1.3-3 3.3-3 3.3s-3-2-3-3.3c0-1.4 1.8-2.4 3-1.2Z" /></svg>;
    case "branch":
      return <svg {...base}><path d="M5 22C5 13 10 6 19 3" /><path d="M12 9c2-2 5-2 7-1-1 2-4 3-7 1Z" /><path d="M9 14c2-1 4 0 5 2-2 1-4 0-5-2Z" /><path d="M14 6c1-2 3-2 4-1-1 2-3 2-4 1Z" /></svg>;
    default:
      return null;
  }
}
