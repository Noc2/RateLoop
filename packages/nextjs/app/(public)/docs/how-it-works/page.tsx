import Link from "next/link";
import { HumanAssuranceLoop } from "~~/components/assurance/HumanAssuranceLoop";
import { AgentRunFlowDiagram } from "~~/components/docs/AgentRunFlowDiagram";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { ReviewerFlowDiagram } from "~~/components/docs/ReviewerFlowDiagram";
import { SettlementPathsDiagram } from "~~/components/docs/SettlementPathsDiagram";

export default function HowTokenlessWorksPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Works">How It</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        RateLoop begins by checking an agent frequently. Independent human agreement can earn lower baseline review for
        the same evidence scope, while safety rules and weaker evidence keep humans involved.
      </p>

      <div className="not-prose my-8">
        <HumanAssuranceLoop />
      </div>

      <h2 id="adaptive-review">1. Evidence sets review coverage</h2>
      <p>
        RateLoop keeps assurance separate by agent version, review-policy version, workflow, risk tier, and reviewer
        audience. A new scope starts in calibration at 100% review; evidence from another model version or workflow
        cannot silently lower it.
      </p>
      <p>
        Under the default adaptive policy, two independent 15-case windows must each contain at least 14 comparable
        agent-human agreements before coverage can move to 50%. Another 50 stable cases can move it to 25%, and 100 more
        can move it to the 10% monitoring floor. A complete evidence window below the agreement threshold restores 100%
        calibration. Critical risk, missing required context, and the maximum unreviewed gap can force a check at any
        stage.
      </p>

      <h2 id="agent-flow">2. One human-review cycle</h2>
      <AgentRunFlowDiagram />
      <p>
        An integration requests a quote, creates an idempotent ask, funds it from a prepaid balance or signed USDC
        authorization, waits on the operation, and reads the result. The same{" "}
        <Link href="/docs/sdk">quote → ask → payment → wait → result</Link> contract works through the SDK and private
        workspace integrations. Public MCP handoffs add a browser approval step before submission.
      </p>

      <h2 id="reviewer-flow">3. The reviewer flow</h2>
      <p>
        Before paid work is offered, each reviewer passes the frozen eligibility policy. RateLoop then assigns a blinded
        case. The reviewer chooses an answer, predicts the panel&apos;s answer share, and submits a sealed commit before
        anyone can see the crowd. That paid commit publishes timelock ciphertext containing the vote, prediction,
        response hash, payout address, and salt. It irrevocably schedules those details to become publicly decryptable
        at the configured drand beacon after the commit deadline, whether or not the reviewer or keeper submits a reveal
        or claim; there is no post-commit abort. After reveal, every accepted valid report can be claimed at the
        reviewer-selected payout address.
      </p>
      <p>
        A network panel uses <Link href="/docs/tech-stack#proof-of-human">Proof of Human</Link> for provider-scoped
        uniqueness. Invited and hybrid panels use their own explicit{" "}
        <Link href="/docs/tech-stack#audience-policies">audience policies</Link>.
      </p>
      <ReviewerFlowDiagram />

      <h2 id="settlement-paths">4. Every funded round terminates</h2>
      <p>
        Normal rounds reveal and settle with fixed pay plus a bounded{" "}
        <Link href="/docs/tech-stack#robust-bayesian-truth-serum">RBTS bonus</Link>. A zero-commit round refunds the
        customer. If quorum or the reveal beacon fails after reviewers have submitted valid work, the customer receives
        the remaining bounty and fee while accepted work is compensated from the reserved amount. A paid round cannot be
        cancelled after its first accepted commit.
      </p>
      <SettlementPathsDiagram />

      <h2 id="decision-evidence">5. Evidence, not an automatic decision</h2>
      <p>
        The result separates the panel verdict from the material needed to interpret it: reviewer source, individual
        reports, reasons, disagreement, scoring version, compensation, and settlement references. The customer decides
        whether to approve, revise, retest, escalate, or stop.
      </p>
      <p>
        See <Link href="/docs/evidence">Evidence &amp; Compliance Mapping</Link> for the packet fields, local checks,
        framework cross-references, and limits on what those records establish.
      </p>

      <p>Correlation analytics may affect publication and future assignment, but never reduce pay for accepted work.</p>

      <p>
        Continue with <Link href="/docs/tech-stack">Tech Stack</Link> for the mechanisms behind the flow,{" "}
        <Link href="/docs/ai">Agents &amp; MCP</Link> for integration lanes, or{" "}
        <Link href="/docs/smart-contracts">Smart Contracts</Link> for fund custody and settlement.
      </p>
    </article>
  );
}
