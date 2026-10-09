import { Suspense } from "react";
import AuthPage from "../components/auth-page";
import { noindexPageMetadata } from "@/lib/seo/metadata";

export const metadata = noindexPageMetadata("Forgot Password");

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage mode="forgot" />
    </Suspense>
  );
}
