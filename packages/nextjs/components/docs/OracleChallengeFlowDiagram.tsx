import { DiagramNode, DocsDiagramFrame, MiniPill } from "~~/components/docs/DocsDiagramPrimitives";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";

const flowSteps = [
  {
    title: "Bonded frontend operator",
    body: `${protocolDocFacts.frontendOperatorStakeLabel} registered frontend bond backs proposal accountability.`,
    accent: "blue" as const,
  },
  {
    title: "Deterministic payout artifact",
    body: "Operator publishes artifact URI plus correlation epoch and round Merkle roots.",
    accent: "green" as const,
  },
  {
    title: "Challenge window",
    body: "Auditors recompute the artifact and can challenge a bad root with the anti-spam bond.",
    accent: "yellow" as const,
  },
  {
    title: "Finalize payout weights",
    body: "Unchallenged roots become usable by USDC bounty and launch LREP claim paths.",
    accent: "pink" as const,
  },
];

export function OracleChallengeFlowDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="Optimistic payout-root oracle"
      title="ClusterPayoutOracle Challenge Flow"
      description="Public rating settlement happens first; this flow only finalizes payout weights for claim paths."
    >
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          {flowSteps.map(step => (
            <DiagramNode key={step.title} accent={step.accent} title={step.title} className="min-h-36">
              {step.body}
            </DiagramNode>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-base-content/[0.045] p-3">
            <MiniPill accent="yellow">5 USDC default</MiniPill>
            <p className="mt-2 text-sm leading-6 text-base-content/65">
              The challenge bond is an anti-spam bond, not payout-value coverage.
            </p>
          </div>
          <div className="rounded-lg bg-base-content/[0.045] p-3">
            <MiniPill accent="green">Good root</MiniPill>
            <p className="mt-2 text-sm leading-6 text-base-content/65">
              Claim paths use the finalized correlation payout weights.
            </p>
          </div>
          <div className="rounded-lg bg-base-content/[0.045] p-3">
            <MiniPill accent="pink">Challenged root</MiniPill>
            <p className="mt-2 text-sm leading-6 text-base-content/65">
              Governance arbitrates with a reason hash and can slash the proposing frontend.
            </p>
          </div>
        </div>
      </div>
    </DocsDiagramFrame>
  );
}
