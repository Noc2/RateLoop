import Link from "next/link";
import { HumanAssuranceLoop } from "~~/components/assurance/HumanAssuranceLoop";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const DOCS_PATHS = [
  {
    number: "01",
    title: "Agents",
    description: "Connect an agent, bind its review policy, and check human assurance before eligible outputs.",
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
        Automated checks can pass while an AI output still needs a contextual decision. RateLoop adds a Human Assurance
        Loop: review frequently at first, then let scoped evidence—not blind trust—decide when baseline review can
        decrease.
      </p>

      <h2>Human judgment that follows the evidence</h2>
      <p>
        A new agent version and workflow starts with 100% review. Repeated agreement can move its baseline coverage to
        50%, 25%, and a 10% monitoring floor. Risk rules, missing context, review gaps, or weaker measured agreement
        keep humans in the loop or restore calibration. The final decision stays with you.
      </p>

      <div className="not-prose my-8">
        <HumanAssuranceLoop />
      </div>

      <div className="not-prose my-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {DOCS_PATHS.map(path => (
          <DocsPathCard key={path.title} {...path} />
        ))}
      </div>

      <h2>Inside one human check</h2>
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
          <Link href="/docs/evidence">Evidence</Link> shows what RateLoop records and how to verify it independently.
        </li>
        <li>
          <Link href="/docs/use-cases">Use Cases</Link> maps concrete AI workflow problems to bounded human checks and
          accountable owner decisions.
        </li>
        <li>
          <Link href="/docs/human-oversight">Human Oversight</Link> maps monitoring, override, and stop capabilities to
          the EU AI Act Article 14(4) oversight measures your people carry out.
        </li>
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
        className="btn btn-sm rateloop-secondary-action mt-auto w-fit px-3 text-sm no-underline"
      >
        {label}
      </Link>
    </section>
  );
}
