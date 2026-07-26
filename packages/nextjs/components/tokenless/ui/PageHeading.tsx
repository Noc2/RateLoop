import type { ReactNode } from "react";
import { classNames } from "~~/components/tokenless/ui/classNames";

type PageHeadingBaseProps = {
  className?: string;
  heading: ReactNode;
};

export type PageHeadingProps = PageHeadingBaseProps &
  (
    | { eyebrow: ReactNode; subtitle?: never }
    | { eyebrow?: never; subtitle: ReactNode }
    | { eyebrow?: never; subtitle?: never }
  );

export function PageHeading({ className, eyebrow, heading, subtitle }: PageHeadingProps) {
  return (
    <header className={classNames("border-l-2 border-[var(--rateloop-green)] pl-6", className)}>
      {eyebrow ? <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">{eyebrow}</p> : null}
      <h1 className={classNames("text-3xl font-semibold sm:text-4xl", Boolean(eyebrow) && "mt-3")}>{heading}</h1>
      {subtitle ? <p className="mt-3 text-base text-base-content/60">{subtitle}</p> : null}
    </header>
  );
}
