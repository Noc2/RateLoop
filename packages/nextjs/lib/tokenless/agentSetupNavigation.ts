export const AGENT_SETUP_SCREEN_STEPS = ["workspace", "connect", "agent", "reviews", "people"] as const;
export type AgentSetupScreenStep = (typeof AGENT_SETUP_SCREEN_STEPS)[number];

export function agentSetupUrl(workspaceId: string, step: AgentSetupScreenStep) {
  return `/agents?workspace=${encodeURIComponent(workspaceId)}&step=${encodeURIComponent(step)}`;
}
