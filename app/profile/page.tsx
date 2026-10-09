import AccountClient from "../account/account-client";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("My Profile");

export default function ProfilePage() {
  return <AccountClient />;
}
