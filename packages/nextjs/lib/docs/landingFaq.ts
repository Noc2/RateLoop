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
    learnMoreHref: "/docs/ai#templates",
    learnMoreLabel: "Agent Templates",
  },
  {
    question: "Can I Keep My Question Confidential?",
    answer:
      "Yes. Private context mode serves hosted images and details only to raters who sign wallet-bound confidentiality terms. Serving is watermarked and access-logged, askers can require a slashable LREP or USDC bond, and a proven leak costs the rater their World ID identity's earning power across the protocol. Context can publish after settlement or stay private.",
    learnMoreHref: "/docs/how-it-works#ask",
    learnMoreLabel: "Private Context",
  },
  {
    question: "How Fast Do Rounds Settle?",
    answer:
      "Round length is set per question. Rounds with quick raters can settle within minutes, while rounds that recruit human panels typically take from about an hour to a day. Results are readable at settlement; USDC bounty claims unlock after the payout challenge window.",
    learnMoreHref: "/docs/how-it-works",
    learnMoreLabel: "How It Works",
  },
  {
    question: "Why Should I Trust These Ratings?",
    answer:
      "Ratings come from raters who submit encrypted thumbs-up/down signals plus 0-100% crowd predictions, choose whether to add LREP stake, and settle rounds publicly on-chain. Zero-LREP votes can participate and qualify for launch reputation in eligible rounds. Questions also carry a mandatory non-refundable bounty funded in LREP or USDC.",
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
      "Every question carries a non-refundable bounty. Browser submissions can fund protocol escrow in LREP or USDC, while public agent wallet flows and EIP-3009 authorization use World Chain USDC. There is no separate service fee.",
    learnMoreHref: "/docs/tech-stack#x402-agent-payments",
    learnMoreLabel: "Agent Wallet Payments",
  },
  {
    question: "Can Useful Feedback Earn Extra LREP Or USDC?",
    answer:
      "Yes. A question can add an optional LREP or USDC Feedback Bonus. Only raters can publish feedback, and after settlement an awarder can pay revealed independent raters whose notes make the result more useful.",
    learnMoreHref: "/docs/ai#feedback-bonuses",
    learnMoreLabel: "Feedback Bonuses",
  },
  {
    question: "Why Is Voting Blind?",
    answer:
      "Blind voting hides directions until the phase ends, which reduces herding and rewards independent judgment.",
    learnMoreHref: "/docs/how-it-works#blind-voting",
    learnMoreLabel: "Blind Voting",
  },
  {
    question: "Can I Lose LREP by Rating?",
    answer: `Only if you stake LREP and the score-spread economic threshold is met. Zero-LREP votes can participate and qualify for launch reputation without normal settlement downside. RBTS settlement compares each revealed staked report with the stake-weighted mean score: positive spreads recover full stake and share the 96% voter share of forfeited negative-spread stake, while negative spreads can forfeit with no revealed-loser rebate. ${protocolDocFacts.scoreSpreadForfeitPolicyLabel}`,
    learnMoreHref: "/docs/tokenomics",
    learnMoreLabel: "Rewards & Risk",
  },
];
