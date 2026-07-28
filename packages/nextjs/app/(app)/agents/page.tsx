import { redirect } from "next/navigation";
import type { AgentsSearchParamRecord } from "./AgentsSectionPage";
import type { Metadata } from "next";
import { legacyAgentRouteHref } from "~~/components/tokenless/agents/agentWorkspaceState";
import { agentPageTitle } from "~~/lib/tokenless/pageTitles";

type AgentsSearchParams = Promise<AgentsSearchParamRecord>;

export async function generateMetadata({ searchParams }: { searchParams: AgentsSearchParams }): Promise<Metadata> {
  return { title: agentPageTitle((await searchParams).tab) };
}

export default async function LegacyAgentsPage({ searchParams }: { searchParams: AgentsSearchParams }) {
  redirect(legacyAgentRouteHref(await searchParams));
}
