import Link from "next/link";
import type { Metadata } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { UseCaseExampleCard, UseCaseIcon } from "~~/components/docs/UseCaseVisuals";
import type { UseCaseExample, UseCaseIconKind } from "~~/components/docs/UseCaseVisuals";

export const metadata = {
  title: "Human Assurance Use Cases",
  description:
    "Three worked examples of independent human judgment checking AI-generated customer replies, research conclusions, and hiring recommendations.",
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
  legalContext?: {
    label: string;
    body: string;
    sources: readonly { label: string; href: string }[];
  };
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
    id: "hiring-decisions",
    title: "AI-assisted hiring",
    icon: "hiring",
    color: "var(--rateloop-pink)",
    scenario:
      "A recruiting system ranks applicants and recommends who should advance. A plausible recommendation can still overlook job-relevant evidence or reproduce discriminatory patterns.",
    trigger:
      "Before a recommendation materially influences who advances or is rejected, and after a material model, prompt, data, or workflow change.",
    reviewers:
      "Authorized recruiting or employment specialists with the competence, training, and authority required for the workflow. Candidate data stays in a private invited-review lane.",
    decision:
      "A recorded human result, reasons, disagreement, timing, and any override or escalation. The designated hiring owner remains responsible for the decision.",
    example: {
      color: "var(--rateloop-pink)",
      artifactLabel: "AI recommendation",
      artifact: "“Do not advance — no team-lead experience.”",
      question: "Does the supplied application evidence support this recommendation under the approved job criteria?",
      verdict: "Override — 4 of 5 authorized reviewers",
      reasons: ["CV shows two years leading six engineers", "Relevant contract role was omitted"],
      outcome:
        "The hiring owner advances the candidate, records the override, and checks whether other applicants were affected.",
    },
    legalContext: {
      label: "EU AI Act · high-risk context",
      body: "AI used to analyse applications or evaluate candidates is listed in Annex III. For systems that qualify as high-risk under Article 6, the Act requires effective human oversight, and deployers must assign people with the necessary competence, training, and authority. The Commission currently says the employment rules apply from 2 December 2027. RateLoop can support the review workflow and its evidence; it does not determine legal classification, perform the provider's conformity assessment, or make a system compliant.",
      sources: [
        { label: "Annex III", href: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3" },
        { label: "Article 6", href: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-6" },
        { label: "Article 14", href: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14" },
        { label: "Article 26", href: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-26" },
        { label: "Article 43", href: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-43" },
        {
          label: "Current EU timeline",
          href: "https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-high-risk-systems",
        },
      ],
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
            {useCase.legalContext ? (
              <aside className="mt-5 max-w-3xl rounded-xl border border-[var(--rateloop-yellow)]/25 bg-amber-300/[0.06] p-4">
                <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--rateloop-yellow)]">
                  {useCase.legalContext.label}
                </p>
                <p className="mt-2 text-sm leading-6 text-base-content/72">{useCase.legalContext.body}</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold">
                  {useCase.legalContext.sources.map(source => (
                    <a
                      key={source.href}
                      href={source.href}
                      className="text-base-content/65 underline decoration-base-content/30 underline-offset-4 hover:text-base-content"
                    >
                      {source.label}
                    </a>
                  ))}
                </div>
              </aside>
            ) : null}
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
