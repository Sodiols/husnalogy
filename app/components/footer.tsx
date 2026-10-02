import Link from "next/link";
import { BUSINESS_INFO } from "@/lib/launch-config";

const COLUMNS = [
  {
    title: "Shop",
    links: [
      ["/weddings", "Wedding invitations"],
      ["/save-the-dates", "Save the dates"],
      ["/cards", "Cards"],
      ["/gifts", "Gifts"],
      ["/stationery", "Stationery"],
      ["/products", "Shop all"],
    ],
  },
  {
    title: "Help",
    links: [
      ["/support#help-topics", "How it works"],
      ["/support#faq", "FAQs"],
      ["/support#help-topics", "Shipping and delivery"],
      ["/support#help-topics", "Returns and refunds"],
      ["/contact", "Contact us"],
    ],
  },
  {
    title: "Husnalogy",
    links: [
      ["/about", "About us"],
      ["/collections", "All collections"],
      ["/orders", "Track your orders"],
      ["/account", "Your account"],
    ],
  },
];

export default function Footer() {
  return (
    <footer className="bg-ink text-white">
      {/* Bottom padding keeps the last row clear of the mobile tab bar and the Logy button. */}
      <div className="page-container pb-28 pt-16 lg:pb-24 lg:pt-20">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1.3fr] lg:gap-x-10">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Link href="/" className="inline-block" aria-label="Husnalogy home">
              <img src="/Brand Kit/Logo-5.png" alt="Husnalogy" className="h-11 w-auto object-contain brightness-0 invert" />
            </Link>
            <p className="mt-5 max-w-[300px] text-[15px] leading-7 text-white/80">
              Invitations, cards, gifts and stationery, personalized for the occasions that matter to you.
            </p>
            <div className="mt-6 flex items-center gap-2">
              <SocialLink href={BUSINESS_INFO.socialProfiles.instagram} label="Husnalogy on Instagram" icon="fa-brands fa-instagram" external />
              <SocialLink href={BUSINESS_INFO.socialProfiles.facebook} label="Husnalogy on Facebook" icon="fa-brands fa-facebook-f" external />
              <SocialLink href={`mailto:${BUSINESS_INFO.email}`} label={`Email ${BUSINESS_INFO.email}`} icon="fa-regular fa-envelope" />
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white">{col.title}</h2>
              <ul className="mt-5 space-y-3 text-[15px]">
                {col.links.map(([href, label]) => (
                  <li key={label}>
                    <Link href={href} className="text-white/80 transition-colors hover:text-white hover:underline hover:underline-offset-4">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div className="col-span-2 sm:col-span-1">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white">Get in touch</h2>
            <ul className="mt-5 space-y-3 text-[15px] text-white/80">
              <li>
                <a href={`mailto:${BUSINESS_INFO.email}`} className="break-words transition-colors hover:text-white hover:underline hover:underline-offset-4">
                  {BUSINESS_INFO.email}
                </a>
              </li>
              <li>
                <a href={BUSINESS_INFO.phoneHref} className="transition-colors hover:text-white hover:underline hover:underline-offset-4">
                  {BUSINESS_INFO.phone}
                </a>
              </li>
              {BUSINESS_INFO.supportHours && <li>{BUSINESS_INFO.supportHours}</li>}
              <li className="leading-6">{BUSINESS_INFO.address}</li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/15 pt-6 text-[13px] text-white/70 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {BUSINESS_INFO.name}. All rights reserved.</p>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <li>
              <Link href="/privacy" className="transition-colors hover:text-white">Privacy policy</Link>
            </li>
            <li>
              <Link href="/terms" className="transition-colors hover:text-white">Terms and conditions</Link>
            </li>
            <li>
              <Link href="/support#help-topics" className="transition-colors hover:text-white">Refund policy</Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

function SocialLink({ href, label, icon, external = false }) {
  return (
    <a
      href={href}
      aria-label={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="grid h-11 w-11 place-items-center rounded-full border border-white/25 text-white/85 transition-colors hover:border-white hover:text-white"
    >
      <i className={`${icon} text-base`} aria-hidden="true" />
    </a>
  );
}
