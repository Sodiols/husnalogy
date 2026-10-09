import { notFound } from "next/navigation";
import { privatePageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata = privatePageMetadata("Admin Login");

export default function AdminLoginPage() {
  notFound();
}
