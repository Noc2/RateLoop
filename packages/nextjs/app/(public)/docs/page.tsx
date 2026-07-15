import Link from "next/link";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const DOCS_PATHS = [
  {
    number: "01",
    title: "For Agents",
    description: "Connect through MCP or the SDK, fund one focused question, and receive a structured result.",
    href: "/docs/ai",
    label: "Agent guide",
    color: "var(--rateloop-blue)",
  },
  {
    number: "02",
    title: "For Reviewers",
    description: "Join a blinded panel, report what you see, predict the panel, and claim guaranteed pay plus bonus.",
    href: "/docs/how-it-works#reviewer-flow",
    label: "Review flow",
    color: "var(--rateloop-green)",
  },
  {
    number: "03",
    title: "For Builders",
    description: "Use the versioned quote, ask, wait, and result flow without putting a token in your product.",
    href: "/docs/sdk",
    label: "SDK guide",
    color: "var(--rateloop-pink)",
  },
] as const;

export default function DocsPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Assurance">Human</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        RateLoop gives AI workflows a paid human-review step: ask a focused question, collect independent reports, and
        receive decision evidence your application can inspect.
      </p>

      <h2>One focused quality gate</h2>
      <p>
        Use RateLoop when the next action depends on judgment that a model should not supply alone: approve a candidate,
        revise it, compare two versions, or escalate the case. You choose the criterion and audience; RateLoop runs the
        blinded panel and returns the evidence. The final decision stays with you.
      </p>

      <div className="not-prose my-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {DOCS_PATHS.map(path => (
          <DocsPathCard key={path.title} {...path} />
        ))}
      </div>

      <h2>From question to evidence</h2>
      <ol>
        <li>
          <strong>Define:</strong> write one question, choose the panel, and set the budget.
        </li>
        <li>
          <strong>Review:</strong> eligible humans submit sealed answers and predictions without seeing the crowd.
        </li>
        <li>
          <strong>Settle:</strong> accepted work reaches a paid terminal path in USDC.
        </li>
        <li>
          <strong>Decide:</strong> consume the verdict, reasons, disagreement, and settlement evidence.
        </li>
      </ol>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/docs/how-it-works">How It Works</Link> follows the agent, reviewer, and settlement journeys.
        </li>
        <li>
          <Link href="/docs/tech-stack">Tech Stack</Link> explains MCP, x402, Proof of Human, commit-reveal, RBTS,
          Surprisingly Popular, and Base USDC.
        </li>
        <li>
          <Link href="/docs/smart-contracts">Smart Contracts</Link> describes the immutable fund core and its small
          supporting contract set.
        </li>
      </ul>
    </article>
  );
}

function DocsPathCard({ number, title, description, href, label, color }: (typeof DOCS_PATHS)[number]) {
  return (
    <section className="flex min-h-[12rem] flex-col border-l-2 py-2 pl-5" style={{ borderColor: color }}>
      <span className="font-mono text-sm font-semibold tracking-widest" style={{ color }}>
        {number}
      </span>
      <h3 className="mt-4 text-[1.45rem] font-bold leading-tight text-base-content">{title}</h3>
      <p className="mt-4 text-base leading-7 text-base-content/62">{description}</p>
      <Link
        href={href}
        prefetch={false}
        className="mt-auto w-fit rounded-md bg-base-content/[0.07] px-3 py-1.5 text-sm font-semibold text-base-content/70 no-underline transition hover:bg-base-content/[0.11] hover:text-base-content"
      >
        {label}
      </Link>
    </section>
  );
}
