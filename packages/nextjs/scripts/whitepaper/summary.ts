import { protocolDocFacts } from "../../lib/docs/protocolFacts";
import type { ContentBlock } from "./types";

export const META = {
  title: "RateLoop Whitepaper",
  subtitle: "Level Up Your Agent",
  deck: "Human and AI Raters Guide Decisions and Earn USDC",
  author: "AI",
  version: "0.6",
  date: "May 2026",
};

export const EXECUTIVE_SUMMARY: ContentBlock[] = [
  {
    type: "paragraph",
    text: "RateLoop is a public, paid prediction-rating layer for agents and AI product teams. It exists for the moment an agent should ask instead of guess: publish one bounded question, attach the relevant source context and budget, and get back a durable public result that other agents and apps can inspect later.",
  },
  {
    type: "paragraph",
    text: 'The product design now centers the agent use case from the first screen. The app leads with "Level Up Your Agent," supports it with "Human and AI Raters Guide Decisions and Earn USDC," routes visitors through For Humans and For Agents calls to action, keeps documentation inside the app sidebar shell, and gives agents a dedicated setup surface for wallet funding, signing paths, and policy controls.',
  },
  {
    type: "paragraph",
    text: "The protocol turns rating into an explicit peer-prediction round. Every ask is question-first, requires public context through a URL, image, or YouTube video, and carries a non-refundable bounty funded in LREP or World Chain USDC. Everyone can answer; the bounty payout can remain open or be scoped to verified humans. Raters submit a private thumbs-up/down signal plus a 0-100% prediction of how many raters will vote up. Zero-LREP advisory votes can participate only in rounds that already have a staked vote, do not count toward settlement quorum, and can qualify for launch credits in eligible settled rounds; staked votes add normal settlement upside and downside. Optional hidden feedback unlocks after settlement, and eligible revealed raters claim bounty payouts after challengeable frontend-backed correlation payout snapshots finalize.",
  },
  {
    type: "paragraph",
    text: `Signal integrity comes from combining calibration, optional LREP-backed stake, identity signals, blind rounds, and correlation-capped payouts. Votes and population predictions stay hidden through tlock until the blind epoch ends, later raters earn only ${protocolDocFacts.openPhaseWeightLabel} reward weight instead of ${protocolDocFacts.blindPhaseWeightLabel}, and settlement waits for at least three reveals plus the configured reveal conditions so the result is harder to herd or selectively reveal. The result can be read immediately after settlement; USDC and launch LREP payouts wait for finalized Correlation Epoch Snapshots proposed by registered frontend operators.`,
  },
  {
    type: "paragraph",
    text: "The agent surface is accountless by default and managed only when useful. Public MCP tools, direct JSON routes, typed SDK helpers, x402 authorization, browser signing links, and a local signer CLI let agents quote cost, submit with idempotency, execute wallet-approved funding, confirm transactions, wait asynchronously, and read a machine-usable answer without giving the frontend operator custody of bounty funds.",
  },
  {
    type: "paragraph",
    text: "Because the underlying result lives on-chain, RateLoop behaves like public infrastructure rather than a closed approval service. Agents, frontends, researchers, and evaluation pipelines can audit the same settlement history and payout roots, governance can tune bounds and treasury use in public, and future systems can reuse prior ratings instead of paying to answer the same question repeatedly. The 68M LREP Launch Distribution Pool is split into 35M LREP verified + referral rewards and 33M LREP earned rater rewards so early useful participation earns LREP from verified-human anchored rounds without making verification an ongoing multiplier.",
  },
];
