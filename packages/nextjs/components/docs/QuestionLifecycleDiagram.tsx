import {
  type DiagramAccent,
  DocsDiagramFrame,
  StepNumber,
  getDiagramAccentColor,
} from "~~/components/docs/DocsDiagramPrimitives";
import { protocolDocFacts } from "~~/lib/docs/protocolFacts";

const steps: Array<{
  number: string;
  title: string;
  body: string;
  detail: string;
  accent: DiagramAccent;
}> = [
  {
    number: "01",
    title: "Ask and fund",
    body: "Submit one public question with context and fund a non-refundable bounty into protocol escrow.",
    detail: "Everyone can answer; bounty eligibility only affects claims.",
    accent: "blue",
  },
  {
    number: "02",
    title: "Commit hidden report",
    body: "Raters commit an RBTS report: up/down signal, predicted up %, and optional LREP stake.",
    detail: "Report contents stay hidden during the blind phase.",
    accent: "green",
  },
  {
    number: "03",
    title: "Reveal",
    body: "After the selected blind phase, the keeper normally reveals eligible reports.",
    detail: `Default blind phase: ${protocolDocFacts.blindPhaseDurationLabel}.`,
    accent: "pink",
  },
  {
    number: "04",
    title: "Settle public result",
    body: "The round settles on-chain once reveal conditions and the rater threshold are met.",
    detail: "The public rating is readable here.",
    accent: "blue",
  },
  {
    number: "05",
    title: "Finalize payout snapshot",
    body: "USDC bounty and launch LREP claim weights wait for a challengeable correlation payout root.",
    detail: "This does not rewrite the public rating.",
    accent: "yellow",
  },
  {
    number: "06",
    title: "Claim or read",
    body: "Eligible raters claim rewards and agents read the final public result package.",
    detail: "Claims use finalized payout weights where required.",
    accent: "green",
  },
];

export function QuestionLifecycleDiagram() {
  return (
    <DocsDiagramFrame
      eyebrow="Question lifecycle"
      title="From Ask to Claim"
      description="Public settlement happens before correlation-gated USDC and launch LREP payout weights finalize."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {steps.map(step => (
          <article key={step.number} className="flex min-h-64 flex-col rounded-lg bg-base-content/[0.07] p-3">
            <div className="flex items-center justify-between gap-2">
              <StepNumber>{step.number}</StepNumber>
              <span
                className="h-2 w-10 rounded-full"
                style={{ backgroundColor: getDiagramAccentColor(step.accent) }}
                aria-hidden="true"
              />
            </div>
            <h4 className="mt-4 text-base font-semibold leading-snug text-base-content">{step.title}</h4>
            <p className="mt-3 text-sm leading-6 text-base-content/65">{step.body}</p>
            <p className="mt-auto pt-4 font-mono text-xs leading-5 text-base-content/48">{step.detail}</p>
          </article>
        ))}
      </div>
    </DocsDiagramFrame>
  );
}
