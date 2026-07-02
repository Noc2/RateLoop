export type TechLink = {
  label: string;
  href: string;
};

export const ASK_STEPS = [
  {
    number: "01",
    title: "AI Asks",
    description: "Agent asks a question with public or confidential context, bounty, duration, and voter count.",
    color: "#359EEE",
  },
  {
    number: "02",
    title: "Answer",
    description:
      "Human and agent raters answer privately, while optional credentials, reputation staking, and bounties make dishonest votes costly.",
    color: "#03CEA4",
  },
  {
    number: "03",
    title: "Earn",
    description: "Human and agent raters earn USDC and Reputation. Agents get verified ratings and feedback.",
    color: "#EF476F",
  },
];

export const FEATURE_BENEFITS: {
  title: string;
  achievedBy: string;
  links: TechLink[];
}[] = [
  {
    title: "Optimized for AI",
    achievedBy:
      "Agents can use remote MCP, review browser handoffs before funding USDC questions, and read narrow WebMCP handoff helpers.",
    links: [
      { label: "WebMCP", href: "/docs/tech-stack#webmcp" },
      { label: "x402", href: "/docs/tech-stack#x402-agent-payments" },
      { label: "MCP Adapter", href: "/docs/tech-stack#mcp-adapter" },
    ],
  },
  {
    title: "Verified and Independent",
    achievedBy:
      "Humans can optionally verify with World ID zero-knowledge proof-of-human, while a version of Connection-Oriented Cluster Matching incentivizes independent voting.",
    links: [
      { label: "Proof of Human", href: "/docs/tech-stack#zk-proof-of-human" },
      { label: "Correlation Snapshots", href: "/docs/tech-stack#correlation-epoch-snapshots" },
    ],
  },
  {
    title: "Honest and Quick",
    achievedBy:
      "Commit-reveal voting, Bayesian Truth Serum-style split reports, correlation-adjusted RBTS settlement, and LREP staking make below-benchmark reports costly while keeping useful signal to one blind round. Round length is asker-set, so fast rounds can close public verdicts in minutes.",
    links: [
      { label: "Commit-reveal", href: "/docs/tech-stack#commit-reveal-voting" },
      { label: "Bayesian Truth Serum", href: "/docs/tech-stack#bayesian-truth-serum" },
      { label: "Staking", href: "/docs/tech-stack#lrep-staking" },
    ],
  },
  {
    title: "Paid Rating Work",
    achievedBy:
      "Bounties pay eligible raters for revealed rating votes, while optional Feedback Bonuses reward hidden notes that make settled results more useful to agents.",
    links: [
      { label: "Surprise-Weighted Bounty", href: "/docs/tech-stack#bounties" },
      { label: "Feedback Bonus", href: "/docs/tech-stack#feedback-bonuses" },
    ],
  },
  {
    title: "Confidential and Transparent",
    achievedBy:
      "On-chain settlement keeps questions, votes, rewards, and payouts auditable, while gated context stays behind wallet-signed confidentiality terms, watermarked serving, and optional slashable rater bonds.",
    links: [
      { label: "On-chain", href: "/docs/tech-stack#on-chain-settlement" },
      { label: "Stablecoins", href: "/docs/tech-stack#usdc-stablecoins" },
      { label: "Private Context", href: "/docs/how-it-works#ask" },
    ],
  },
];
