import AboutHero from "./components/aboutHero";
import AboutStory from "./components/aboutStory";
import AboutValues from "./components/aboutValues";
import AboutDesign from "./components/aboutDesign";
import AboutProcess from "./components/aboutProcess";
import AboutClosing from "./components/aboutClosing";
import AboutFAQ from "./components/aboutFAQ";
import Newsletter from "../components/newsletter";
import type { CSSProperties } from "react";
import { staticPageMetadata } from "@/lib/seo/pages";

export const metadata = staticPageMetadata("/about");

export default function AboutPage() {
  return (
    <main
      className="bg-cream text-ink"
      // The hero's own font variables resolve through these.
      style={{
        "--font-caveat": "var(--font-cormorant)",
        "--font-montserrat": "var(--font-inter)",
      } as CSSProperties}
    >
      <AboutHero />
      {/* Scrolls up over the pinned hero. Below it, sections alternate cream
          and white like the home page, with one charcoal band for the note. */}
      <div className="relative z-10 bg-cream">
        <AboutStory />
        <AboutValues />
        <AboutDesign />
        <AboutProcess />
        <AboutClosing />
        <AboutFAQ />
        <Newsletter />
      </div>
    </main>
  );
}
