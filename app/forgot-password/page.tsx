import { Suspense } from "react";
import AuthPage from "../components/auth-page";

export const metadata = {
  title: "Forgot Password",
};

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage mode="forgot" />
    </Suspense>
  );
}
