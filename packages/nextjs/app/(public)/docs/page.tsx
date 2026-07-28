import Link from "next/link";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const DOCS_PATHS = [
  {
    number: "01",
    title: "Connect an agent",
    description: "Add RateLoop to the agent host your team already uses.",
    href: "/agents?tab=connect",
    label: "Connect",
    color: "var(--rateloop-blue)",
  },
  {
    number: "02",
    title: "Set review policy",
    description: "Choose when the agent asks for review and who can respond.",
    href: "/agents?tab=registry",
    label: "Open Reviews",
    color: "var(--rateloop-green)",
  },
  {
    number: "03",
    title: "Complete a review",
    description: "Open assigned work, answer independently, and add a useful reason.",
    href: "/human?tab=discover",
    label: "Review work",
    color: "var(--rateloop-pink)",
  },
  {
    number: "04",
    title: "Verify evidence",
    description: "Inspect completed review records and export the evidence you need.",
    href: "/agents?tab=evidence",
    label: "Open Evidence",
    color: "var(--rateloop-yellow)",
  },
] as const;

export default function DocsPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Assurance">Human</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Start with the task you need. The hosted service uses invited workspace reviewers for unpaid, private review.
      </p>

      <h2>Choose a task</h2>
      <p>
        Connect the agent first, then set its review policy. Reviewers can complete assigned work while workspace
        members inspect results and evidence.
      </p>

      <div className="not-prose my-8 grid gap-x-8 gap-y-10 sm:grid-cols-2">
        {DOCS_PATHS.map(path => (
          <DocsPathCard key={path.title} {...path} />
        ))}
      </div>

      <h2>How one review works</h2>
      <ol>
        <li>
          <strong>Set policy:</strong> choose the workflow, risk rules, reviewers, and response window.
        </li>
        <li>
          <strong>Request:</strong> the connected agent submits eligible work and waits when review is required.
        </li>
        <li>
          <strong>Review:</strong> invited reviewers answer independently without seeing other responses.
        </li>
        <li>
          <strong>Decide:</strong> use the result, reasons, disagreement, and evidence in your own workflow.
        </li>
      </ol>

      <h2>Learn more</h2>
      <ul>
        <li>
          <Link href="/docs/how-it-works">How It Works</Link> follows the current hosted review journey.
        </li>
        <li>
          <Link href="/docs/use-cases">Use Cases</Link> maps concrete AI workflow problems to bounded human checks and
          accountable owner decisions.
        </li>
        <li>
          <Link href="/docs/evidence">Evidence reference</Link> explains what RateLoop records and what those records do
          and do not establish.
        </li>
        <li>
          <Link href="/docs/human-oversight">Human Oversight</Link> explains the controls your people remain responsible
          for operating.
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
