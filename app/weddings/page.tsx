import WeddingHero from "./components/weddingHero";
import ShopByTheme from "./components/shopByTheme";
import WeddingDownHero from "./components/weddingDownHero";
import WeddingCategorySection from "./components/shopByCategory";
import TrendingCollections from "./components/trendingCollections";
import { getTrendingWeddingCollections } from "@/lib/collections";
import Newslatter from "../components/newsletter";
import { staticPageMetadata } from "@/lib/seo/pages";

export const dynamic = "force-dynamic";

export const metadata = staticPageMetadata("/weddings");

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
