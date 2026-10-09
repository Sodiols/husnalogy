import { Suspense } from "react";
import AuthPage from "../components/auth-page";
import { noindexPageMetadata } from "@/lib/seo/metadata";

export const metadata = noindexPageMetadata("Create Account");

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage mode="signup" />
    </Suspense>
  );
}
