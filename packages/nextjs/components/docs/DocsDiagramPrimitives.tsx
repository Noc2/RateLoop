import type { CSSProperties, ReactNode } from "react";

export type DiagramAccent = "blue" | "green" | "yellow" | "pink" | "neutral";

const accentColors: Record<DiagramAccent, string> = {
  blue: "var(--rateloop-blue)",
  green: "var(--rateloop-green)",
  yellow: "var(--rateloop-yellow)",
  pink: "var(--rateloop-pink)",
  neutral: "rgb(245 245 245 / 0.58)",
};

export function getDiagramAccentColor(accent: DiagramAccent) {
  return accentColors[accent];
}

export function DocsDiagramFrame({
  eyebrow,
  title,
  description,
  children,
  className = "",
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={`not-prose my-6 rounded-lg bg-base-200 p-4 text-base-content ${className}`.trim()}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-base-content/45">{eyebrow}</p>
          ) : null}
          <h3 className={`${eyebrow ? "mt-1 " : ""}text-xl font-semibold leading-tight text-base-content`}>{title}</h3>
        </div>
        {description ? (
          <figcaption className="max-w-xl text-sm leading-6 text-base-content/62 sm:text-right">
            {description}
          </figcaption>
        ) : null}
      </div>
      <div className="rounded-lg bg-base-100 p-3 sm:p-4">{children}</div>
    </figure>
  );
}

export function DiagramNode({
  accent = "neutral",
  title,
  children,
  className = "",
}: {
  accent?: DiagramAccent;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const style = { "--diagram-accent": getDiagramAccentColor(accent) } as CSSProperties;

  return (
    <div
      className={`rounded-lg border border-base-content/10 bg-base-content/[0.07] p-3 text-left shadow-none ${className}`.trim()}
      style={style}
    >
      <div className="border-l-[3px] border-[var(--diagram-accent)] pl-3">
        <p className="text-sm font-semibold leading-snug text-base-content">{title}</p>
        <div className="mt-2 text-xs leading-5 text-base-content/62">{children}</div>
      </div>
    </div>
  );
}

export function StepNumber({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-base-content/[0.08] font-mono text-xs font-bold text-base-content/75">
      {children}
    </span>
  );
}

export function MiniPill({ children, accent = "neutral" }: { children: ReactNode; accent?: DiagramAccent }) {
  const style = { "--diagram-accent": getDiagramAccentColor(accent) } as CSSProperties;

  return (
    <span
      className="inline-flex rounded-full bg-base-content/[0.07] px-2 py-1 text-[0.72rem] font-semibold leading-none text-base-content/65"
      style={style}
    >
      <span className="mr-1.5 h-1.5 w-1.5 self-center rounded-full bg-[var(--diagram-accent)]" aria-hidden="true" />
      {children}
    </span>
  );
}
