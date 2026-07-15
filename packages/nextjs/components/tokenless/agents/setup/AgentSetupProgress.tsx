import type { AgentSetupScreenStep } from "~~/lib/tokenless/agentSetupNavigation";

const LABELS: Record<AgentSetupScreenStep, string> = {
  workspace: "Workspace",
  connect: "Connect",
  agent: "Agent",
  reviews: "Reviews",
  people: "People",
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
  return (
    <nav aria-label="Workspace setup progress">
      <p className="text-sm font-medium text-base-content/70">Step {currentIndex + 1} of 5</p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-5">
        {stages.map((stage, index) => {
          const statusLabel =
            stage.key === currentStep ? "Current" : stage.status === "complete" ? "Complete" : "Not started";
          const content = (
            <>
              <span className="block text-xs uppercase tracking-[0.14em] text-base-content/50">{index + 1}</span>
              <span className="mt-1 block font-medium">{LABELS[stage.key]}</span>
              <span className="mt-1 block text-xs text-base-content/55">{statusLabel}</span>
            </>
          );
          const className = `rounded-xl border px-3 py-3 text-left ${
            stage.key === currentStep
              ? "border-primary/60 bg-primary/10"
              : stage.status === "complete"
                ? "border-white/15 bg-white/[0.03]"
                : "border-white/8 bg-transparent text-base-content/60"
          }`;
          return (
            <li key={stage.key}>
              {allowNavigation && stage.status === "complete" && stage.key !== currentStep ? (
                <button className={`${className} w-full`} type="button" onClick={() => onNavigate(stage.key)}>
                  {content}
                </button>
              ) : (
                <div className={className} aria-current={stage.key === currentStep ? "step" : undefined}>
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
