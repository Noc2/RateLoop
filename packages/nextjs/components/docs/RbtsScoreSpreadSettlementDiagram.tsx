import { DocsDiagramFrame, MiniPill } from "~~/components/docs/DocsDiagramPrimitives";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";

const raters = [
  {
    name: "Alice",
    stake: "10 LREP",
    score: "93.5",
    benchmark: "77.00",
    spread: "+16.50",
    reward: "+1.693923",
    final: "11.693923",
    accent: "green" as const,
  },
  {
    name: "Bob",
    stake: "5 LREP",
    score: "90.0",
    benchmark: "83.66",
    spread: "+6.34",
    reward: "+0.325438",
    final: "5.325438",
    accent: "blue" as const,
  },
  {
    name: "Carol",
    stake: "5 LREP",
    score: "64.0",
    benchmark: "92.33",
    spread: "-28.33",
    reward: "-2.12475",
    final: "2.87525",
    accent: "pink" as const,
  },
];

const settlementFacts = [
  ["Benchmark", "Leave-one-out"],
  ["Economic threshold", `${protocolDocFacts.scoreSpreadForfeitMinRevealsLabel} revealed`],
  ["Intensity", "1.5"],
  ["Max forfeit", protocolDocFacts.maxScoreSpreadForfeitPercentLabel],
  ["Forfeited pool", "2.12475 LREP"],
  ["Voter share", "2.019362 LREP"],
  ["Rebate", "None"],
];

export function RbtsScoreSpreadSettlementDiagram() {
  return (
    <DocsDiagramFrame title="LREP Example">
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {settlementFacts.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-base-content/10 bg-base-content/[0.05] px-3 py-2">
              <p className="text-xs font-semibold uppercase text-base-content/45">{label}</p>
              <p className="mt-1 font-mono text-sm font-semibold text-base-content">{value}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[780px] text-left text-sm">
            <thead className="text-xs uppercase text-base-content/45">
              <tr>
                <th className="px-3 py-2 font-semibold">Rater</th>
                <th className="px-3 py-2 font-semibold">Stake</th>
                <th className="px-3 py-2 font-semibold">Score</th>
                <th className="px-3 py-2 font-semibold">LOO Benchmark</th>
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
                  <td className="px-3 py-3 font-mono text-base-content/70">{rater.benchmark}</td>
                  <td className="px-3 py-3 font-mono text-base-content/70">{rater.spread}</td>
                  <td className="px-3 py-3 font-mono text-base-content/70">{rater.reward}</td>
                  <td className="px-3 py-3 font-mono font-semibold text-base-content">{rater.final}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DocsDiagramFrame>
  );
}
