import type { Metadata } from "next";
import { BetterAuthSignIn } from "~~/components/auth/BetterAuthSignIn";

export const metadata: Metadata = {
  title: "Sign in | RateLoop",
  description: "Sign in to RateLoop without creating or connecting a wallet.",
};

export default function SignInPage() {
  return (
    <main className="flex grow items-start justify-center px-4 py-16 sm:py-24">
      <section className="surface-card w-full max-w-lg rounded-2xl p-6 sm:p-9" aria-labelledby="sign-in-title">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--rateloop-blue)]">RateLoop account</p>
        <h1 id="sign-in-title" className="mt-4 text-4xl font-semibold tracking-tight">
          Sign in without a wallet
        </h1>
        <p className="mb-8 mt-4 text-base leading-7 text-base-content/65">
          Your account is an opaque RateLoop principal. Add a wallet later only if a funding, payout, or recovery step
          needs one.
        </p>
        <BetterAuthSignIn />
      </section>
    </main>
  );
}
