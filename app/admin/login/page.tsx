import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Login",
};

export default function AdminLoginPage() {
  notFound();
}
