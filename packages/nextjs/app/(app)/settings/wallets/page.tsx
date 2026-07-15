import type { Metadata } from "next";
import { WalletBindingsClient } from "~~/components/auth/WalletBindingsClient";

export const metadata: Metadata = {
  title: "Wallets | RateLoop",
  description: "Optionally bind a purpose-scoped funding, payout, or recovery wallet.",
};

export default function WalletSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:py-16">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--rateloop-blue)]">Account settings</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Optional wallets</h1>
      <p className="mt-5 max-w-3xl text-base leading-7 text-base-content/65">
        Your Better Auth account comes first. Add a wallet only when a public USDC funding, payout, or recovery action
        requires one.
      </p>
      <div className="mt-10">
        <WalletBindingsClient managedWalletEnabled={process.env.TOKENLESS_THIRDWEB_WALLET_ENABLED === "true"} />
      </div>
    </main>
  );
}
