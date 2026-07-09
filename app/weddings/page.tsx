import WeddingHero from "./components/weddingHero";
import ShopByTheme from "./components/shopByTheme";
import WeddingDownHero from "./components/weddingDownHero";
import WeddingCategorySection from "./components/shopByCategory";
import TrendingCollections from "./components/trendingCollections";
import { getTrendingWeddingCollections } from "@/lib/collections";
import Newslatter from "../components/newsletter";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Weddings",
  description:
    "Explore elegant wedding invitations, save the dates, and personalized wedding stationery from Husnalogy.",
};

export default async function WeddingPage() {
  const trendingCollections = await getTrendingWeddingCollections(10);

  return (
    <>
      <WeddingHero />
      <ShopByTheme />
      <WeddingDownHero />
      <TrendingCollections collections={trendingCollections} />
      <WeddingCategorySection />
      <Newslatter />
    </>
  );
}
