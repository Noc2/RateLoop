import { TOKENLESS_HOST_CAPABILITIES } from "~~/lib/tokenless/hostCapabilities";

export type SiteSearchEntry = {
  title: string;
  href: string;
  area: "Task" | "Page" | "Docs";
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
    title: "Connect an agent",
    href: "/agents/connections",
    area: "Task",
    description: "Connect RateLoop to a supported agent host.",
    keywords: ["agent setup", "MCP connection", "add agent", "connection"],
  },
  {
    title: "Set review policy",
    href: "/agents/review-setup",
    area: "Task",
    description: "Change review rules and invite workspace reviewers.",
    keywords: ["invite reviewer", "review settings", "reviews", "audience", "response window"],
  },
  {
    title: "View results",
    href: "/agents/results",
    area: "Task",
    description: "Inspect completed human-review results and pending decisions.",
    keywords: ["evaluations", "review outcome", "decision", "verdict"],
  },
  {
    title: "Export evidence",
    href: "/agents/results#evidence-packets-heading",
    area: "Task",
    description: "Inspect and export workspace review evidence.",
    keywords: ["audit", "download evidence", "verification", "records"],
  },
  {
    title: "Review work",
    href: "/human/review",
    area: "Task",
    description: "Open assigned review work and reviewer history.",
    keywords: ["questions", "to review", "discover", "rate", "human"],
  },
  {
    title: "Reviewer access",
    href: "/human/profile",
    area: "Task",
    description: "Manage reviewer identity and workspace access.",
    keywords: ["profile", "access", "eligibility", "reviewer account"],
  },
  {
    title: "Notifications",
    href: "/human/settings",
    area: "Task",
    description: "Choose which review and account notifications you receive.",
    keywords: ["email", "alerts", "settings"],
  },
  {
    title: "Workspace and billing",
    href: "/agents/billing",
    area: "Task",
    description: "Open workspace access, plan, and billing information.",
    keywords: ["billing", "subscription", "members", "workspace settings", "usage", "plan"],
  },
  {
    title: "Agent workspace",
    href: "/agents/overview",
    area: "Page",
    description: "Open the current workspace overview.",
    keywords: ["agents", "workspace"],
  },
  {
    title: "Pricing",
    href: "/pricing",
    area: "Page",
    description: "Compare RateLoop workspace plans and included review decisions.",
    keywords: ["free", "early access", "subscription", "cost"],
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
    description: "Start with connection, review policy, reviewer work, and evidence tasks.",
    keywords: ["human judgment", "invited review", "getting started"],
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
      "candidate ranking",
      "hiring",
      "EU AI Act",
      "high-risk AI",
      "human oversight",
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
    title: "AI-assisted hiring",
    href: "/docs/use-cases#hiring-decisions",
    area: "Docs",
    description:
      "Put authorized human oversight around an AI-assisted candidate recommendation before it affects selection.",
    keywords: ["candidate ranking", "recruitment", "employment", "HR", "EU AI Act", "high-risk AI", "Article 14"],
  },
  {
    title: "How It Works",
    href: "/docs/how-it-works",
    area: "Docs",
    description: "Follow the hosted agent, invited-reviewer, result, and evidence journey.",
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
    description: "Evaluate eligible work, request one review, wait, and read the result.",
    keywords: ["agent flow", "request review", "wait for review"],
  },
  {
    title: "The reviewer flow",
    href: "/docs/how-it-works#reviewer-flow",
    area: "Docs",
    description: "See how invited workspace reviewers receive and answer assigned work.",
    keywords: ["human reviewer", "assignment", "independent answer"],
  },
  {
    title: "Decision evidence",
    href: "/docs/how-it-works#decision-evidence",
    area: "Docs",
    description: "Interpret verdicts, reasons, disagreement, policy scope, and available evidence.",
    keywords: ["decision packet", "result", "audit"],
  },
  {
    title: "Evidence reference",
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
    description: "Map RateLoop artifacts to ISO 42001, the EU AI Act, NIST AI RMF, and FINRA references.",
    keywords: ["A.6", "A.9.2", "Article 26", "Article 73", "MEASURE", "MANAGE"],
  },
  {
    title: "Connect a Host",
    href: "/docs/connect",
    area: "Docs",
    description: "Pick your agent host for a connection guide generated from the host capability registry.",
    keywords: TOKENLESS_HOST_CAPABILITIES.map(host => host.displayName),
  },
  ...TOKENLESS_HOST_CAPABILITIES.map(
    (host): SiteSearchEntry => ({
      title: `Connect ${host.displayName}`,
      href: `/docs/connect/${host.id}`,
      area: "Docs",
      description: `What to expect, the exact connection message, and support status for ${host.displayName}.`,
      keywords: [host.id, host.category, host.supportTier, ...host.lanes],
    }),
  ),
  {
    title: "Agents & MCP",
    href: "/docs/ai",
    area: "Docs",
    description: "Connect an agent to the hosted invited-review workflow.",
    keywords: ["Codex", "Claude", "Cursor", "Copilot", "Gemini", "OpenClaw", "remote MCP", "workspace MCP"],
  },
  {
    title: "Connected workspace review",
    href: "/docs/ai#workspace-review-flow",
    area: "Docs",
    description: "Follow the protected MCP sequence for one owner-approved review policy.",
    keywords: ["agent context", "evaluate review", "request review", "wait", "result"],
  },
  {
    title: "Agent approval and privacy",
    href: "/docs/ai#public-browser-handoff",
    area: "Docs",
    description: "Review exactly what leaves the workspace before creating a public browser handoff.",
    keywords: ["sensitive data", "redaction", "explicit approval", "handoff"],
  },
  {
    title: "SDK",
    href: "/docs/sdk",
    area: "Docs",
    description: "Technical reference for the separately gated fund-backed settlement API.",
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
    description: "Technical reference for connected review and separately gated settlement architecture.",
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
    description: "Freeze reviewer-source and admission rules for one architecture-level ask.",
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
    description: "Reference the separately gated immutable fund core, credential issuer, and funding adapter.",
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

  let value = entry.area === "Task" ? 20 : entry.area === "Docs" ? 2 : 0;
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

  const seenHrefs = new Set<string>();
  return SITE_SEARCH_INDEX.map((entry, index) => ({ entry, index, score: score(entry, terms, normalizedQuery) }))
    .filter(result => result.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .flatMap(result => {
      if (seenHrefs.has(result.entry.href)) return [];
      seenHrefs.add(result.entry.href);
      return [result.entry];
    })
    .slice(0, limit);
}
