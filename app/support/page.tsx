import SupportClient from "./support-client";
import { staticPageMetadata } from "@/lib/seo/pages";

export const metadata = staticPageMetadata("/support");

export default function SupportPage() {
  return <SupportClient />;
}
