export type AgentConnectionMessageInput = {
  connectionUrl: string;
};

/**
 * The only owner-to-agent handoff. The URL is a short-lived activation
 * capability, not an MCP credential; operational credentials are issued to the
 * host through OAuth and never enter the model transcript.
 */
export function buildAgentConnectionMessage({ connectionUrl }: AgentConnectionMessageInput) {
  return `Use RateLoop to connect yourself to my workspace and finish automatically. Open and preserve this connection link through any installation or authorization; do not ask me to paste it again. Only interrupt me for a host-native install, trust, or authorization prompt: ${connectionUrl}`;
}
