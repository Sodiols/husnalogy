import { Suspense } from "react";
import AuthPage from "../components/auth-page";

export const metadata = {
  title: "Create Account",
};

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage mode="signup" />
    </Suspense>
  );
}
