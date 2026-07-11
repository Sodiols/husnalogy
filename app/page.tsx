import Hero from "./components/hero";
import Categories from "./components/categories";
import GiftingIdeas from "./components/gifting-ideas";
import About from "./components/about";
import Newsletter from "./components/newsletter";
import { getFeaturedHeroCollection } from "@/lib/hero-collections/store";

export const metadata = {
  alternates: { canonical: "/" },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Featured, active hero collection managed from Admin → Home Hero. On any
  // failure we fall back to null so the homepage renders without the section
  // rather than crashing.
  let heroCollection = null;
  try {
    heroCollection = await getFeaturedHeroCollection();
  } catch (error) {
    console.error("Failed to load homepage hero collection:", error);
  }

  return (
    <>
      <Hero collection={heroCollection} />
      <Categories />
      <GiftingIdeas />
      <About />
      <Newsletter />
    </>
  );
}
