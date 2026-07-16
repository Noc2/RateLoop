export type AgentConnectionMessageInput = {
  connectionUrl: string;
};

/**
 * The only owner-to-agent handoff. The URL is a short-lived activation
 * capability, not an MCP credential; operational credentials are issued to the
 * host through OAuth and never enter the model transcript.
 */
export function buildAgentConnectionMessage({ connectionUrl }: AgentConnectionMessageInput) {
  return `[@RateLoop Workspace](plugin://rateloop-workspace@rateloop) Use $rateloop-workspace-connection to connect this agent to my workspace and finish automatically in this task. Treat this as a new connection if a previous RateLoop workspace was deleted. Preserve this link privately. Only interrupt me when the host actually presents an install, trust, or OAuth action. After I approve it, resume through the host's Continue action when offered, check for RateLoop workspace tools on the next active turn, and continue automatically; never ask me to paste the link or approve the same action again. Report success only after RateLoop verifies the connection: ${connectionUrl}`;
}
