export type AgentConnectionMessageInput = {
  connectionUrl: string;
};

/**
 * The only owner-to-agent handoff. The URL is a short-lived activation
 * capability, not an MCP credential; operational credentials are issued to the
 * host through OAuth and never enter the model transcript.
 */
export function buildAgentConnectionMessage({ connectionUrl }: AgentConnectionMessageInput) {
  return `Use RateLoop to connect this agent to my workspace and finish automatically in this task. Preserve this link privately. Only interrupt me when the host actually presents an install, trust, or OAuth action. After I approve it, refresh RateLoop once and continue; never ask me to paste the link or approve the same action again: ${connectionUrl}`;
}
