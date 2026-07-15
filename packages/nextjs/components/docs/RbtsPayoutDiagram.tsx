import { DocsDiagramFrame, MiniPill } from "~~/components/docs/DocsDiagramPrimitives";

const scoreParts = [
  {
    name: "Information score",
    formula: "Q(shadow(reference prediction, own vote), peer vote)",
    accent: "blue" as const,
  },
  {
    name: "Prediction score",
    formula: "Q(own prediction, peer vote)",
    accent: "green" as const,
  },
];

export function RbtsPayoutDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="tokenless-rbts-v1"
      title="Useful signal increases pay; accepted work never goes negative"
      description="The frozen reveal set and post-closure entropy select each report's reference and peer without an operator choosing them."
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {scoreParts.map(part => (
            <section key={part.name} className="rounded-lg border border-base-content/10 bg-base-content/[0.05] p-4">
              <MiniPill accent={part.accent}>{part.name}</MiniPill>
              <p className="mt-3 overflow-x-auto font-mono text-xs leading-6 text-base-content/75">{part.formula}</p>
            </section>
          ))}
        </div>

        <div className="rounded-lg border border-base-content/10 bg-base-content/[0.05] p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-base-content/45">RBTS score</p>
          <p className="mt-2 overflow-x-auto font-mono text-sm font-semibold text-base-content">
            (information score + prediction score) / 2
          </p>
        </div>

        <div className="rounded-lg border border-base-content/10 bg-base-content/[0.07] p-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-base-content/45">Final on-chain payout</p>
          <p className="mt-3 overflow-x-auto font-mono text-sm font-semibold text-base-content sm:text-base">
            fixed base + maximum bonus × score / 10,000
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <MiniPill accent="green">80% fixed base</MiniPill>
            <MiniPill accent="blue">20% maximum RBTS bonus</MiniPill>
            <MiniPill accent="yellow">1%–99% prediction grid</MiniPill>
          </div>
        </div>

        <p className="text-center text-xs leading-5 text-base-content/55">
          If the post-closure entropy is unavailable, the contract uses base-only scoring: every valid revealed report
          keeps its fixed pay.
        </p>
      </div>
    </DocsDiagramFrame>
  );
}
