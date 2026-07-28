import type { ReactNode } from "react";
import { classNames } from "~~/components/tokenless/ui/classNames";

type PageHeadingBaseProps = {
  accent?: "blue" | "error" | "green" | "pink";
  className?: string;
  heading: ReactNode;
  headingId?: string;
};

export type PageHeadingProps = PageHeadingBaseProps &
  (
    | { eyebrow: ReactNode; subtitle?: never }
    | { eyebrow?: never; subtitle: ReactNode }
    | { eyebrow?: never; subtitle?: never }
  );

const ACCENT_CLASS = {
  blue: "border-[var(--rateloop-blue)]",
  error: "border-error",
  green: "border-[var(--rateloop-green)]",
  pink: "border-[var(--rateloop-pink)]",
} as const;

export function PageHeading({ accent = "green", className, eyebrow, heading, headingId, subtitle }: PageHeadingProps) {
  return (
    <header className={classNames("border-l-2 pl-6", ACCENT_CLASS[accent], className)}>
      {eyebrow ? <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">{eyebrow}</p> : null}
      <h1 id={headingId} className={classNames("text-3xl font-semibold sm:text-4xl", Boolean(eyebrow) && "mt-3")}>
        {heading}
      </h1>
      {subtitle ? <p className="mt-3 text-base text-base-content/60">{subtitle}</p> : null}
    </header>
  );
}
