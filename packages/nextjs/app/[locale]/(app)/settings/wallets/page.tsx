import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WalletBindingsClient } from "~~/components/auth/WalletBindingsClient";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import type { Locale } from "~~/i18n/config";
import { Link, redirect } from "~~/i18n/navigation";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";

type WalletParams = Promise<{ locale: Locale }>;

export async function generateMetadata({ params }: { params: WalletParams }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.wallets" });
  return { title: t("metadataTitle"), description: t("metadataDescription") };
}

export default async function WalletSettingsPage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ use?: string | string[] }>;
  params: WalletParams;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.wallets" });
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) redirect({ href: "/sign-in?returnTo=%2Fsettings%2Fwallets", locale });
  const requestedPurpose = (await searchParams).use;
  const candidate = Array.isArray(requestedPurpose) ? requestedPurpose[0] : requestedPurpose;
  const initialPurpose = candidate === "funding" ? candidate : "payout";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:py-16">
      <Link
        href="/human/profile"
        className="mb-6 inline-flex text-sm font-medium text-base-content/60 transition hover:text-base-content"
      >
        &larr; {t("back")}
      </Link>
      <PageHeading accent="blue" className="max-w-3xl" heading={t("title")} subtitle={t("description")} />
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
