import { Suspense } from "react";
import AuthPage from "../components/auth-page";

export const metadata = {
  title: "Reset Password",
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage mode="reset" />
    </Suspense>
  );
}
