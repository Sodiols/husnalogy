import Link from "next/link";

export const metadata = {
  title: "Terms and Conditions",
  description: "Read Husnalogy website, order, product, and service terms.",
};

const terms = [
  {
    title: "Overview",
    text: "These Terms and Conditions explain how customers use the Husnalogy website, place orders, and purchase our products or services. By placing an order, you agree to these terms.",
  },
  {
    title: "Orders and Payments",
    text: "Orders are subject to availability, review, and acceptance. Payment must be completed in full before production begins, and prices may include applicable taxes where required.",
  },
  {
    title: "Personalized Products",
    text: "Personalized items are made to order using the details supplied by the customer. Please check all wording, names, dates, photos, and design choices before submitting your order.",
  },
  {
    title: "Digital Products",
    text: "Digital products are delivered electronically and may be non-refundable once prepared or delivered. Customers are responsible for providing a valid email address and downloading files promptly.",
  },
  {
    title: "Proofs and Revisions",
    text: "A digital proof may be provided for selected products or upon request. Please review proofs carefully and reply within the stated timeframe so production can continue without delay.",
  },
  {
    title: "Shipping and Delivery",
    text: "Delivery timelines are estimates and may vary based on product type, proof approval, production capacity, destination, and courier performance. We will share order updates where available.",
  },
  {
    title: "Returns and Refunds",
    text: "Because personalized products are created for a specific customer, returns and refunds are limited. Please contact support promptly if an item arrives damaged, defective, or incorrect.",
  },
  {
    title: "Customer Files",
    text: "Customers must have the right to use any uploaded photos, artwork, wording, names, or files. Submitted materials should be clear, accurate, and suitable for the product selected.",
  },
  {
    title: "Intellectual Property",
    text: "Husnalogy designs, templates, product images, website content, artwork, and brand materials remain the property of Husnalogy unless otherwise agreed in writing.",
  },
  {
    title: "Account Use",
    text: "Customers are responsible for keeping account details accurate and protecting login information. Orders placed through an account are treated as authorized by the account holder.",
  },
  {
    title: "Contact Us",
    text: "For questions about these terms, order details, product files, or support requests, please contact Husnalogy before placing your order or as soon as an issue appears.",
  },
];

export default function TermsPage() {
  return (
    <main className="bg-[#f8f6f1] text-[#303839]">
      <section className="border-b border-[#303839]/8 bg-gradient-to-br from-[#f8f6f1] via-white to-[#f8f6f1] px-4 pb-12 pt-14 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-[1320px]">
          <h1 className="font-display text-[2.9rem] font-medium leading-none text-[#303839] sm:text-[4.25rem]">
            Terms and Conditions
          </h1>
          <p className="mt-5 max-w-[680px] text-[0.98rem] leading-7 text-[#303839]/78">
            Please read these terms before placing an order. They explain how Husnalogy handles orders, personalization, digital files, delivery, and customer support.
          </p>
          <p className="mt-6 text-[0.72rem] font-extrabold uppercase tracking-[0.24em] text-[#303839]">
            Last updated: June 2026
          </p>
        </div>
      </section>

      <section className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1320px] lg:hidden">
          <details className="rounded-none border border-[#303839]/10 bg-white p-3 shadow-[0_14px_36px_rgba(48,56,57,0.05)]">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-none bg-[#f8f6f1] px-4 py-3 text-[0.78rem] font-extrabold uppercase tracking-[0.2em] text-[#303839]">
              Terms Sections
              <ChevronDownIcon className="h-4 w-4" />
            </summary>
            <nav aria-label="Terms sections" className="mt-3">
              <ol className="grid gap-2">
                {terms.map((term) => (
                  <li key={term.title}>
                    <a
                      href={`#${toId(term.title)}`}
                      className="block rounded-none border border-[#303839]/8 bg-white px-4 py-3 text-sm font-semibold text-[#303839]/82 transition hover:bg-[#E6E6E6]/45"
                    >
                      {term.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </details>
        </div>

        <div className="mx-auto mt-6 grid max-w-[1320px] gap-6 lg:mt-0 lg:grid-cols-[310px_minmax(0,1fr)]">
          <aside className="hidden rounded-none border border-[#303839]/8 bg-[#f8f6f1] p-4 shadow-[0_18px_50px_rgba(48,56,57,0.06)] lg:sticky lg:top-24 lg:block lg:self-start">
            <p className="px-4 pt-2 text-[0.72rem] font-extrabold uppercase tracking-[0.24em] text-[#303839]">
              Table of Contents
            </p>
            <nav aria-label="Terms table of contents" className="mt-4">
              <ol className="space-y-1">
                {terms.map((term, index) => (
                  <li key={term.title}>
                    <a
                      href={`#${toId(term.title)}`}
                      className="grid grid-cols-[38px_minmax(0,1fr)] items-center rounded-none px-3 py-3 text-[0.84rem] text-[#303839]/82 transition hover:bg-white hover:text-[#303839]"
                    >
                      <span className="text-center text-[0.74rem] font-extrabold tabular-nums text-[#303839]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="truncate">{term.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <div className="min-w-0">
            <section className="rounded-none border border-[#303839]/8 bg-[#E6E6E6] p-5 text-[#303839] shadow-[0_16px_42px_rgba(48,56,57,0.05)] sm:p-6">
              <p className="text-[0.78rem] font-extrabold uppercase tracking-[0.2em] text-[#303839]">
                Important Order Notice
              </p>
              <p className="mt-3 max-w-[920px] text-[0.95rem] leading-7 text-[#303839]/82">
                Customers should carefully check names, dates, spelling, photos, and event details before submitting personalized orders. Husnalogy prepares items using the details provided at checkout.
              </p>
            </section>

            <div className="mt-5 space-y-4">
              {terms.map((term, index) => (
                <section
                  key={term.title}
                  id={toId(term.title)}
                  className="scroll-mt-28 rounded-none border border-[#303839]/10 bg-white p-5 shadow-[0_12px_34px_rgba(48,56,57,0.04)] sm:p-7"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                    <span className="inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-none bg-[#f8f6f1] text-[0.8rem] font-extrabold tabular-nums text-[#303839]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display text-[1.75rem] font-semibold leading-tight text-[#303839] sm:text-[2rem]">
                        {term.title}
                      </h2>
                      <div className="mt-4 h-px w-full bg-[#303839]/10" />
                      <p className="mt-4 max-w-[900px] text-[0.95rem] leading-7 text-[#303839]/76">
                        {term.text}
                      </p>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>

        <section className="mx-auto mt-8 flex max-w-[1320px] flex-col gap-6 rounded-none border border-[#303839]/8 bg-[#f8f6f1] px-6 py-7 text-[#303839] shadow-[0_16px_42px_rgba(48,56,57,0.05)] sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.24em] text-[#303839]">
              Need Help?
            </p>
            <h2 className="mt-2 font-display text-[2rem] font-medium leading-tight text-[#303839] sm:text-[2.35rem]">
              Questions about these terms?
            </h2>
            <p className="mt-2 max-w-[570px] text-[0.92rem] leading-6 text-[#303839]/76">
              Contact our support team for order questions, personalization details, delivery updates, or help understanding these terms.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[440px]">
            <Link
              href="/contact"
              className="inline-flex h-14 items-center justify-center rounded-none bg-[#303839] px-7 text-[0.88rem] font-extrabold text-white transition hover:bg-[#434c4d] focus:outline-none focus:ring-2 focus:ring-[#303839]/30 focus:ring-offset-2"
            >
              Contact Support
            </Link>
            <Link
              href="/support#faq"
              className="inline-flex h-14 items-center justify-center rounded-none border border-[#303839]/60 bg-white/30 px-7 text-[0.88rem] font-extrabold text-[#303839] transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#303839]/20 focus:ring-offset-2"
            >
              Visit FAQ
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}

function toId(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function ChevronDownIcon({ className }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
