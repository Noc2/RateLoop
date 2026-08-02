import type { Metadata } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import {
  LocalizedPublicContent,
  type PublicLocaleParams,
  getLocalizedPublicMetadata,
  usePublicLocale,
} from "~~/components/docs/LocalizedPublicContent";
import { PublicLink as Link } from "~~/components/docs/PublicLink";

export function generateMetadata({ params }: { params: PublicLocaleParams }): Promise<Metadata> {
  return getLocalizedPublicMetadata({ params, section: "docs", title: "Documentation" });
}

const DOCS_PATHS = [
  {
    number: "01",
    title: "Connect an agent",
    href: "/agents/connections",
    color: "var(--rateloop-blue)",
  },
  {
    number: "02",
    title: "Set review policy",
    href: "/agents/review-setup",
    color: "var(--rateloop-green)",
  },
  {
    number: "03",
    title: "Complete a review",
    href: "/human/review",
    color: "var(--rateloop-pink)",
  },
  {
    number: "04",
    title: "Verify evidence",
    href: "/agents/results#evidence-packets-heading",
    color: "var(--rateloop-yellow)",
  },
] as const;

export default function DocsPage({ params }: { params?: PublicLocaleParams } = {}) {
  const locale = usePublicLocale(params);
  return (
    <LocalizedPublicContent locale={locale} section="docs">
      <article className="prose max-w-none">
        <DocsTitle gradientText="Assurance">Human</DocsTitle>

        <h2>Choose a task</h2>

        <nav aria-label="Choose a task" className="not-prose my-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {DOCS_PATHS.map(path => (
            <DocsPathCard key={path.title} {...path} />
          ))}
        </nav>

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
            <Link href="/docs/how-it-works">How It Works</Link>
          </li>
          <li>
            <Link href="/docs/use-cases">Use Cases</Link>
          </li>
          <li>
            <Link href="/docs/evidence">Evidence reference</Link>
          </li>
          <li>
            <Link href="/docs/human-oversight">Human Oversight</Link>
          </li>
        </ul>
      </article>
    </LocalizedPublicContent>
  );
}

function DocsPathCard({ number, title, href, color }: (typeof DOCS_PATHS)[number]) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="group flex min-h-32 flex-col border-l-2 py-3 pl-5 no-underline"
      style={{ borderColor: color }}
    >
      <span className="font-mono text-sm font-semibold tracking-widest" style={{ color }}>
        {number}
      </span>
      <span className="mt-auto flex items-end justify-between gap-4 pt-6">
        <h3 className="text-[1.45rem] font-bold leading-tight text-base-content">{title}</h3>
        <span aria-hidden="true" className="pb-0.5 text-xl text-base-content/55 transition group-hover:translate-x-1">
          →
        </span>
      </span>
    </Link>
  );
}
