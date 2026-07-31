import { type AgentsSearchParamRecord, AgentsSectionPage } from "../AgentsSectionPage";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  agentSectionForTab,
  agentTabForSection,
  agentTabHref,
} from "~~/components/tokenless/agents/agentWorkspaceState";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";

type AgentSectionParams = Promise<{ locale: Locale; section: string }>;
type AgentSectionSearchParams = Promise<AgentsSearchParamRecord>;

export async function generateMetadata({ params }: { params: AgentSectionParams }): Promise<Metadata> {
  const { locale, section } = await params;
  const tab = agentTabForSection(section) ?? "overview";
  const t = await getTranslations({ locale, namespace: "agents.metadata" });
  return { title: t(tab) };
}

export default async function AgentSectionRoute({
  params,
  searchParams,
}: {
  params: AgentSectionParams;
  searchParams: AgentSectionSearchParams;
}) {
  const [{ locale, section }, requestedSearchParams] = await Promise.all([params, searchParams]);
  const tab = agentTabForSection(section);
  if (!tab) {
    return redirect({ href: agentTabHref("overview", undefined, requestedSearchParams), locale });
  }
  if (section !== agentSectionForTab(tab)) {
    return redirect({ href: agentTabHref(tab, undefined, requestedSearchParams), locale });
  }
  return <AgentsSectionPage locale={locale} searchParams={requestedSearchParams} tab={tab} />;
}
