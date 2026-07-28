import { redirect } from "next/navigation";
import type { HumanSearchParamRecord } from "./HumanSectionPage";
import type { Metadata } from "next";
import { legacyHumanRouteHref } from "~~/components/tokenless/human/humanNavigation";
import { humanPageTitle } from "~~/lib/tokenless/pageTitles";

type HumanSearchParams = Promise<HumanSearchParamRecord>;

export async function generateMetadata({ searchParams }: { searchParams: HumanSearchParams }): Promise<Metadata> {
  return { title: humanPageTitle(await searchParams) };
}

export default async function LegacyHumanPage({ searchParams }: { searchParams: HumanSearchParams }) {
  redirect(legacyHumanRouteHref(await searchParams));
}
