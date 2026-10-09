import { Suspense } from "react";
import AuthPage from "../components/auth-page";
import { noindexPageMetadata } from "@/lib/seo/metadata";

export const metadata = noindexPageMetadata("Login");

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage mode="login" />
    </Suspense>
  );
}
