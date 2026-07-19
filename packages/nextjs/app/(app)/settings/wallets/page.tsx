import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { WalletBindingsClient } from "~~/components/auth/WalletBindingsClient";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";

export const metadata: Metadata = {
  title: "Wallets",
  description: "Set up a wallet for funding or payouts.",
};

export default async function WalletSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ use?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) redirect("/sign-in?returnTo=%2Fsettings%2Fwallets");
  const requestedPurpose = (await searchParams).use;
  const candidate = Array.isArray(requestedPurpose) ? requestedPurpose[0] : requestedPurpose;
  const initialPurpose = candidate === "funding" ? candidate : "payout";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:py-16">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--rateloop-blue)]">Account settings</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Wallets</h1>
      <p className="mt-5 max-w-3xl text-base leading-7 text-base-content/65">
        Add a wallet only when you need to pay for an ask or receive reviewer earnings. A wallet never replaces your
        RateLoop sign-in.
      </p>
      <div className="mt-10">
        <WalletBindingsClient
          initialPurpose={initialPurpose}
          managedWalletEnabled={
            process.env.NODE_ENV !== "production" && process.env.TOKENLESS_THIRDWEB_WALLET_ENABLED === "true"
          }
        />
      </div>
    </main>
  );
}
