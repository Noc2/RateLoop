import { DocsDiagramFrame, MiniPill } from "~~/components/docs/DocsDiagramPrimitives";

const lanes = [
  {
    label: "Settled-round LREP rewards",
    accent: "blue" as const,
    steps: [
      "Hidden report is revealed",
      "Round settles and RBTS score is computed",
      "High-scoring staked reports can claim stake return plus LREP rewards",
      "Low-scoring or unrevealed reports lose some or all reward eligibility",
    ],
  },
  {
    label: "USDC bounty / launch LREP",
    accent: "green" as const,
    steps: [
      "Public result must settle first",
      "Frontend proposes deterministic correlation payout artifact",
      "Challengeable payout root finalizes",
      "Eligible raters claim with finalized payout weight",
    ],
  },
  {
    label: "Feedback bonus awards",
    accent: "pink" as const,
    steps: [
      "Useful hidden feedback is referenced by hash",
      "Feedback can be awarded after settlement or terminal state",
      "Award transaction pays the revealed rater directly",
      "Eligible frontend operator share is reserved; expired remainder goes to treasury",
    ],
  },
];

export function RewardPayoutPathsDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="Reward paths"
      title="Settlement Rewards vs Snapshot-Gated Payouts"
      description="The public rating result settles first. USDC bounty and launch LREP claims can wait for payout weights."
    >
      <div className="overflow-x-auto">
        <div className="grid min-w-[900px] gap-3">
          {lanes.map(lane => (
            <div key={lane.label} className="grid grid-cols-[13rem_repeat(4,minmax(0,1fr))] gap-2">
              <div className="flex items-center rounded-lg bg-base-content/[0.07] p-3">
                <MiniPill accent={lane.accent}>{lane.label}</MiniPill>
              </div>
              {lane.steps.map((step, index) => (
                <div
                  key={step}
                  className={`rounded-lg border border-base-content/10 px-3 py-3 text-sm leading-5 ${
                    index === 2 || index === 3
                      ? "bg-base-content/[0.07] text-base-content/75"
                      : "bg-base-content/[0.04] text-base-content/62"
                  }`}
                >
                  {step}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </DocsDiagramFrame>
  );
}
