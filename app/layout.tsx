import localFont from "next/font/local";

import "./globals.css";
import SiteShell from "./components/site-shell";
import { createClient } from "@/lib/supabase/server";
import { formatSupabaseUser } from "./lib/format-user";
import { getSettings, toPublicSettings } from "@/lib/settings";
import { logServerFailure } from "@/lib/core/server-errors";
import { BUSINESS_INFO } from "@/lib/launch-config";
import { getSiteUrl } from "@/lib/site-url";
import { serializeJsonLd } from "@/lib/security/json-ld";
import { INDEXABLE_ROBOTS, SITE_NAME } from "@/lib/seo/metadata";
import { getPublicPage } from "@/lib/seo/pages";
import { DEFAULT_SHARE_IMAGE } from "@/lib/seo/share-image";

const fontDisplay = localFont({
  src: [
    { path: "./brand-fonts/CormorantGaramond-400.ttf", weight: "400", style: "normal" },
    { path: "./brand-fonts/CormorantGaramond-400-italic.ttf", weight: "400", style: "italic" },
    { path: "./brand-fonts/CormorantGaramond-500.ttf", weight: "500", style: "normal" },
    { path: "./brand-fonts/CormorantGaramond-600.ttf", weight: "600", style: "normal" },
    { path: "./brand-fonts/CormorantGaramond-700.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-cormorant",
  display: "swap",
  fallback: ["Georgia", "serif"],
});
const fontBody = localFont({
  src: [
    { path: "./brand-fonts/Inter-400.ttf", weight: "400", style: "normal" },
    { path: "./brand-fonts/Inter-400-italic.ttf", weight: "400", style: "italic" },
    { path: "./brand-fonts/Inter-500.ttf", weight: "500", style: "normal" },
    { path: "./brand-fonts/Inter-600.ttf", weight: "600", style: "normal" },
    { path: "./brand-fonts/Inter-700.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: ["Arial", "sans-serif"],
});
const fontVariables = `${fontDisplay.variable} ${fontBody.variable}`;

const SITE_URL = getSiteUrl();

const HOME_PAGE = getPublicPage("/");
const DESCRIPTION = HOME_PAGE.description;

// Site-wide defaults only. No canonical and no og:url here: a page that sets
// neither must not claim to be the homepage. Every public page builds its own
// complete set through lib/seo (Next merges metadata objects shallowly).
export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: HOME_PAGE.title,
    template: "%s - Husnalogy",
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: HOME_PAGE.title,
    description: DESCRIPTION,
    locale: "en_US",
    images: [DEFAULT_SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_PAGE.title,
    description: DESCRIPTION,
    images: [{ url: DEFAULT_SHARE_IMAGE.url, alt: DEFAULT_SHARE_IMAGE.alt }],
  },
  robots: INDEXABLE_ROBOTS,
  icons: {
    icon: "/Brand Kit/Logo-1.png",
    shortcut: "/Brand Kit/Logo-1.png",
    apple: "/Brand Kit/Logo-1.png",
  },
};

async function getInitialUser() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name,email,role,avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    return formatSupabaseUser(user, profile);
  } catch (error) {
    // Next.js aborts a render by THROWING — that is how redirect(), notFound()
    // and the static-generation bailouts all work, and swallowing one of those
    // would turn it into a silently wrong page. `logServerFailure` rethrows
    // every such signal and only logs a genuine failure.
    logServerFailure("Could not resolve server-side auth state", error);
    return null;
  }
}

async function getInitialSettings() {
  try {
    return toPublicSettings(await getSettings());
  } catch (error) {
    logServerFailure("Could not resolve server-side site settings", error);
    return null;
  }
}

export default async function RootLayout({ children }) {
  const [initialUser, initialSettings] = await Promise.all([getInitialUser(), getInitialSettings()]);
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Husnalogy",
    url: SITE_URL,
    logo: `${SITE_URL}/Brand%20Kit/Logo-1.png`,
    description: DESCRIPTION,
    email: BUSINESS_INFO.email,
    telephone: BUSINESS_INFO.phone,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS_INFO.address,
      addressLocality: BUSINESS_INFO.city,
      addressCountry: "BD",
    },
    sameAs: Object.values(BUSINESS_INFO.socialProfiles),
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Husnalogy",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <html lang="en" className={fontVariables} data-scroll-behavior="smooth">
      <head>
        <link rel="dns-prefetch" href="https://cdnjs.cloudflare.com" />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd) }}
        />
      </head>

      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's
          cz-shortcut-listen) inject attributes on <body> before React hydrates,
          which would otherwise log a false-positive hydration mismatch. */}
      <body
        suppressHydrationWarning
        className="bg-white font-body text-charcoal antialiased selection:bg-cream selection:text-black"
      >
        <SiteShell initialUser={initialUser} initialSettings={initialSettings}>{children}</SiteShell>
      </body>
    </html>
  );
}
