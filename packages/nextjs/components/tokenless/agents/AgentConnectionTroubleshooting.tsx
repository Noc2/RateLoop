export function AgentConnectionTroubleshooting() {
  return (
    <details className="group mt-4 border-l border-base-content/20 py-1 pl-4 text-sm open:border-base-content/45">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-2 font-medium [&::-webkit-details-marker]:hidden">
        <span>Authentication finished, but still waiting?</span>
        <span aria-hidden="true" className="text-lg text-base-content/50 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="pb-3 pr-4 leading-6 text-base-content/60">
        “Authentication complete” means Codex finished OAuth, not that RateLoop verified the workspace. Return to the
        same task and use Continue if offered. If the tools are still missing on a later turn and Codex offers no
        action, uninstall both RateLoop plugins—<code>rateloop</code> and <code>rateloop-workspace</code>—then resume
        the same task with the original connection message.
      </p>
    </details>
  );
}
