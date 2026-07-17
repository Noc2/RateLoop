import type { Metadata } from "next";
import { TokenlessHandoffClient } from "~~/components/tokenless/TokenlessHandoffClient";

export const metadata: Metadata = {
  title: "Review agent handoff",
  description: "Review, edit, quote, and approve a RateLoop human-assurance ask before submission.",
};

export default function TokenlessHandoffPage() {
  return <TokenlessHandoffClient />;
}
