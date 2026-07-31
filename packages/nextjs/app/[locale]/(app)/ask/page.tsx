import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";

export default async function AskPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  redirect({ href: "/agents/overview", locale });
}
