import type { ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";

export const metadata = {
  title: "Human Assurance Use Cases",
  description:
    "Concrete examples of where independent human judgment can check AI-generated customer replies, research, interfaces, and policy-routed outputs.",
} satisfies Metadata;

const useCases = [
  {
    id: "customer-replies",
    title: "Customer replies",
    color: "var(--rateloop-blue)",
    problem:
      "A support reply can be grounded and correctly formatted yet still confuse, dismiss, or sound wrong for the situation.",
    trigger:
      "Check the draft before it is sent, especially after an agent change or when risk, confidence, or missing context forces review.",
    criterion: "Would you send this response to the customer as written?",
    reviewers:
      "Invite support experts when policy correctness matters. Use general-human judgment only for criteria such as clarity or tone.",
    material:
      "Private customer cases stay with authorized invited reviewers. A network or hybrid panel receives only public, synthetic, or safely redacted material.",
    decision:
      "RateLoop returns the panel result, reasons, and disagreement. The support owner sends, revises, or escalates; a pilot tracks disagreement, revision rate, turnaround, and escaped issues.",
  },
  {
    id: "research-deliverables",
    title: "Research and client work",
    color: "var(--rateloop-green)",
    problem:
      "An agent can cite sources and still overstate a conclusion, omit a decision-critical point, or produce work the recipient cannot act on.",
    trigger: "Check the deliverable before it reaches a client or informs an important internal decision.",
    criterion: "Is this conclusion supported by the supplied sources?",
    reviewers:
      "Invite domain experts for specialist correctness. General readers can judge clarity or source credibility only when that is the frozen criterion.",
    material:
      "Keep private client work with authorized invited reviewers. Send a network or hybrid panel only public, synthetic, or safely redacted sources and conclusions.",
    decision:
      "RateLoop returns the result with reasons and source-linked evidence. The owner delivers, revises, or escalates; a pilot tracks unsupported-claim flags, revisions, and acceptance.",
  },
  {
    id: "product-experiences",
    title: "Product experiences",
    color: "var(--rateloop-pink)",
    problem:
      "A screen, campaign, or generated asset can pass automated checks while leaving the intended audience unsure what to do or understand.",
    trigger: "Check a bounded screenshot, image set, or video before release, or compare two public-safe versions.",
    criterion: "Is the intended next action clear from this screen?",
    reviewers:
      "Invite representative target users when that qualification matters. A general-human panel can judge broadly legible public experiences.",
    material:
      "Keep private prototypes invited-only. Screenshots, image sets, and YouTube video can supply bounded public, synthetic, or safely redacted context.",
    decision:
      "RateLoop returns the panel result, reasons, and disagreement. The owner publishes, revises, or compares again; a pilot tracks clarity failures, preference, and avoided rework.",
  },
  {
    id: "version-calibration",
    title: "Agent-version calibration",
    color: "#F7B32B",
    problem:
      "A model, prompt, tool, or workflow change breaks the assumption that earlier review evidence still describes the current agent.",
    trigger:
      "Start the new evidence scope at full review and evaluate comparable outputs under the same version, policy, workflow, risk tier, and audience.",
    criterion: "Based on the supplied source, should this agent suggestion be accepted?",
    reviewers:
      "Keep the same qualified reviewer audience for the scope. Evidence from another audience or version must not lower review here.",
    material:
      "Freeze the permitted source and suggestion payloads under the policy's separate data boundary for every comparable case.",
    decision:
      "RateLoop records comparable agreement and disagreement. The owner keeps full review or allows scoped coverage to decrease; a pilot tracks agreement, severe disagreement, and coverage by scope.",
  },
  {
    id: "extraction-triage",
    title: "Extraction and triage exceptions",
    color: "#A78BFA",
    problem:
      "An agent classifies a request or extracts a record, but ambiguous source material or low confidence makes the structured result unreliable.",
    trigger:
      "Route the exception when the owner policy detects low confidence, missing context, a higher risk tier, or a maximum unreviewed gap.",
    criterion: "Does the suggested classification or extracted record match the supplied source?",
    reviewers:
      "Invite operations or domain reviewers who understand the source and target schema. General-human judgment is insufficient for specialist correctness.",
    material:
      "Keep private records with authorized invited reviewers. A network or hybrid panel receives only public, synthetic, or safely redacted examples.",
    decision:
      "RateLoop returns the panel result, reasons, and disagreement. The owner accepts, corrects, or escalates; a pilot tracks exception rate, corrections, turnaround, and repeated failure categories.",
  },
] as const;

export default function UseCasesPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Cases">Use</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        Use RateLoop when automated checks can verify the rules, but a person still has to judge whether an AI output is
        appropriate for this situation.
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
            <span
              className="font-mono text-xs font-semibold uppercase tracking-widest"
              style={{ color: useCase.color }}
            >
              Example workflow
            </span>
            <h2 className="mt-3 text-2xl font-bold text-base-content">{useCase.title}</h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-base-content/68">{useCase.problem}</p>
            <dl className="mt-5 grid gap-x-8 gap-y-4 md:grid-cols-2">
              <UseCaseDetail label="Trigger">{useCase.trigger}</UseCaseDetail>
              <UseCaseDetail label="Human check">
                <q>{useCase.criterion}</q>
              </UseCaseDetail>
              <UseCaseDetail label="Reviewer qualifications">{useCase.reviewers}</UseCaseDetail>
              <UseCaseDetail label="Permitted material">{useCase.material}</UseCaseDetail>
              <UseCaseDetail label="Decision and evidence">{useCase.decision}</UseCaseDetail>
            </dl>
          </section>
        ))}
      </div>

      <h2>Automate what is objective</h2>
      <p>
        Keep unit tests, schema validation, deterministic policy checks, tracing, and automated evaluators. Route the
        contextual question they cannot settle—clarity, appropriateness, usefulness, or support for a conclusion—to
        people. Human results can also calibrate automated evaluators; they do not turn a subjective judgment into an
        objective fact.
      </p>

      <h2>Choose reviewers and material separately</h2>
      <p>
        Reviewer qualifications determine who can answer the criterion. Data sensitivity independently determines what
        each configured audience may receive. Private material belongs with authorized invited reviewers. A RateLoop
        network or hybrid panel receives only public, synthetic, or safely redacted material. Proof of Human can provide
        a provider-scoped uniqueness signal; it does not prove professional expertise, independence, residence, or
        suitability for every task.
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
        Continue with <Link href="/docs/how-it-works">How It Works</Link> for the review and evidence lifecycle or{" "}
        <Link href="/docs/ai">Agents &amp; MCP</Link> for connection and policy-bound integration.
      </p>
    </article>
  );
}

function UseCaseDetail({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div>
      <dt className="font-mono text-xs font-semibold uppercase tracking-wider text-base-content/55">{label}</dt>
      <dd className="mt-1 text-sm leading-6 text-base-content/72">{children}</dd>
    </div>
  );
}
