import { DocsDiagramFrame, MiniPill } from "~~/components/docs/DocsDiagramPrimitives";

const rows = [
  {
    subject: "Question, context, bounty",
    commit: "Public immediately",
    reveal: "Still public",
    settle: "Still public",
    payout: "Still public",
    tone: "green" as const,
  },
  {
    subject: "Commit metadata",
    commit: "Commitment, frontend, and optional stake are public",
    reveal: "Used to match the reveal",
    settle: "Feeds settlement accounting",
    payout: "Referenced by claim paths",
    tone: "blue" as const,
  },
  {
    subject: "RBTS report contents",
    commit: "Hidden from other raters",
    reveal: "Up/down and predicted up % become public",
    settle: "Scores the revealed report",
    payout: "Payout weight can be capped",
    tone: "pink" as const,
  },
  {
    subject: "Public rating result",
    commit: "Not settled yet",
    reveal: "Waiting for reveal conditions",
    settle: "Public result is readable",
    payout: "Payout root cannot rewrite it",
    tone: "green" as const,
  },
  {
    subject: "USDC / launch LREP claims",
    commit: "Not claimable",
    reveal: "Not claimable",
    settle: "Settled round is required first",
    payout: "Claimable after finalized payout snapshot",
    tone: "yellow" as const,
  },
];

const columns = ["Blind commit", "Reveal", "Settle result", "Finalize payout snapshot"] as const;

export function RoundVisibilityTimelineDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="Round visibility"
      title="What Is Public vs Hidden During a Round"
      description="The ask is public from the start. The hidden part is the RBTS report contents until reveal."
    >
      <div className="overflow-x-auto">
        <div className="grid min-w-[860px] grid-cols-[10rem_repeat(4,minmax(0,1fr))] gap-2">
          <div />
          {columns.map(column => (
            <div key={column} className="rounded-lg bg-base-content/[0.07] px-3 py-2 text-sm font-semibold">
              {column}
            </div>
          ))}
          {rows.map(row => (
            <div key={row.subject} className="contents">
              <div className="flex items-center rounded-lg bg-base-content/[0.045] px-3 py-3 text-sm font-semibold text-base-content/75">
                {row.subject}
              </div>
              <div className="rounded-lg border border-base-content/10 bg-base-content/[0.04] px-3 py-3 text-sm leading-5 text-base-content/62">
                <MiniPill accent={row.tone}>{row.commit}</MiniPill>
              </div>
              <div className="rounded-lg border border-base-content/10 bg-base-content/[0.04] px-3 py-3 text-sm leading-5 text-base-content/62">
                {row.reveal}
              </div>
              <div className="rounded-lg border border-base-content/10 bg-base-content/[0.04] px-3 py-3 text-sm leading-5 text-base-content/62">
                {row.settle}
              </div>
              <div className="rounded-lg border border-base-content/10 bg-base-content/[0.04] px-3 py-3 text-sm leading-5 text-base-content/62">
                {row.payout}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DocsDiagramFrame>
  );
}
