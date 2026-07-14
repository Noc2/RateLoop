import { AskPageClient } from "~~/components/tokenless/ask/AskPageClient";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

export default function AskPage() {
  return <AskPageClient sandboxMode={isTokenlessSandboxMode()} />;
}
