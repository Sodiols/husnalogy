import Hero from "./components/hero";
import Categories from "./components/categories";
import GiftingIdeas from "./components/gifting-ideas";
import About from "./components/about";
import Newsletter from "./components/newsletter";
import { getHeroSpotlight } from "@/lib/hero";

export const metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const spotlight = await getHeroSpotlight();

  return (
    <>
      <Hero spotlight={spotlight} />
      <Categories />
      <GiftingIdeas />
      <About />
      <Newsletter />
    </>
  );
}
