import Link from "next/link";
import { AgentRunFlowDiagram } from "~~/components/docs/AgentRunFlowDiagram";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { ReviewerFlowDiagram } from "~~/components/docs/ReviewerFlowDiagram";
import { SettlementPathsDiagram } from "~~/components/docs/SettlementPathsDiagram";

export default function HowTokenlessWorksPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Works">How It</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        An agent asks one focused question. A blinded human panel reports independently. RateLoop returns a verdict,
        reasons, disagreement, and payment evidence for the next decision.
      </p>

      <AgentRunFlowDiagram />

      <h2 id="agent-flow">1. The agent flow</h2>
      <p>
        An integration requests a quote, creates an idempotent ask, funds it from a prepaid balance or signed USDC
        authorization, waits on the operation, and reads the result. The same{" "}
        <Link href="/docs/sdk">quote → ask → payment → wait → result</Link> contract works through the SDK and private
        workspace integrations. Public MCP handoffs add a browser approval step before submission.
      </p>

      <h2 id="reviewer-flow">2. The reviewer flow</h2>
      <p>
        Before paid work is offered, each reviewer passes the frozen eligibility policy. RateLoop then assigns a blinded
        case. The reviewer chooses an answer, predicts the panel&apos;s answer share, and submits a sealed commit before
        anyone can see the crowd. After reveal, every accepted valid report can be claimed at the reviewer-selected
        payout address.
      </p>
      <p>
        A network panel uses <Link href="/docs/tech-stack#proof-of-human">Proof of Human</Link> for provider-scoped
        uniqueness. Invited and hybrid panels use their own explicit{" "}
        <Link href="/docs/tech-stack#audience-policies">audience policies</Link>.
      </p>
      <ReviewerFlowDiagram />

      <h2 id="settlement-paths">3. Every funded round terminates</h2>
      <p>
        Normal rounds reveal and settle with fixed pay plus a bounded{" "}
        <Link href="/docs/tech-stack#robust-bayesian-truth-serum">RBTS bonus</Link>. A zero-commit round refunds the
        customer. If quorum or the reveal beacon fails after reviewers have submitted valid work, the customer receives
        the remaining bounty and fee while accepted work is compensated from the reserved amount. A paid round cannot be
        cancelled after its first accepted commit.
      </p>
      <SettlementPathsDiagram />

      <h2 id="decision-evidence">4. Evidence, not an automatic decision</h2>
      <p>
        The result separates the panel verdict from the material needed to interpret it: reviewer source, individual
        reports, reasons, disagreement, scoring version, compensation, and settlement references. The customer decides
        whether to approve, revise, retest, escalate, or stop.
      </p>

      <h2 id="adaptive-review">5. Review can follow the evidence</h2>
      <p>
        A workflow can stop when its declared evidence bar is met or open another review when disagreement, coverage, or
        a material change calls for more judgment. Correlation analytics may affect publication and future assignment,
        but never reduce pay for accepted work.
      </p>

      <p>
        Continue with <Link href="/docs/tech-stack">Tech Stack</Link> for the mechanisms behind the flow,{" "}
        <Link href="/docs/ai">Agents &amp; MCP</Link> for integration lanes, or{" "}
        <Link href="/docs/smart-contracts">Smart Contracts</Link> for fund custody and settlement.
      </p>
    </article>
  );
}
