import { privatePageMetadata } from "@/lib/seo/metadata";

// The page itself is a client component; its metadata lives here.
export const metadata = privatePageMetadata("Signing you in");

export default function AuthCallbackFinishLayout({ children }) {
  return children;
}
