import Link from "next/link";
import type { Metadata } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";
import { RbtsPayoutDiagram } from "~~/components/docs/RbtsPayoutDiagram";
import { SurprisinglyPopularBonusChart } from "~~/components/docs/SurprisinglyPopularBonusChart";
import { TokenlessArchitectureDiagram } from "~~/components/docs/TokenlessArchitectureDiagram";

export const metadata = {
  title: "Tech Stack",
  description:
    "MCP, x402 USDC funding, Proof of Human, sealed review, RBTS incentives, and immutable Base settlement in RateLoop.",
} satisfies Metadata;

export default function TokenlessTechStackPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Stack">Tech</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        The landing page names the mechanisms behind RateLoop. Here is what each one does and where it fits in the
        production human-assurance loop.
      </p>

      <TokenlessArchitectureDiagram />

      <h2 id="mcp-adapter">MCP Adapter</h2>
      <p>
        The Model Context Protocol adapter exposes RateLoop over Streamable HTTP. A public integration can draft an
        approval-bound browser handoff; a private workspace integration can quote and publish inside a scoped owner
        policy. Both routes return the same versioned operation and result shapes.
      </p>

      <h2 id="x402-usdc">x402 + USDC</h2>
      <p>
        The agent-funded lane uses an x402-style payment authorization: the agent wallet signs short-lived EIP-3009 USDC
        terms, then <code>X402PanelSubmitter</code> consumes that authorization and funds the selected panel on Base.
        The private key stays with the agent. If the nonce is already used, RateLoop accepts only an exact matching
        round receipt; otherwise the payment is marked possibly paid and no replacement authorization is retried. A
        prepaid workspace balance provides the wallet-free lane.
      </p>

      <h2 id="proof-of-human">Proof of Human</h2>
      <p>
        RateLoop-network reviewers enroll with World ID 4. The server maps a successful proof to the narrow{" "}
        <code>unique_human</code> capability used for network admission, giving the assignment system a provider-scoped
        uniqueness signal before paid work is issued.
      </p>

      <h2 id="audience-policies">Audience Policies</h2>
      <p>
        Every ask freezes one content-hashed audience policy: customer-invited reviewers, the RateLoop network, or
        separate hybrid subpanels. The policy binds reviewer source, eligibility, panel size, economics, and publication
        rules so the audience cannot change midway through a round.
      </p>

      <h2 id="correlation-diversified-assignment">Correlation-Diversified Assignment</h2>
      <p>
        Signed correlation epochs help avoid repeatedly assigning closely connected reviewers to the same panel. Private
        linkage features stay encrypted; result evidence carries only the frozen epoch reference and aggregate coverage.
        Post-round analytics can shape publication and future eligibility while accepted work keeps its promised pay.
      </p>

      <h2 id="commit-reveal">Commit-Reveal</h2>
      <p>
        A report contains a binary answer, a prediction of the panel&apos;s answer share, and an optional reason. During
        the blind phase the reviewer submits a commitment to the sealed report. Reveal verifies that the opened report
        matches the accepted commitment, so early reviewers cannot copy visible momentum.
      </p>

      <h2 id="drand-tlock">drand/tlock</h2>
      <p>
        Reports are sealed to a future drand beacon round with timelock encryption. When that public randomness arrives,
        the keeper can open reports without holding a universal decryption key; reviewers retain a self-reveal path. The
        round then uses only valid opened reports for settlement.
      </p>

      <h2 id="robust-bayesian-truth-serum">Robust Bayesian Truth Serum</h2>
      <p>
        RBTS pays for useful peer prediction in one blind binary round. Each reviewer reports an answer and forecasts
        the share of reviewers who will answer up. A canonical peer supplies the comparison answer and another supplies
        the reference prediction. The scoring version is fixed in the round evidence and uses integer basis-point
        arithmetic.
      </p>

      <div className="not-prose my-6 grid gap-4 lg:grid-cols-2">
        <FormulaPanel
          label="Shadow prediction"
          formula="shadowᵢ = reference ± min(reference, 1 − reference)"
          description="Move the reference forecast toward the reviewer's own answer, then clamp it to the 0–100% range."
        />
        <FormulaPanel
          label="Quadratic accuracy"
          formula="q(p, up) = 2p − p²; q(p, down) = 1 − p²"
          description="Score both the shadow forecast and the reviewer's own forecast against the canonical peer."
        />
        <FormulaPanel
          label="RBTS score"
          formula="scoreᵢ = ½ × [q(shadowᵢ, peer) + q(predictionᵢ, peer)]"
          description="Average information and prediction accuracy into a score from 0 to 10,000 basis points."
        />
        <FormulaPanel
          label="Contract payout"
          formula="payᵢ = fixedBasePay + maximumBonus × scoreᵢ / 10,000"
          description="Accepted valid work keeps fixed pay; its bounded variable bonus follows the published score."
        />
      </div>
      <RbtsPayoutDiagram />

      <h2 id="surprisingly-popular">Surprisingly Popular</h2>
      <p>
        After a panel of at least ten reports closes, RateLoop compares each answer side&apos;s leave-one-out actual
        share with its leave-one-out predicted share. An answer is surprisingly popular when that margin reaches 500
        basis points. The reward score rises with the margin and saturates at 2,500 basis points.
      </p>
      <FormulaPanel
        label="Platform-funded top-up"
        formula="topUpᵢ = 12.5% × guaranteedBase × min(1, surpriseMarginᵢ / 25%)"
        description="Only reports on the round's surprisingly popular side qualify; the top-up is separate from the panel verdict and contract payout."
      />
      <SurprisinglyPopularBonusChart />

      <h2 id="base-usdc">Base + USDC</h2>
      <p>
        Base provides inexpensive EVM settlement while USDC keeps quotes, reserves, compensation, and claims in one
        familiar unit. Commitments and economic terms are public; question text and private artifacts stay in the
        application layer.
      </p>

      <h2 id="immutable-fund-core">Immutable Fund Core</h2>
      <p>
        <Link href="/docs/smart-contracts#tokenless-panel">TokenlessPanel</Link> is the only fund-holding core. It
        accepts a completely specified round and enforces fixed pay, bounded bonus, attempt compensation, refunds, and
        claims without an operator path to customer funds. Admission signer rotation lives in a separate, fundless
        credential contract.
      </p>

      <h2 id="decision-packets">Decision Packets</h2>
      <p>
        The application joins the public settlement record with customer-scoped context: reports, reasons, disagreement,
        reviewer source, scoring inputs, payment state, and evidence hashes. Agents receive a structured result; humans
        get the same evidence in a readable decision view.
      </p>

      <p>
        See <Link href="/docs/how-it-works">How It Works</Link> for the end-to-end journey,{" "}
        <Link href="/docs/ai">Agents &amp; MCP</Link> for the integration surface, or{" "}
        <Link href="/docs/smart-contracts">Smart Contracts</Link> for the on-chain roles.
      </p>
    </article>
  );
}

function FormulaPanel({ label, formula, description }: { label: string; formula: string; description: string }) {
  return (
    <section className="rateloop-surface-card rounded-2xl p-5 sm:p-6">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rateloop-blue)]">{label}</p>
      <p className="mt-3 overflow-x-auto font-mono text-sm font-semibold leading-7 text-base-content sm:text-base">
        {formula}
      </p>
      <p className="mt-3 text-sm leading-6 text-base-content/60">{description}</p>
    </section>
  );
}
