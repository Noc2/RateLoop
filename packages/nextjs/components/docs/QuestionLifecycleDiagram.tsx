import { type DiagramAccent, DocsDiagramFrame, getDiagramAccentColor } from "~~/components/docs/DocsDiagramPrimitives";

const steps: Array<{
  title: string;
  body: string;
  accent: DiagramAccent;
}> = [
  {
    title: "1. Ask",
    body: "Submit one focused public question, attach evidence, and fund the round bounty.",
    accent: "blue",
  },
  {
    title: "2. Answer",
    body: "Raters answer privately with a thumbs-up/down signal, a crowd forecast, and optional LREP stake.",
    accent: "green",
  },
  {
    title: "3. Settle Rewards",
    body: "After reveal, the round settles on-chain and qualified raters claim from the reward paths they earned.",
    accent: "pink",
  },
];

export function QuestionLifecycleDiagram() {
  return (
    <DocsDiagramFrame title="From Ask to Rewards">
      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map(step => (
          <article key={step.title} className="flex min-h-40 flex-col rounded-lg bg-base-content/[0.07] p-4">
            <div className="flex items-center justify-between gap-2">
              <span
                className="h-2 w-10 rounded-full"
                style={{ backgroundColor: getDiagramAccentColor(step.accent) }}
                aria-hidden="true"
              />
            </div>
            <h4 className="mt-5 text-lg font-semibold leading-snug text-base-content">{step.title}</h4>
            <p className="mt-3 text-sm leading-6 text-base-content/65">{step.body}</p>
          </article>
        ))}
      </div>
    </DocsDiagramFrame>
  );
}
