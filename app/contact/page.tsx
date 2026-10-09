import ContactClient from "./contact-client";
import { staticPageMetadata } from "@/lib/seo/pages";

export const metadata = staticPageMetadata("/contact");

export default function ContactPage() {
  return <ContactClient />;
}
