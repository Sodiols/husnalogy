import { Suspense } from "react";
import AuthPage from "../components/auth-page";
import { noindexPageMetadata } from "@/lib/seo/metadata";

export const metadata = noindexPageMetadata("Reset Password");

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage mode="reset" />
    </Suspense>
  );
}
