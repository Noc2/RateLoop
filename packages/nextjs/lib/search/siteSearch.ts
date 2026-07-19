export type SiteSearchEntry = {
  title: string;
  href: string;
  area: "Page" | "Docs";
  description: string;
  keywords?: readonly string[];
};

export const SITE_SEARCH_INDEX: readonly SiteSearchEntry[] = [
  {
    title: "RateLoop",
    href: "/",
    area: "Page",
    description: "Human assurance for AI workflows, with blind review, adaptive coverage, and auditable decisions.",
    keywords: ["home", "human assurance loop", "AI review"],
  },
  {
    title: "Discover",
    href: "/human?tab=discover",
    area: "Page",
    description: "Browse and search public review questions and private human-assurance assignments.",
    keywords: ["content", "questions", "review work", "humans", "rate"],
  },
  {
    title: "Agents",
    href: "/agents",
    area: "Page",
    description: "Connect agents, manage review policies, and inspect human-assurance evidence.",
    keywords: ["agent setup", "MCP connection", "evaluations", "workspace"],
  },
  {
    title: "Pricing",
    href: "/pricing",
    area: "Page",
    description: "Compare RateLoop workspace plans and paid-panel costs.",
    keywords: ["free", "early access", "subscription", "USDC", "cost"],
  },
  {
    title: "Terms",
    href: "/legal/terms",
    area: "Page",
    description: "RateLoop terms of service.",
    keywords: ["legal", "agreement"],
  },
  {
    title: "Privacy",
    href: "/legal/privacy",
    area: "Page",
    description: "How RateLoop handles personal data and privacy.",
    keywords: ["legal", "data protection", "GDPR"],
  },
  {
    title: "Imprint",
    href: "/legal/imprint",
    area: "Page",
    description: "RateLoop legal and contact information.",
    keywords: ["legal", "contact", "provider"],
  },
  {
    title: "Introduction",
    href: "/docs",
    area: "Docs",
    description: "Start with RateLoop's human-assurance model and the agent, reviewer, and builder paths.",
    keywords: ["human judgment", "adaptive review", "blind panel", "getting started"],
  },
  {
    title: "Use Cases",
    href: "/docs/use-cases",
    area: "Docs",
    description:
      "Match concrete AI workflow problems to bounded human checks, reviewer audiences, and owner decisions.",
    keywords: [
      "human judgment",
      "examples",
      "customer support",
      "research",
      "UI",
      "extraction",
      "triage",
      "low confidence",
      "classification",
    ],
  },
  {
    title: "Customer replies",
    href: "/docs/use-cases#customer-replies",
    area: "Docs",
    description: "Check whether an AI-generated customer response is ready to send, revise, or escalate.",
    keywords: ["customer support", "support reply", "service", "clarity"],
  },
  {
    title: "Research and client work",
    href: "/docs/use-cases#research-deliverables",
    area: "Docs",
    description: "Ask qualified humans whether a research conclusion is supported and ready for its recipient.",
    keywords: ["research deliverable", "client report", "sources", "consulting"],
  },
  {
    title: "Product experiences",
    href: "/docs/use-cases#product-experiences",
    area: "Docs",
    description: "Check UI clarity and public-safe screenshots, images, video, or campaign material before release.",
    keywords: ["UI clarity", "UX", "screenshot", "marketing", "public content"],
  },
  {
    title: "How It Works",
    href: "/docs/how-it-works",
    area: "Docs",
    description: "Follow adaptive review coverage, one review cycle, reviewer work, settlement, and decision evidence.",
    keywords: ["workflow", "review cycle", "assurance loop"],
  },
  {
    title: "Evidence sets review coverage",
    href: "/docs/how-it-works#adaptive-review",
    area: "Docs",
    description: "Learn how evidence scope, agreement windows, risk, and review gaps change baseline coverage.",
    keywords: ["100%", "50%", "25%", "10%", "calibration", "monitoring"],
  },
  {
    title: "One human-review cycle",
    href: "/docs/how-it-works#agent-flow",
    area: "Docs",
    description: "Quote, create an ask, fund it, wait for the operation, and read the result.",
    keywords: ["quote ask payment wait result", "agent flow", "x402"],
  },
  {
    title: "The reviewer flow",
    href: "/docs/how-it-works#reviewer-flow",
    area: "Docs",
    description: "Eligibility, blinded assignments, sealed answers, panel predictions, and paid claims.",
    keywords: ["human reviewer", "paid work", "commit", "prediction"],
  },
  {
    title: "Settlement paths",
    href: "/docs/how-it-works#settlement-paths",
    area: "Docs",
    description: "See normal settlement, zero-commit refunds, quorum failure, and beacon-failure compensation.",
    keywords: ["refund", "compensation", "accepted work", "terminal path"],
  },
  {
    title: "Decision evidence",
    href: "/docs/how-it-works#decision-evidence",
    area: "Docs",
    description: "Interpret verdicts, reasons, disagreement, scoring, compensation, and settlement references.",
    keywords: ["decision packet", "result", "audit"],
  },
  {
    title: "Evidence & Compliance Mapping",
    href: "/docs/evidence",
    area: "Docs",
    description: "Inspect review packet fields, local verification steps, framework mappings, and explicit limits.",
    keywords: ["auditor", "compliance map", "Ed25519", "Merkle", "OSCAL", "host reported provenance"],
  },
  {
    title: "Human Oversight",
    href: "/docs/human-oversight",
    area: "Docs",
    description:
      "See how monitoring, override, stop, designation, and training capabilities map to EU AI Act oversight measures.",
    keywords: ["human oversight", "EU AI Act", "Article 14", "override", "stop control", "shared responsibility"],
  },
  {
    title: "Check assurance evidence",
    href: "/docs/evidence#verify",
    area: "Docs",
    description: "Check packet signatures, recomputation roots, chain references, and optional external receipts.",
    keywords: ["evidence verify", "audit verify", "public key pin", "Rekor", "RFC 3161"],
  },
  {
    title: "Evidence framework cross-reference",
    href: "/docs/evidence#compliance-map",
    area: "Docs",
    description:
      "Map RateLoop artifacts to ISO 42001, the EU AI Act, NIST AI RMF, FINRA, and SEC recordkeeping references.",
    keywords: ["A.6", "A.9.2", "Article 12", "Article 26", "MEASURE", "MANAGE", "17a-4"],
  },
  {
    title: "Agents & MCP",
    href: "/docs/ai",
    area: "Docs",
    description: "Connect agent clients and choose browser-handoff, delegated prepaid, or self-funded publishing.",
    keywords: ["Codex", "Claude", "Cursor", "Copilot", "Gemini", "OpenClaw", "remote MCP", "workspace MCP"],
  },
  {
    title: "Agent publishing lanes",
    href: "/docs/ai#choose-a-publishing-lane",
    area: "Docs",
    description: "Compare approval-bound browser handoffs with policy-bound autonomous publishing.",
    keywords: ["browser handoff", "delegated prepaid", "self-funded", "API key"],
  },
  {
    title: "Agent approval and privacy",
    href: "/docs/ai#approval-and-privacy-boundary",
    area: "Docs",
    description: "Review exactly what leaves the workspace before creating a public browser handoff.",
    keywords: ["sensitive data", "redaction", "explicit approval", "handoff"],
  },
  {
    title: "SDK",
    href: "/docs/sdk",
    area: "Docs",
    description: "Add a paid human-assurance panel through the versioned quote, ask, payment, wait, and result API.",
    keywords: ["TypeScript", "createTokenlessRateLoopClient", "integration", "authorization", "idempotency"],
  },
  {
    title: "API Errors",
    href: "/docs/ai/errors",
    area: "Docs",
    description: "Understand stable v1 API error codes, recovery actions, and polling rules.",
    keywords: ["invalid_quote", "quote_expired", "idempotency_conflict", "result_not_ready"],
  },
  {
    title: "Tech Stack",
    href: "/docs/tech-stack",
    area: "Docs",
    description: "The mechanisms behind RateLoop's production human-assurance loop.",
    keywords: ["architecture", "Base", "USDC", "MCP", "RBTS"],
  },
  {
    title: "MCP Adapter",
    href: "/docs/tech-stack#mcp-adapter",
    area: "Docs",
    description: "Expose public browser handoffs and private workspace operations over Streamable HTTP.",
    keywords: ["Model Context Protocol", "agent integration"],
  },
  {
    title: "x402 + USDC",
    href: "/docs/tech-stack#x402-usdc",
    area: "Docs",
    description: "Fund panels with short-lived EIP-3009 USDC authorizations or a prepaid workspace balance.",
    keywords: ["payment", "agent wallet", "Base", "prepaid"],
  },
  {
    title: "Proof of Human",
    href: "/docs/tech-stack#proof-of-human",
    area: "Docs",
    description: "Use provider-scoped uniqueness for RateLoop-network reviewer admission.",
    keywords: ["World ID", "unique human", "eligibility"],
  },
  {
    title: "Audience Policies",
    href: "/docs/tech-stack#audience-policies",
    area: "Docs",
    description: "Freeze invited, network, or hybrid reviewer rules for one ask.",
    keywords: ["panel", "admission", "reviewer source", "publication"],
  },
  {
    title: "Correlation-Diversified Assignment",
    href: "/docs/tech-stack#correlation-diversified-assignment",
    area: "Docs",
    description: "Avoid repeatedly assigning closely connected reviewers while keeping private linkage encrypted.",
    keywords: ["correlation", "assignment", "privacy"],
  },
  {
    title: "Commit-Reveal",
    href: "/docs/tech-stack#commit-reveal",
    area: "Docs",
    description: "Seal answers, predictions, and reasons so reviewers cannot copy visible momentum.",
    keywords: ["blind review", "commitment", "sealed report"],
  },
  {
    title: "drand/tlock",
    href: "/docs/tech-stack#drand-tlock",
    area: "Docs",
    description: "Open timelock-encrypted reports with a future public randomness beacon.",
    keywords: ["beacon", "encryption", "self reveal"],
  },
  {
    title: "Robust Bayesian Truth Serum",
    href: "/docs/tech-stack#robust-bayesian-truth-serum",
    area: "Docs",
    description: "Score blind binary answers and panel predictions for a bounded RBTS bonus.",
    keywords: ["RBTS", "peer prediction", "quadratic score", "bonus"],
  },
  {
    title: "Surprisingly Popular",
    href: "/docs/tech-stack#surprisingly-popular",
    area: "Docs",
    description: "Compare actual and predicted answer shares for a platform-funded top-up.",
    keywords: ["surprise margin", "reward", "panel"],
  },
  {
    title: "Base + USDC",
    href: "/docs/tech-stack#base-usdc",
    area: "Docs",
    description: "Settle quotes, reserves, compensation, and claims on Base in USDC.",
    keywords: ["blockchain", "payment", "claim"],
  },
  {
    title: "Immutable Fund Core",
    href: "/docs/tech-stack#immutable-fund-core",
    area: "Docs",
    description: "Hold customer funds without an operator path and enforce deterministic settlement.",
    keywords: ["TokenlessPanel", "custody", "refund", "claim", "smart contract"],
  },
  {
    title: "Decision Packets",
    href: "/docs/tech-stack#decision-packets",
    area: "Docs",
    description: "Join settlement records with reports, reasons, disagreement, payment state, and evidence hashes.",
    keywords: ["structured result", "audit", "evidence"],
  },
  {
    title: "Smart Contracts",
    href: "/docs/smart-contracts",
    area: "Docs",
    description: "Understand RateLoop's immutable fund core, credential issuer, and x402 funding adapter.",
    keywords: ["TokenlessPanel", "CredentialIssuer", "X402PanelSubmitter", "deployment key"],
  },
] as const;

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function score(entry: SiteSearchEntry, terms: readonly string[], normalizedQuery: string) {
  const title = normalize(entry.title);
  const description = normalize(entry.description);
  const keywords = normalize(entry.keywords?.join(" ") ?? "");
  const href = normalize(entry.href);
  const searchable = `${title} ${description} ${keywords} ${href}`;

  if (!terms.every(term => searchable.includes(term))) return -1;

  let value = entry.area === "Docs" ? 2 : 0;
  if (title === normalizedQuery) value += 100;
  else if (title.startsWith(normalizedQuery)) value += 60;
  else if (title.includes(normalizedQuery)) value += 40;
  for (const term of terms) {
    if (title.includes(term)) value += 12;
    if (keywords.includes(term)) value += 6;
    if (description.includes(term)) value += 3;
  }
  return value;
}

export function searchSite(query: string, limit = 12): SiteSearchEntry[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(/\s+/);

  return SITE_SEARCH_INDEX.map((entry, index) => ({ entry, index, score: score(entry, terms, normalizedQuery) }))
    .filter(result => result.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(result => result.entry);
}
