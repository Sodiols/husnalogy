import AboutHero from "./components/aboutHero";
import AboutStory from "./components/aboutStory";
import AboutValues from "./components/aboutValues";
import AboutDesign from "./components/aboutDesign";
import AboutProcess from "./components/aboutProcess";
import AboutClosing from "./components/aboutClosing";
import AboutScrollSeal from "./components/aboutScrollSeal";
import Newslatter from "../components/newsletter";
import AboutFAQ from "./components/aboutFAQ";
import type { CSSProperties } from "react";

export const metadata = {
  title: "About",
  description:
    "Learn about Husnalogy, a refined design studio for wedding invitations, custom cards, personalized gifts, and meaningful stationery.",
};

export default function AboutPage() {
  return (
    <main
      className="bg-cream text-[#303839]"
      style={{
        "--font-caveat": "var(--font-cormorant)",
        "--font-montserrat": "var(--font-inter)",
      } as CSSProperties}
    >
      <AboutHero />
      {/* Sits above the pinned hero and scrolls up over it (opaque backstop hides the hero). */}
      <div className="relative z-10 bg-cream">
        <AboutStory />
        <AboutValues />
        <AboutDesign />
        <AboutProcess />
        <AboutClosing />
        <AboutScrollSeal />
        <AboutFAQ />
      </div>
      {/* Above the sticky stack so it isn't hidden behind the pinned FAQ on desktop. */}
      <div className="relative z-20 bg-cream">
        <Newslatter />
      </div>
    </main>
  );
}
