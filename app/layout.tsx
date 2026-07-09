import { Cormorant_Garamond, Inter } from "next/font/google";

import "./globals.css";
import SiteShell from "./components/site-shell";
import { createClient } from "@/lib/supabase/server";
import { formatSupabaseUser } from "./lib/format-user";

const fontDisplay = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cormorant",
  display: "swap",
});
const fontBody = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});
const fontVariables = `${fontDisplay.variable} ${fontBody.variable}`;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://husnalogy.com";

const DESCRIPTION =
  "Husnalogy creates premium personalized wedding invitations, save the dates, nikah invitations, cards, gifts and stationery with a refined, minimalist design.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Home - Husnalogy",
    template: "%s - Husnalogy",
  },
  description: DESCRIPTION,
  applicationName: "Husnalogy",
  keywords: [
    "wedding invitations",
    "save the dates",
    "nikah invitations",
    "birthday invitations",
    "personalized gifts",
    "wedding stationery",
    "greeting cards",
    "Husnalogy",
  ],
  authors: [{ name: "Husnalogy" }],
  creator: "Husnalogy",
  publisher: "Husnalogy",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Husnalogy",
    title: "Husnalogy | Wedding Invitations, Cards & Personalized Gifts",
    description: DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
    images: [{ url: "/images/heroIMG.png", width: 1200, height: 630, alt: "Husnalogy invitations and stationery" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Husnalogy | Wedding Invitations, Cards & Personalized Gifts",
    description: DESCRIPTION,
    images: ["/images/heroIMG.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
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
    // Next.js throws this internally to bail a route out of static
    // generation during `next build` (we read cookies(), so every route is
    // dynamic) — it isn't a real failure, so let it propagate instead of
    // logging it as one.
    if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;

    console.error("Could not resolve server-side auth state:", error);
    return null;
  }
}

export default async function RootLayout({ children }) {
  const initialUser = await getInitialUser();
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Husnalogy",
    url: SITE_URL,
    logo: `${SITE_URL}/Brand%20Kit/Logo-1.png`,
    description: DESCRIPTION,
    sameAs: [process.env.SODIOL_FACEBOOK_LINK, process.env.SODIOL_INSTAGRAM_LINK].filter(Boolean),
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
    <html lang="en" className={fontVariables}>
      <head>
        <link rel="dns-prefetch" href="https://cdnjs.cloudflare.com" />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
      </head>

      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's
          cz-shortcut-listen) inject attributes on <body> before React hydrates,
          which would otherwise log a false-positive hydration mismatch. */}
      <body
        suppressHydrationWarning
        className="bg-white font-body text-charcoal antialiased selection:bg-[#E6E6E6] selection:text-black"
      >
        <SiteShell initialUser={initialUser}>{children}</SiteShell>
      </body>
    </html>
  );
}
