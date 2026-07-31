import type { AgentsSearchParamRecord } from "./AgentsSectionPage";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { agentTabForSection, legacyAgentRouteHref } from "~~/components/tokenless/agents/agentWorkspaceState";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";

type AgentsSearchParams = Promise<AgentsSearchParamRecord>;
type AgentsParams = Promise<{ locale: Locale }>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: AgentsParams;
  searchParams: AgentsSearchParams;
}): Promise<Metadata> {
  const [{ locale }, requestedSearchParams] = await Promise.all([params, searchParams]);
  const section = Array.isArray(requestedSearchParams.tab) ? requestedSearchParams.tab[0] : requestedSearchParams.tab;
  const tab = agentTabForSection(section ?? "") ?? "overview";
  const t = await getTranslations({ locale, namespace: "agents.metadata" });
  return { title: t(tab) };
}

export default async function LegacyAgentsPage({
  params,
  searchParams,
}: {
  params: AgentsParams;
  searchParams: AgentsSearchParams;
}) {
  const [{ locale }, requestedSearchParams] = await Promise.all([params, searchParams]);
  redirect({ href: legacyAgentRouteHref(requestedSearchParams), locale });
}
