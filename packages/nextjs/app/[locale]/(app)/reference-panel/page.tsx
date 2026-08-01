import { cookies } from "next/headers";
import type { Metadata } from "next";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { DsaReferencePanelPilotClient } from "~~/components/tokenless/compliance/DsaReferencePanelPilotClient";
import { dsaReferencePanelCopy } from "~~/components/tokenless/compliance/dsaReferencePanelCopy";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";

type ReferencePanelParams = Promise<{ locale: Locale }>;

export async function generateMetadata({ params }: { params: ReferencePanelParams }): Promise<Metadata> {
  const { locale } = await params;
  const text = dsaReferencePanelCopy(locale);
  return { title: text.title, description: text.subtitle };
}

export default async function ReferencePanelPage({ params }: { params: ReferencePanelParams }) {
  const { locale } = await params;
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) redirect({ href: "/sign-in?returnTo=%2Freference-panel", locale });
  const text = dsaReferencePanelCopy(locale);

  return (
    <AppPageShell outerClassName="pb-12" contentClassName="mx-auto max-w-4xl">
      <PageHeading accent="blue" className="max-w-3xl" heading={text.title} subtitle={text.subtitle} />
      <div className="mt-8">
        <DsaReferencePanelPilotClient locale={locale} />
      </div>
    </AppPageShell>
  );
}
