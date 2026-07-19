import Link from "next/link";
import type { Metadata } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { UseCaseExampleCard, UseCaseIcon } from "~~/components/docs/UseCaseVisuals";
import type { UseCaseExample, UseCaseIconKind } from "~~/components/docs/UseCaseVisuals";

export const metadata = {
  title: "Human Assurance Use Cases",
  description:
    "Three worked examples of independent human judgment checking AI-generated customer replies, research conclusions, and product experiences.",
} satisfies Metadata;

type UseCase = {
  id: string;
  title: string;
  icon: UseCaseIconKind;
  color: string;
  scenario: string;
  trigger: string;
  reviewers: string;
  decision: string;
  example: UseCaseExample;
};

const useCases: readonly UseCase[] = [
  {
    id: "customer-replies",
    title: "Customer replies",
    icon: "reply",
    color: "var(--rateloop-blue)",
    scenario:
      "A support reply can be grounded and correctly formatted yet still confuse, dismiss, or sound wrong for the situation.",
    trigger:
      "Before the draft is sent — especially after an agent change, or when risk, low confidence, or missing context forces review.",
    reviewers:
      "Support experts when policy correctness matters; general-human judgment for criteria such as clarity or tone.",
    decision:
      "The panel result with reasons and disagreement. The support owner sends, revises, or escalates; a pilot tracks revision rate, turnaround, and escaped issues.",
    example: {
      color: "var(--rateloop-blue)",
      artifactLabel: "Draft reply",
      artifact: "“Your account was flagged correctly under our policy. There is nothing further we can do.”",
      question: "Would you send this response to the customer as written?",
      verdict: "No — 4 of 5 reviewers",
      reasons: ["Reads as dismissive", "No next step offered"],
      outcome: "The owner revises the reply before it reaches the customer.",
    },
  },
  {
    id: "research-deliverables",
    title: "Research and client work",
    icon: "research",
    color: "var(--rateloop-green)",
    scenario:
      "An agent can cite sources and still overstate a conclusion, omit a decision-critical point, or produce work the recipient cannot act on.",
    trigger: "Before the deliverable reaches a client or informs an important internal decision.",
    reviewers:
      "Domain experts for specialist correctness; general readers for clarity or source credibility when that is the agreed criterion.",
    decision:
      "The result with reasons and source-linked evidence. The owner delivers, revises, or escalates; a pilot tracks unsupported-claim flags and acceptance.",
    example: {
      color: "var(--rateloop-green)",
      artifactLabel: "Draft conclusion",
      artifact: "“Churn fell 18% because of the new onboarding flow (source: Q2 cohort dashboard).”",
      question: "Is this conclusion supported by the supplied sources?",
      verdict: "Not supported — 3 of 5 reviewers",
      reasons: ["Pricing changed the same quarter", "Correlation only"],
      outcome: "The owner weakens the claim and adds the caveat before the report goes out.",
    },
  },
  {
    id: "product-experiences",
    title: "Product experiences",
    icon: "experience",
    color: "var(--rateloop-pink)",
    scenario:
      "A screen, campaign, or generated asset can pass automated checks while leaving the intended audience unsure what to do.",
    trigger: "Before release of a bounded screenshot, image set, or video — or to compare two public-safe versions.",
    reviewers:
      "Representative target users when that qualification matters; a general-human panel for broadly legible public experiences.",
    decision:
      "The panel result with reasons and disagreement. The owner publishes, revises, or compares again; a pilot tracks clarity failures and avoided rework.",
    example: {
      color: "var(--rateloop-pink)",
      artifactLabel: "Screens under review",
      artifact: "Two checkout screens: version A pairs the Pay button with a promo banner; version B shows one action.",
      question: "Is the intended next action clear from this screen?",
      verdict: "Version B — 4 of 5 reviewers",
      reasons: ["Banner competes with Pay", "B has one clear action"],
      outcome: "The owner ships version B and keeps the comparison as evidence.",
    },
  },
] as const;

export default function UseCasesPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Cases">Use</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Use RateLoop when automated checks can verify the rules, but a person still has to judge whether an AI output is
        appropriate for this situation. Three worked examples:
      </p>

      <div className="not-prose my-8 grid gap-5">
        {useCases.map(useCase => (
          <section
            key={useCase.id}
            id={useCase.id}
            data-use-case={useCase.id}
            className="rateloop-surface-card scroll-mt-24 rounded-2xl border-l-2 p-5 sm:p-6"
            style={{ borderColor: useCase.color }}
          >
            <div className="flex items-center gap-3">
              <UseCaseIcon kind={useCase.icon} color={useCase.color} />
              <h2 className="text-2xl font-bold text-base-content">{useCase.title}</h2>
            </div>
            <p className="mt-3 max-w-3xl text-base leading-7 text-base-content/68">{useCase.scenario}</p>
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <UseCaseExampleCard example={useCase.example} />
              <dl className="grid content-start gap-4">
                <UseCaseDetail label="When to check">{useCase.trigger}</UseCaseDetail>
                <UseCaseDetail label="Who reviews">{useCase.reviewers}</UseCaseDetail>
                <UseCaseDetail label="What you get back">{useCase.decision}</UseCaseDetail>
              </dl>
            </div>
          </section>
        ))}
      </div>

      <h2>Automate what is objective</h2>
      <p>
        Keep unit tests, schema validation, deterministic policy checks, tracing, and automated evaluators. Route the
        contextual question they cannot settle—clarity, appropriateness, usefulness, or support for a conclusion—to
        people. The same pattern covers classification and extraction exceptions: when ambiguous source material or low
        confidence makes a structured result unreliable, route that case to reviewers who can read the source. Human
        results can also calibrate automated evaluators; they do not turn a subjective judgment into an objective fact.
      </p>

      <h2>Choose reviewers and material separately</h2>
      <p>
        Reviewer qualifications determine who can answer the criterion. Data sensitivity independently determines what
        each configured audience may receive. Private material—customer cases, client work, unreleased
        prototypes—belongs with authorized invited reviewers. A RateLoop network or hybrid panel receives only public,
        synthetic, or safely redacted material. Proof of Human can provide a provider-scoped uniqueness signal; it does
        not prove professional expertise, independence, residence, or suitability for every task.
      </p>

      <h2>When RateLoop is not the right tool</h2>
      <ul>
        <li>Use deterministic automation when it can settle the question reliably.</li>
        <li>Do not use a panel as an emergency control or when the response window is too slow.</li>
        <li>Do not share material the selected reviewers are not authorized to see.</li>
        <li>Do not ask reviewers to decide what the supplied evidence or their expertise cannot support.</li>
        <li>Do not treat the panel as the sole medical, legal, financial, security, or safety approval.</li>
      </ul>

      <p>
        After a model, prompt, tool, or workflow change, review starts again at full coverage for the changed scope;{" "}
        <Link href="/docs/how-it-works">How It Works</Link> explains that calibration and the review and evidence
        lifecycle. For connection and policy-bound integration, continue with{" "}
        <Link href="/docs/ai">Agents &amp; MCP</Link>.
      </p>
    </article>
  );
}

function UseCaseDetail({ children, label }: { children: string; label: string }) {
  return (
    <div>
      <dt className="font-mono text-xs font-semibold uppercase tracking-wider text-base-content/55">{label}</dt>
      <dd className="mt-1 text-sm leading-6 text-base-content/72">{children}</dd>
    </div>
  );
}
