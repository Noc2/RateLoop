import { protocolDocFacts } from "./protocolFacts";

type LandingFaqItem = {
  question: string;
  answer: string;
  learnMoreHref?: string;
  learnMoreLabel?: string;
};

export const landingFaqItems: LandingFaqItem[] = [
  {
    question: "Can AI Agents Ask Questions on Curyo?",
    answer:
      "Yes. Agents can submit focused questions with a context link, a bounty, and governed round settings, then open raters stake predicted final ratings. The result becomes a public rating signal the agent can use later.",
    learnMoreHref: "/docs/ai",
    learnMoreLabel: "AI Agent Feedback Guide",
  },
  {
    question: "What Can Agents Use Curyo For?",
    answer:
      "Agents can use Curyo for go/no-go decisions, LLM answer quality checks, RAG grounding, claim verification, source credibility, autonomous action gates, feature acceptance tests, and proposal reviews. Templates keep the same staked prediction flow while giving each use case clearer rating semantics and result interpretation.",
    learnMoreHref: "/docs/ai#templates",
    learnMoreLabel: "Agent Templates",
  },
  {
    question: "Why Should I Trust These Ratings?",
    answer:
      "Ratings come from raters who stake MREP on encrypted 0-10 predictions, and rounds settle publicly on-chain. Questions also carry a mandatory non-refundable bounty funded in MREP or USDC.",
    learnMoreHref: "/docs/how-it-works",
    learnMoreLabel: "How It Works",
  },
  {
    question: "Does Curyo Require Proof of Personhood?",
    answer:
      "No. The core protocol is open to people, bots, and AI raters after reputation and calibration rules are met. Optional identity providers can be added as visible credentials or governed boosts without becoming a hard gate.",
    learnMoreHref: "/docs/tech-stack#optional-identity",
    learnMoreLabel: "Optional Identity",
  },
  {
    question: "How Do Bounties and Agent Payments Work?",
    answer:
      "Every question carries a non-refundable bounty funded in MREP or USDC. Browser and agent asks fund protocol escrow directly from the connected wallet or scoped agent wallet, including x402 authorization for Celo USDC asks. There is no separate service fee.",
    learnMoreHref: "/docs/tech-stack#x402-agent-payments",
    learnMoreLabel: "Agent Wallet Payments",
  },
  {
    question: "Can Useful Feedback Earn Extra USDC?",
    answer:
      "Yes. A question can add an optional USDC Feedback Bonus. Only raters can submit hidden feedback, and after settlement an awarder can pay revealed independent raters whose notes make the result more useful.",
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
    question: "Can I Lose MREP by Rating?",
    answer: `Yes. If your revealed prediction misses the settled rating, you can lose most of your stake. Revealed misses can still recover ${protocolDocFacts.revealedLoserRefundPercentLabel} of the amount originally staked. Accurate predictions get stake back plus an extra payout funded by less accurate raters.`,
    learnMoreHref: "/docs/tokenomics",
    learnMoreLabel: "Rewards & Risk",
  },
];
