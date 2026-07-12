import { TokenlessRateClient } from "~~/components/tokenless/TokenlessRateClient";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

export default function RatePage() {
  return <TokenlessRateClient sandboxMode={isTokenlessSandboxMode()} />;
}
