import { TokenlessAskClient } from "~~/components/tokenless/TokenlessAskClient";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

export default function AskPage() {
  return <TokenlessAskClient sandboxMode={isTokenlessSandboxMode()} />;
}
