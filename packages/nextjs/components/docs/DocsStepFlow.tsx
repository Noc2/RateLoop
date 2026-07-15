import type { DiagramAccent } from "~~/components/docs/DocsDiagramPrimitives";
import { getDiagramAccentColor } from "~~/components/docs/DocsDiagramPrimitives";

export type DocsFlowStep = {
  title: string;
  detail: string;
  accent: DiagramAccent;
  code?: string;
};

export function DocsStepFlow({ steps, label }: { steps: readonly DocsFlowStep[]; label: string }) {
  return (
    <ol aria-label={label} className="grid gap-3 md:grid-flow-col md:auto-cols-fr">
      {steps.map((step, index) => (
        <li key={step.title} className="relative flex min-w-0 md:items-stretch">
          <article className="flex w-full flex-col rounded-lg border border-base-content/10 bg-base-content/[0.06] p-4">
            <div className="flex items-center justify-between gap-3">
              <span
                className="h-1.5 w-9 rounded-full"
                style={{ backgroundColor: getDiagramAccentColor(step.accent) }}
                aria-hidden="true"
              />
              <span className="font-mono text-[0.68rem] font-semibold text-base-content/35">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <h4 className="mt-4 text-base font-semibold leading-snug text-base-content">{step.title}</h4>
            {step.code ? (
              <code className="mt-2 w-fit rounded bg-base-content/[0.08] px-2 py-1 text-[0.68rem] text-base-content/65">
                {step.code}
              </code>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-base-content/62">{step.detail}</p>
          </article>
          {index < steps.length - 1 ? (
            <span className="mx-1 hidden self-center font-mono text-base-content/25 md:block" aria-hidden="true">
              →
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
