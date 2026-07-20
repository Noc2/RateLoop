import type { ReactNode, Ref } from "react";

export function SetupStageHeader({
  description,
  headingRef,
  title,
}: {
  description?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  title: string;
}) {
  return (
    <header>
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="font-display text-3xl font-semibold tracking-tight outline-none sm:text-4xl"
      >
        {title}
      </h1>
      {description ? <p className="mt-3 text-base leading-7 text-base-content/65">{description}</p> : null}
    </header>
  );
}
