import Link from "next/link";
import { BUSINESS_INFO } from "@/lib/launch-config";
import { noindexPageMetadata } from "@/lib/seo/metadata";

/**
 * Confirmation after a contact enquiry. The contact form navigates here only
 * after /api/contact confirmed the message was saved; a failed send stays on
 * the form with the visitor's text intact.
 *
 * Deliberately generic: no name, email or message is passed in the URL or
 * shown here, so the page is safe to open directly, bookmark or share. It is
 * kept out of search (noindex) and out of the sitemap.
 */
export const metadata = noindexPageMetadata("Thank You", "Your message has been received by the Husnalogy team.");

export default function ThankYouPage() {
  return (
    <main className="text-ink">
      <section className="page-container section">
        <div className="mx-auto flex min-h-[52vh] max-w-[640px] flex-col items-center justify-center text-center">
          <span aria-hidden="true" className="block h-px w-12 bg-[#D4AF37]" />
          <p className="eyebrow mt-6">Message sent</p>
          <h1 className="heading-page mt-3">Thank you for reaching out.</h1>
          <p className="text-lead mt-5 max-w-[520px]">
            We&rsquo;ve received your message and will get back to you by email as soon as we can.
          </p>

          <div className="mt-9 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link href="/products" className="btn btn-primary btn-lg">
              Continue exploring
            </Link>
            <Link href="/" className="btn btn-secondary btn-lg">
              Back to home
            </Link>
          </div>

          <p className="text-caption mt-8">
            Need to add something? Write to{" "}
            <a
              href={`mailto:${BUSINESS_INFO.email}`}
              className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink"
            >
              {BUSINESS_INFO.email}
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
