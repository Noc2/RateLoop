import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { WalletBindingsClient } from "~~/components/auth/WalletBindingsClient";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
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
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:py-16">
      <Link
        href="/human/profile"
        className="mb-6 inline-flex text-sm font-medium text-base-content/60 transition hover:text-base-content"
      >
        &larr; Back to Profile
      </Link>
      <PageHeading
        accent="blue"
        className="max-w-3xl"
        heading="Wallets"
        subtitle="Add a wallet only when you need to pay for an ask or receive reviewer earnings. A wallet never replaces your RateLoop sign-in."
      />
      <div className="mt-10">
        <WalletBindingsClient
          initialPurpose={initialPurpose}
          managedWalletEnabled={
            process.env.NODE_ENV !== "production" && process.env.TOKENLESS_THIRDWEB_WALLET_ENABLED === "true"
          }
        />
      </div>
    </div>
  );
}
