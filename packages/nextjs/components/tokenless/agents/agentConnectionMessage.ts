export type AgentConnectionMessageInput = {
  connectionUrl: string;
};

/**
 * The only owner-to-agent handoff. The URL is a short-lived activation
 * capability, not an MCP credential; operational credentials are issued to the
 * host through OAuth and never enter the model transcript.
 */
export function buildAgentConnectionMessage({ connectionUrl }: AgentConnectionMessageInput) {
  return `[@RateLoop Workspace](plugin://rateloop-workspace@rateloop) Use $rateloop-workspace-connection to connect this agent to my workspace and finish automatically in this task. Treat this as a new connection if a previous RateLoop workspace was deleted. Preserve this link privately. Only interrupt me for a host-presented install, trust, or OAuth action. Treat the first missing RateLoop workspace-tool check as activation pending and do not ask me to uninstall then, including when this task resumes after host setup. On that first check, do not tell me to start a new task or paste the link. After I complete the action, resume through the host's Continue action when offered, check for RateLoop workspace tools on the next active turn, and continue automatically. Only if the tools are still missing on a later active turn and the host offers no action, tell me once to uninstall all existing RateLoop plugins, preserve this task, and check again after I return; never tell me to reinstall a plugin, repeat that recovery, paste the link, or approve the same action again. Report success only after RateLoop verifies the connection: ${connectionUrl}`;
}
