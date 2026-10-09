import AccountClient from "./account-client";
import { getInitialUser } from "../lib/initial-user";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("My Account");

export default async function AccountPage() {
  return <AccountClient initialUser={await getInitialUser()} />;
}
