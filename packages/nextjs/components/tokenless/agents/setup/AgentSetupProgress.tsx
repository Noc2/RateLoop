import type { AgentSetupScreenStep } from "~~/lib/tokenless/agentSetupNavigation";

export const AGENT_SETUP_STAGE_LABELS: Record<AgentSetupScreenStep, string> = {
  workspace: "Workspace",
  connect: "Connect",
  agent: "Agent",
  reviews: "Reviews",
  people: "People",
};

export const AGENT_SETUP_STAGE_VISUALS: Record<
  AgentSetupScreenStep,
  { number: string; color: string; nextColor: string }
> = {
  workspace: {
    number: "01",
    color: "var(--rateloop-blue)",
    nextColor: "var(--rateloop-green)",
  },
  connect: {
    number: "02",
    color: "var(--rateloop-green)",
    nextColor: "var(--rateloop-yellow)",
  },
  agent: {
    number: "03",
    color: "var(--rateloop-yellow)",
    nextColor: "var(--rateloop-pink)",
  },
  reviews: {
    number: "04",
    color: "var(--rateloop-pink)",
    nextColor: "var(--rateloop-shell-border-strong)",
  },
  people: {
    number: "05",
    color: "var(--rateloop-warm-white)",
    nextColor: "var(--rateloop-shell-border-strong)",
  },
};

type ProgressStage = {
  key: AgentSetupScreenStep;
  status: "complete" | "current" | "not_started";
};

export function AgentSetupProgress({
  currentStep,
  stages,
  onNavigate,
  allowNavigation = true,
}: {
  currentStep: AgentSetupScreenStep;
  stages: ProgressStage[];
  onNavigate: (step: AgentSetupScreenStep) => void;
  allowNavigation?: boolean;
}) {
  const currentIndex = stages.findIndex(stage => stage.key === currentStep);
  const currentVisual = AGENT_SETUP_STAGE_VISUALS[currentStep];
  return (
    <nav aria-label="Workspace setup progress">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-base-content/55">
          Step {currentIndex + 1} of {stages.length}
        </p>
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="h-2 w-2 rounded-full" style={{ background: currentVisual.color }} aria-hidden="true" />
          {AGENT_SETUP_STAGE_LABELS[currentStep]}
        </p>
      </div>
      <ol className="mt-4 grid grid-cols-5" aria-label={`Step ${currentIndex + 1} of ${stages.length}`}>
        {stages.map((stage, index) => {
          const visual = AGENT_SETUP_STAGE_VISUALS[stage.key];
          const statusLabel =
            stage.key === currentStep ? "Current" : stage.status === "complete" ? "Complete" : "Not started";
          const completedConnector = index < currentIndex;
          const markerStyle =
            stage.key === "people" && stage.key === currentStep
              ? {
                  borderColor: "transparent",
                  background:
                    "linear-gradient(var(--rateloop-surface-elevated), var(--rateloop-surface-elevated)) padding-box, var(--rateloop-spectrum-gradient) border-box",
                }
              : { borderColor: stage.status === "not_started" ? undefined : visual.color };
          const content = (
            <>
              <span
                className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-[var(--rateloop-surface-elevated)] ${
                  stage.key === currentStep
                    ? "shadow-[0_0_0_4px_rgb(245_245_245/0.08)]"
                    : stage.status === "not_started"
                      ? "border-[color:var(--rateloop-shell-border-strong)]"
                      : ""
                }`}
                style={markerStyle}
                aria-hidden="true"
              >
                {stage.status === "complete" ? (
                  <span className="h-2 w-2 rounded-full" style={{ background: visual.color }} />
                ) : null}
              </span>
              <span
                className={`mt-3 hidden font-mono text-xs sm:block ${
                  stage.status === "not_started" ? "text-base-content/45" : "text-base-content"
                }`}
              >
                <span style={stage.status === "not_started" ? undefined : { color: visual.color }}>
                  {visual.number}
                </span>{" "}
                {AGENT_SETUP_STAGE_LABELS[stage.key]}
              </span>
              <span className="sr-only">{statusLabel}</span>
            </>
          );
          return (
            <li key={stage.key} className="relative min-w-0">
              {index < stages.length - 1 ? (
                <span
                  className="absolute left-3 right-[-0.75rem] top-[0.6875rem] h-px"
                  style={{
                    background: completedConnector
                      ? `linear-gradient(90deg, ${visual.color}, ${visual.nextColor})`
                      : "var(--rateloop-shell-border-strong)",
                  }}
                  aria-hidden="true"
                />
              ) : null}
              {allowNavigation && stage.status === "complete" && stage.key !== currentStep ? (
                <button
                  className="relative min-h-11 w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--rateloop-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--rateloop-surface-elevated)]"
                  type="button"
                  onClick={() => onNavigate(stage.key)}
                >
                  {content}
                </button>
              ) : (
                <div className="relative min-h-11" aria-current={stage.key === currentStep ? "step" : undefined}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
