import React, { type ReactNode } from "react";

export type UseCaseIconKind = "reply" | "research" | "experience";

const ICON_PATHS: Record<UseCaseIconKind, ReactNode> = {
  reply: (
    <>
      <path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.2 3.4a.5.5 0 0 1-.8-.4v-3h-.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
      <path d="M8.5 10h7" />
      <path d="M8.5 13h4.5" />
    </>
  ),
  research: (
    <>
      <path d="M6 3.5h8.5L18 7v13.5a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5v-16a.5.5 0 0 1 .5-.5Z" />
      <path d="M14.5 3.5V7H18" />
      <circle cx="11" cy="13" r="2.6" />
      <path d="m13 15 2.4 2.4" />
    </>
  ),
  experience: (
    <>
      <rect x="3.5" y="4.5" width="17" height="13" rx="1.2" />
      <path d="M3.5 8h17" />
      <path d="m12.5 11 5.8 2.2-2.5 1 1.7 2.9-1.5.9-1.7-3-1.8 2Z" />
    </>
  ),
};

export function UseCaseIcon({ kind, color }: { kind: UseCaseIconKind; color: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6 shrink-0"
    >
      {ICON_PATHS[kind]}
    </svg>
  );
}

export type UseCaseExample = {
  color: string;
  artifactLabel: string;
  artifact: string;
  question: string;
  verdict: string;
  reasons: readonly string[];
  outcome: string;
};

export function UseCaseExampleCard({ example }: { example: UseCaseExample }) {
  return (
    <section className="surface-card-nested rounded-xl p-4 text-left">
      <p className="font-mono text-xs uppercase tracking-widest" style={{ color: example.color }}>
        Illustrative example
      </p>
      <dl className="mt-3 grid gap-3">
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-base-content/55">{example.artifactLabel}</dt>
          <dd className="mt-1 rounded-lg border border-white/10 px-3 py-2 text-sm italic leading-6 text-base-content/80">
            {example.artifact}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-base-content/55">Human check</dt>
          <dd className="mt-1 text-sm font-semibold leading-6 text-base-content">{example.question}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-base-content/55">Panel result</dt>
          <dd className="mt-1 text-sm leading-6">
            <span className="font-semibold text-base-content">{example.verdict}</span>
            <span className="mt-2 flex flex-wrap gap-2">
              {example.reasons.map(reason => (
                <span key={reason} className="rounded-md bg-white/[0.06] px-2 py-1 text-xs text-base-content/70">
                  {reason}
                </span>
              ))}
            </span>
          </dd>
        </div>
      </dl>
      <p className="mt-3 border-t border-white/10 pt-3 text-sm text-base-content/70">{example.outcome}</p>
    </section>
  );
}
