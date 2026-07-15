import { DiagramNode, DocsDiagramFrame, MiniPill } from "~~/components/docs/DocsDiagramPrimitives";

const paths = [
  {
    condition: "Enough reveals",
    title: "Normal settlement",
    body: "Freeze the reveal set, derive the scoring seed, compute RBTS payouts, and open the claim window.",
    result: "Base + scored bonus",
    accent: "green" as const,
  },
  {
    condition: "No commits",
    title: "Zero-commit refund",
    body: "No paid work was accepted, so bounty, fee, and attempt reserve return to the funder.",
    result: "Full funder credit",
    accent: "blue" as const,
  },
  {
    condition: "Some reveals, below quorum",
    title: "Under-quorum compensation",
    body: "Each revealed report can claim the fixed base; every unused amount returns to the funder.",
    result: "Fixed base per reveal",
    accent: "yellow" as const,
  },
  {
    condition: "No reveals by fallback deadline",
    title: "Beacon-failure compensation path",
    body: "The core closes deterministically. With no revealed report to compensate, all unused funding returns to the funder.",
    result: "Beacon-failure terminal",
    accent: "pink" as const,
  },
];

export function SettlementPathsDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="Fund core"
      title="Every round has a deterministic terminal path"
      description="Cancellation is available only while the round is empty. The first accepted paid commit permanently closes that exit."
    >
      <div className="mb-4 flex flex-col items-center gap-2 text-center">
        <DiagramNode accent="neutral" title="Funded round" className="w-full max-w-sm">
          The round terms fix deadlines, quorum, seat count, USDC budget, and the admission-policy hash.
        </DiagramNode>
        <span className="font-mono text-base-content/25" aria-hidden="true">
          ↓
        </span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Round settlement outcomes">
        {paths.map(path => (
          <li key={path.title} className="rounded-lg border border-base-content/10 bg-base-content/[0.05] p-4">
            <MiniPill accent={path.accent}>{path.condition}</MiniPill>
            <h4 className="mt-3 text-base font-semibold text-base-content">{path.title}</h4>
            <p className="mt-2 text-xs leading-5 text-base-content/62">{path.body}</p>
            <p className="mt-3 font-mono text-[0.68rem] font-semibold uppercase tracking-wide text-base-content/45">
              {path.result}
            </p>
          </li>
        ))}
      </ul>
    </DocsDiagramFrame>
  );
}
