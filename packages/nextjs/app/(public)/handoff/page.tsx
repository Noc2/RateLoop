import type { Metadata } from "next";
import { TokenlessHandoffClient } from "~~/components/tokenless/TokenlessHandoffClient";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";

export const metadata: Metadata = {
  title: "Review agent handoff | RateLoop",
  description: "Review, edit, quote, and approve a RateLoop human-assurance ask before submission.",
};

export default function TokenlessHandoffPage() {
  return <TokenlessHandoffClient sandboxMode={isTokenlessSandboxMode()} />;
}
