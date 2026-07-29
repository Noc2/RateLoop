import Link from "next/link";
import type { Metadata } from "next";
import { HumanAssuranceLoop } from "~~/components/assurance/HumanAssuranceLoop";
import { DocsTitle } from "~~/components/docs/DocsTitle";

export const metadata: Metadata = { title: "How RateLoop works" };

export default function HowTokenlessWorksPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Agent Outputs">Review</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        The hosted service connects an agent to invited workspace reviewers. Reviews are private and unpaid; the final
        decision stays with your team.
      </p>

      <div className="not-prose my-8 rounded-xl border border-[var(--rateloop-blue)]/25 bg-[var(--rateloop-blue)]/5 p-5">
        <h2 className="text-lg font-semibold text-base-content">At a glance</h2>
        <p className="mt-2 text-sm leading-6 text-base-content/70">
          Connect the agent, set its review policy, request a check, collect independent answers, and inspect the
          result.
        </p>
      </div>

      <div className="not-prose my-8">
        <HumanAssuranceLoop />
      </div>

      <h2 id="adaptive-review">1. Scope the review policy</h2>
      <p>
        RateLoop keeps review evidence separate by agent version, policy version, workflow, risk tier, and reviewer
        audience. A new or changed scope begins with frequent review. Stable agreement can lower baseline coverage,
        while critical risk, missing context, a long unreviewed gap, or weaker agreement can require another check.
      </p>
      <p>
        The workspace owner controls the question, response window, reviewer audience, and data boundary in{" "}
        <Link href="/agents/review-setup">Reviews</Link>. Evidence from a different scope cannot silently lower review
        coverage.
      </p>

      <h2 id="agent-flow">2. The agent requests a review</h2>
      <p>
        After connection, the agent reads its owner-approved context and evaluates each eligible output. If review is
        required, it requests one review and waits for the same operation instead of creating a duplicate. Generic MCP
        integrations are advisory; only a verified host integration that controls delivery can prove the output stayed
        blocked while it waited.
      </p>
      <p>
        See <Link href="/docs/ai">Agents &amp; MCP</Link> for the connection and tool sequence.
      </p>

      <h2 id="reviewer-flow">3. Invited reviewers answer independently</h2>
      <p>
        RateLoop offers the case only to reviewers invited to the workspace. An assigned reviewer sees the material
        needed for that case, selects an answer, and can add a reason before the deadline. Reviewers do not see other
        responses while answering.
      </p>
      <p>
        Submit only material you are authorized to share. Minimize or redact personal, confidential, and regulated data
        because assigned reviewers and authorized RateLoop workloads may read it to provide the service.
      </p>

      <h2 id="decision-evidence">4. RateLoop returns a result and evidence</h2>
      <p>
        The result keeps the review question, policy scope, verdict, reasons, agreement or disagreement, and available
        evidence together. Workspace members can inspect completed work in Results and supporting records in Evidence.
      </p>
      <p>
        The evidence records what the review process observed. It does not prove that the source material was correct,
        that every agent output was intercepted, or that a later customer decision was compliant.
      </p>

      <h2 id="owner-decision">5. Your team decides what happens next</h2>
      <p>
        The accountable owner decides whether to approve, revise, retest, escalate, or stop. RateLoop supplies human
        review evidence; it does not issue an automatic production, safety, legal, medical, or compliance approval.
      </p>
      <p>
        Continue with the <Link href="/docs/evidence">Evidence reference</Link> for record boundaries or{" "}
        <Link href="/docs/use-cases">Use Cases</Link> for example review questions.
      </p>
    </article>
  );
}
