import SavedAddressesClient from "./saved-addresses-client";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("Saved Addresses");

export default function SavedAddressesPage() {
  return <SavedAddressesClient />;
}
