import type { ReactNode, Ref } from "react";
import { AGENT_SETUP_STAGE_LABELS, AGENT_SETUP_STAGE_VISUALS } from "./AgentSetupProgress";
import type { AgentSetupScreenStep } from "~~/lib/tokenless/agentSetupNavigation";

export function SetupStageHeader({
  description,
  headingRef,
  step,
  title,
}: {
  description?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  step: AgentSetupScreenStep;
  title: string;
}) {
  const visual = AGENT_SETUP_STAGE_VISUALS[step];

  return (
    <header>
      <p className="font-mono text-xs uppercase tracking-[0.22em]" style={{ color: visual.color }}>
        {visual.number} / 05 · {AGENT_SETUP_STAGE_LABELS[step]}
      </p>
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="font-display mt-3 text-3xl font-semibold tracking-tight outline-none sm:text-4xl"
      >
        {title}
      </h1>
      {description ? <p className="mt-3 text-base leading-7 text-base-content/65">{description}</p> : null}
    </header>
  );
}
