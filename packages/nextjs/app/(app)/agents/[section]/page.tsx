import { redirect } from "next/navigation";
import { type AgentsSearchParamRecord, AgentsSectionPage } from "../AgentsSectionPage";
import type { Metadata } from "next";
import {
  agentSectionForTab,
  agentTabForSection,
  agentTabHref,
} from "~~/components/tokenless/agents/agentWorkspaceState";
import { agentPageTitle } from "~~/lib/tokenless/pageTitles";

type AgentSectionParams = Promise<{ section: string }>;
type AgentSectionSearchParams = Promise<AgentsSearchParamRecord>;

export async function generateMetadata({ params }: { params: AgentSectionParams }): Promise<Metadata> {
  const tab = agentTabForSection((await params).section);
  return { title: agentPageTitle(tab ?? "overview") };
}

export default async function AgentSectionRoute({
  params,
  searchParams,
}: {
  params: AgentSectionParams;
  searchParams: AgentSectionSearchParams;
}) {
  const [{ section }, requestedSearchParams] = await Promise.all([params, searchParams]);
  const tab = agentTabForSection(section);
  if (!tab) redirect(agentTabHref("overview", undefined, requestedSearchParams));
  if (section !== agentSectionForTab(tab)) {
    redirect(agentTabHref(tab, undefined, requestedSearchParams));
  }
  return <AgentsSectionPage searchParams={requestedSearchParams} tab={tab} />;
}
