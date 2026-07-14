import { AskPageClient } from "~~/components/tokenless/ask/AskPageClient";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

export default async function AskPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const requestedTab = (await searchParams).tab;
  const tab = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;
  const initialTab = tab === "private" || tab === "history" ? tab : "public";
  return <AskPageClient initialTab={initialTab} sandboxMode={isTokenlessSandboxMode()} />;
}
