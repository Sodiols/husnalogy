"use client";

const COLUMNS = [
  {
    title: "Shop",
    links: [
      ["/weddings", "Wedding Invitations"],
      ["/products", "Occasions"],
      ["/gifts", "Gifts"],
      ["/stationery", "Stationery"],
      ["/products", "Explore All"],
    ],
  },
  {
    title: "Help",
    links: [
      ["/support#help-topics", "How It Works"],
      ["/support#faq", "FAQs"],
      ["/support#help-topics", "Shipping & Delivery"],
      ["/support#help-topics", "Returns & Refunds"],
      ["/contact", "Contact Us"],
    ],
  },
  {
    title: "About",
    links: [
      ["/about", "Our Story"],
      ["/about", "Why Husnalogy"],
      ["/products", "Reviews"],
      ["/about", "Blog"],
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-[#303839]/8 bg-[#f8f6f1] text-[#303839]">
      <div className="mx-auto max-w-[1480px] px-4 py-16 pb-28 sm:px-6 lg:px-10 lg:py-24 lg:pb-24">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1.3fr] lg:gap-x-10">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <a href="/" className="inline-block" aria-label="Husnalogy home">
              <img src="/Brand Kit/Logo-5.png" alt="Husnalogy" className="h-12 w-auto object-contain" />
            </a>
            <p className="mt-5 max-w-[280px] text-[13px] leading-[1.8] text-[#303839]/60">
              Timeless invitations, meaningful gifts and refined stationery crafted with intention for
              life&rsquo;s special moments.
            </p>
            <div className="mt-5 flex items-center gap-4 text-[#303839]/70">
              <a href="https://www.instagram.com/husnalogy" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="transition hover:text-[#303839]">
                <i className="fa-brands fa-instagram text-lg" />
              </a>
              <a href="https://www.facebook.com/husnalogy/" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="transition hover:text-[#303839]">
                <i className="fa-brands fa-facebook-f text-lg" />
              </a>
              <a href="https://www.pinterest.com/" target="_blank" rel="noopener noreferrer" aria-label="Pinterest" className="transition hover:text-[#303839]">
                <i className="fa-brands fa-pinterest-p text-lg" />
              </a>
              <a href="mailto:hello@husnalogy.com" aria-label="Email" className="transition hover:text-[#303839]">
                <i className="fa-regular fa-envelope text-lg" />
              </a>
            </div>
          </div>

          {/* Link columns */}
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#303839]">{col.title}</h4>
              <ul className="mt-6 space-y-3.5 text-[13px] text-[#303839]/65">
                {col.links.map(([href, label]) => (
                  <li key={label}>
                    <a href={href} className="transition hover:text-[#303839]">{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Support */}
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#303839]">Support</h4>
            <div className="mt-6 space-y-3.5 text-[13px] text-[#303839]/65">
              <p className="flex items-center gap-2">
                <i className="fa-solid fa-headset text-[#303839]" /> We&rsquo;re here to help
              </p>
              <a href="mailto:admin@meka.agency" className="block transition hover:text-[#303839]">admin@meka.agency</a>
              <a href="tel:+8801575004432" className="block transition hover:text-[#303839]">+880 1575 004432</a>
              <p>Mon &ndash; Fri, 10 AM &ndash; 6 PM (BST)</p>
            </div>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-[#303839]/10 pt-7 text-xs tracking-[0.02em] text-[#303839]/55 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2025 Husnalogy. All rights reserved.</p>
          <div className="flex items-center gap-3">
            <a href="/privacy" className="transition hover:text-[#303839]">Privacy Policy</a>
            <span className="text-[#303839]/25">|</span>
            <a href="/terms" className="transition hover:text-[#303839]">Terms &amp; Conditions</a>
            <span className="text-[#303839]/25">|</span>
            <a href="/support" className="transition hover:text-[#303839]">Refund Policy</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
