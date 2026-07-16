import type { Metadata } from "next";
import { BetterAuthSignIn } from "~~/components/auth/BetterAuthSignIn";
import { SignInSurface } from "~~/components/auth/SignInSurface";

export const metadata: Metadata = {
  title: "Sign in | RateLoop",
  description: "Sign in to RateLoop without creating or connecting a wallet.",
};

export default function SignInPage() {
  return (
    <SignInSurface
      description="Sign in to your RateLoop account. No wallet required."
      title="Sign in"
      titleId="sign-in-title"
    >
      <div className="text-left">
        <BetterAuthSignIn />
      </div>
    </SignInSurface>
  );
}
