import { type HumanSearchParamRecord, HumanSectionPage } from "../HumanSectionPage";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  humanNavigationForSection,
  humanSectionForNavigation,
  humanSectionHref,
} from "~~/components/tokenless/human/humanNavigation";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";

type HumanSectionParams = Promise<{ locale: Locale; section: string }>;
type HumanSectionSearchParams = Promise<HumanSearchParamRecord>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: HumanSectionParams;
  searchParams: HumanSectionSearchParams;
}): Promise<Metadata> {
  const [{ locale, section }, requestedSearchParams] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale, namespace: "human.metadata" });
  const assignment = Array.isArray(requestedSearchParams.assignment)
    ? requestedSearchParams.assignment[0]
    : requestedSearchParams.assignment;
  const invite = Array.isArray(requestedSearchParams.invite)
    ? requestedSearchParams.invite[0]
    : requestedSearchParams.invite;
  const key = assignment
    ? "complete"
    : invite === "1"
      ? "invitation"
      : section === "history" || section === "inbox" || section === "profile" || section === "settings"
        ? section
        : "discover";
  return { title: t(key) };
}

export default async function HumanSectionRoute({
  params,
  searchParams,
}: {
  params: HumanSectionParams;
  searchParams: HumanSectionSearchParams;
}) {
  const [{ locale, section }, requestedSearchParams] = await Promise.all([params, searchParams]);
  const navigation = humanNavigationForSection(section);
  if (!navigation) return redirect({ href: humanSectionHref("discover", requestedSearchParams), locale });
  if (section !== humanSectionForNavigation(navigation)) {
    redirect({ href: humanSectionHref(navigation, requestedSearchParams), locale });
  }
  if (requestedSearchParams.assignment && navigation !== "discover") {
    redirect({ href: humanSectionHref("discover", requestedSearchParams), locale });
  }
  if (requestedSearchParams.view === "history" && navigation === "discover") {
    redirect({ href: humanSectionHref("history", requestedSearchParams), locale });
  }
  return <HumanSectionPage navigation={navigation} searchParams={requestedSearchParams} />;
}
