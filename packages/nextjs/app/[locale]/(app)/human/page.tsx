import type { HumanSearchParamRecord } from "./HumanSectionPage";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { legacyHumanRouteHref } from "~~/components/tokenless/human/humanNavigation";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";

type HumanSearchParams = Promise<HumanSearchParamRecord>;
type HumanParams = Promise<{ locale: Locale }>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: HumanParams;
  searchParams: HumanSearchParams;
}): Promise<Metadata> {
  const [{ locale }, requestedSearchParams] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale, namespace: "human.metadata" });
  const assignment = Array.isArray(requestedSearchParams.assignment)
    ? requestedSearchParams.assignment[0]
    : requestedSearchParams.assignment;
  const invite = Array.isArray(requestedSearchParams.invite)
    ? requestedSearchParams.invite[0]
    : requestedSearchParams.invite;
  const tab = Array.isArray(requestedSearchParams.tab) ? requestedSearchParams.tab[0] : requestedSearchParams.tab;
  const view = Array.isArray(requestedSearchParams.view) ? requestedSearchParams.view[0] : requestedSearchParams.view;
  const key = assignment
    ? "complete"
    : invite === "1"
      ? "invitation"
      : tab === "inbox" || tab === "profile" || tab === "settings"
        ? tab
        : view === "history"
          ? "history"
          : "discover";
  return { title: t(key) };
}

export default async function LegacyHumanPage({
  params,
  searchParams,
}: {
  params: HumanParams;
  searchParams: HumanSearchParams;
}) {
  const [{ locale }, requestedSearchParams] = await Promise.all([params, searchParams]);
  redirect({ href: legacyHumanRouteHref(requestedSearchParams), locale });
}
