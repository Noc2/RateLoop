import type { Metadata } from "next";
import { BetterAuthSignIn } from "~~/components/auth/BetterAuthSignIn";
import { SignInSurface } from "~~/components/auth/SignInSurface";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your RateLoop account.",
};

export default function SignInPage() {
  return (
    <SignInSurface branded title="Sign in" titleId="sign-in-title">
      <div className="mt-6 text-left">
        <BetterAuthSignIn />
      </div>
    </SignInSurface>
  );
}
