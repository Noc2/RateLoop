import type { Metadata } from "next";
import { BetterAuthSignIn } from "~~/components/auth/BetterAuthSignIn";
import { SignInSurface } from "~~/components/auth/SignInSurface";

export const metadata: Metadata = {
  title: "Sign-In | RateLoop",
  description: "Sign in to your RateLoop account.",
};

export default function SignInPage() {
  return (
    <SignInSurface title="Sign-In" titleId="sign-in-title">
      <div className="text-left">
        <BetterAuthSignIn />
      </div>
    </SignInSurface>
  );
}
