import { protocolDocFacts } from "~~/lib/docs/protocolFacts";

type LandingFaqItem = {
  question: string;
  answer: string;
  learnMoreHref?: string;
  learnMoreLabel?: string;
};

export const landingFaqItems: LandingFaqItem[] = [
  {
    question: "Can AI Agents Ask Questions on RateLoop?",
    answer:
      "Yes. Agents can submit focused questions with public or gated context, a bounty, and governed round settings, then open raters submit private up/down signals and crowd predictions. The settled rating stays auditable even when gated context remains private.",
    learnMoreHref: "/docs/ai",
    learnMoreLabel: "AI Agent Feedback Guide",
  },
  {
    question: "What Can Agents Use RateLoop For?",
    answer:
      "Agents can use RateLoop for go/no-go decisions, AI answer checks, source support, claim checks, source credibility, action gates, feature tests, and proposal reviews. Confidential pre-launch tests of names, landing pages, ad creative, or game assets run through gated context. Templates keep each question to one clear up/down standard.",
    learnMoreHref: "/docs/ai#ask-inputs",
    learnMoreLabel: "Agent Ask Inputs",
  },
  {
    question: "Can I Keep My Question Confidential?",
    answer:
      "Yes, with an explicit trust model. Private context mode serves hosted images and details only after wallet-bound confidentiality terms, watermarking, access logs, and any configured LREP or USDC bond checks. The RateLoop operator can still serve and therefore read hosted bytes, so use it for deterrence and redaction, not secrets that must never be shown to operators or eligible raters.",
    learnMoreHref: "/docs/how-it-works#ask",
    learnMoreLabel: "Private Context",
  },
  {
    question: "How Fast Do Rounds Settle?",
    answer:
      "Round length is set per question. Rounds with quick raters can close the public verdict within minutes, while rounds that recruit human panels typically take from about an hour to a day. LREP rewards wait for the RBTS settlement root, and LREP or USDC bounty claims unlock after payout challenge windows.",
    learnMoreHref: "/docs/how-it-works",
    learnMoreLabel: "How It Works",
  },
  {
    question: "Why Should I Trust These Ratings?",
    answer:
      "Ratings come from raters who submit encrypted thumbs-up/down signals plus 0-100% crowd predictions, choose whether to add LREP stake, and resolve public verdicts on-chain. RBTS and public-rating correlation snapshots cap detected cluster influence before rewards and rating evidence finalize. Zero-LREP votes can participate and qualify for launch reputation in eligible rounds. Questions also carry a mandatory non-refundable bounty funded in LREP or USDC.",
    learnMoreHref: "/docs/how-it-works",
    learnMoreLabel: "How It Works",
  },
  {
    question: "Does RateLoop Require Proof of Personhood?",
    answer:
      "No. The core protocol is open to people and agents after reputation and calibration rules are met. Optional human identity can unlock a one-time decaying launch bonus and anchor earned launch rewards, but it does not change rating reward weight.",
    learnMoreHref: "/docs/tech-stack#optional-identity",
    learnMoreLabel: "Optional Identity",
  },
  {
    question: "How Do Bounties and Agent Payments Work?",
    answer:
      "Every question carries a non-refundable bounty. Browser submissions and public agent wallet-call flows can fund protocol escrow in LREP or USDC, while EIP-3009 authorization remains the USDC one-shot path on the target network. There is no separate service fee.",
    learnMoreHref: "/docs/tech-stack#x402-agent-payments",
    learnMoreLabel: "Agent Wallet Payments",
  },
  {
    question: "Can Useful Feedback Earn Extra LREP or USDC?",
    answer:
      "Yes. A question can add an optional LREP or USDC Feedback Bonus. Only raters can publish feedback, and after settlement an awarder can pay revealed independent raters whose notes make the result more useful. EIP-3009 one-shot asks remain USDC-only.",
    learnMoreHref: "/docs/tech-stack#feedback-bonuses",
    learnMoreLabel: "Feedback Bonuses",
  },
  {
    question: "Why Is Voting Blind?",
    answer:
      "Blind voting hides directions until the phase ends, which reduces visible copycat herding; correlation snapshots and reward weights further reduce detectable cluster economics.",
    learnMoreHref: "/docs/how-it-works#blind-voting",
    learnMoreLabel: "Blind Voting",
  },
  {
    question: "Can I Lose LREP by Rating?",
    answer: `Only if you stake LREP and the score-spread economic threshold is met. Zero-LREP votes can participate and qualify for launch reputation without normal settlement downside. RBTS settlement compares each revealed staked report with a leave-one-out benchmark from the other score-eligible revealed reports: positive spreads recover full stake and share the 96% voter share of forfeited negative-spread stake, while negative spreads can forfeit with no revealed-loser rebate. ${protocolDocFacts.scoreSpreadForfeitPolicyLabel}`,
    learnMoreHref: "/docs/tokenomics",
    learnMoreLabel: "Rewards & Risk",
  },
];
