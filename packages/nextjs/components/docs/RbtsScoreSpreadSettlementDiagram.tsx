import { DocsDiagramFrame, MiniPill } from "~~/components/docs/DocsDiagramPrimitives";

const raters = [
  {
    name: "Alice",
    stake: "10 LREP",
    score: "93.5",
    spread: "+8.25",
    reward: "+1.188",
    final: "11.188",
    accent: "green" as const,
  },
  {
    name: "Bob",
    stake: "5 LREP",
    score: "90.0",
    spread: "+4.75",
    reward: "+0.342",
    final: "5.342",
    accent: "blue" as const,
  },
  {
    name: "Carol",
    stake: "5 LREP",
    score: "64.0",
    spread: "-21.25",
    reward: "-1.59375",
    final: "3.40625",
    accent: "pink" as const,
  },
];

const settlementFacts = [
  ["Stake-weighted mean", "85.25"],
  ["Intensity", "1.5"],
  ["Forfeited pool", "1.59375 LREP"],
  ["Voter share", "1.53 LREP"],
  ["Rebate", "None"],
];

export function RbtsScoreSpreadSettlementDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="RBTS settlement"
      title="Score Spreads Compete Against The Weighted Mean"
      description="RBTS keeps each report's scoreBps, compares every staked report with the stake-weighted mean score, and routes the voter share of forfeited negative spread to positive spread reports."
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_14rem]">
        <div className="overflow-x-auto">
          <table className="min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-base-content/45">
              <tr>
                <th className="px-3 py-2 font-semibold">Rater</th>
                <th className="px-3 py-2 font-semibold">Stake</th>
                <th className="px-3 py-2 font-semibold">Score</th>
                <th className="px-3 py-2 font-semibold">Spread</th>
                <th className="px-3 py-2 font-semibold">Reward / Forfeit</th>
                <th className="px-3 py-2 font-semibold">Final Claim</th>
              </tr>
            </thead>
            <tbody>
              {raters.map(rater => (
                <tr key={rater.name} className="border-t border-base-content/10">
                  <td className="px-3 py-3">
                    <MiniPill accent={rater.accent}>{rater.name}</MiniPill>
                  </td>
                  <td className="px-3 py-3 font-mono text-base-content/70">{rater.stake}</td>
                  <td className="px-3 py-3 font-mono text-base-content/70">{rater.score}</td>
                  <td className="px-3 py-3 font-mono text-base-content/70">{rater.spread}</td>
                  <td className="px-3 py-3 font-mono text-base-content/70">{rater.reward}</td>
                  <td className="px-3 py-3 font-mono font-semibold text-base-content">{rater.final}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid content-start gap-2">
          {settlementFacts.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-base-content/10 bg-base-content/[0.05] px-3 py-2">
              <p className="text-xs font-semibold uppercase text-base-content/45">{label}</p>
              <p className="mt-1 font-mono text-sm font-semibold text-base-content">{value}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-base-content/62">
        Alice and Bob keep their full stake and split the 96% voter share of Carol&apos;s forfeited amount by positive
        spread weight. Carol has a negative spread, so there is no revealed-loser rebate in RBTS score-spread
        settlement.
      </p>
    </DocsDiagramFrame>
  );
}
