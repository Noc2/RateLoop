import { redirect } from "next/navigation";
import { type HumanSearchParamRecord, HumanSectionPage } from "../HumanSectionPage";
import type { Metadata } from "next";
import {
  humanNavigationForSection,
  humanSectionForNavigation,
  humanSectionHref,
} from "~~/components/tokenless/human/humanNavigation";
import { humanPageTitle } from "~~/lib/tokenless/pageTitles";

type HumanSectionParams = Promise<{ section: string }>;
type HumanSectionSearchParams = Promise<HumanSearchParamRecord>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: HumanSectionParams;
  searchParams: HumanSectionSearchParams;
}): Promise<Metadata> {
  const [{ section }, requestedSearchParams] = await Promise.all([params, searchParams]);
  return { title: humanPageTitle({ ...requestedSearchParams, routeSection: section }) };
}

export default async function HumanSectionRoute({
  params,
  searchParams,
}: {
  params: HumanSectionParams;
  searchParams: HumanSectionSearchParams;
}) {
  const [{ section }, requestedSearchParams] = await Promise.all([params, searchParams]);
  const navigation = humanNavigationForSection(section);
  if (!navigation) redirect(humanSectionHref("discover", requestedSearchParams));
  if (section !== humanSectionForNavigation(navigation)) {
    redirect(humanSectionHref(navigation, requestedSearchParams));
  }
  if (requestedSearchParams.assignment && navigation !== "discover") {
    redirect(humanSectionHref("discover", requestedSearchParams));
  }
  if (requestedSearchParams.view === "history" && navigation === "discover") {
    redirect(humanSectionHref("history", requestedSearchParams));
  }
  return <HumanSectionPage navigation={navigation} searchParams={requestedSearchParams} />;
}
