export type AgentConnectionMessageInput = {
  expiresAt: string | null;
  mcpUrl: string;
  secret: string;
};

/**
 * Builds the one message a workspace owner can hand to an agent. The message is
 * intentionally operational: a capable host should configure MCP and register
 * immediately instead of asking the owner what the endpoint is for.
 */
export function buildAgentConnectionMessage(input: AgentConnectionMessageInput) {
  return `Connect yourself to this RateLoop workspace now. Do not ask me what I want you to do with this endpoint.

This message contains a sensitive pairing credential intended only for the agent chat and host I chose. It must be claimed within 10 minutes and becomes the approved connection credential if the workspace owner accepts the registration. Never repeat the credential in your response, logs, repository, or normal tool arguments.

Configure this MCP server in your host's secure MCP connection settings:

Name: rateloop
Transport: Streamable HTTP
URL: ${input.mcpUrl}
Authorization header: Bearer ${input.secret}${
    input.expiresAt
      ? `
Claim deadline: ${input.expiresAt}`
      : ""
  }

Then complete these steps without waiting for another instruction:

1. Connect to the MCP server, initialize it, and list its tools.
2. Immediately call rateloop_register_agent exactly once. Infer an honest stable externalId, displayName, provider, model, optional model version/deployment, environment, and requestedWorkflowKeys from your current runtime and work. Use "unknown" when the host withholds a required provider or model value; never invent capabilities. Use "general-assistance" only when there is no more specific workflow.
3. Call rateloop_get_registration_status and tell me only that registration was submitted and is waiting for owner approval. Do not print the credential.
4. Continue checking registration status. After approval, refresh the MCP tools and call rateloop_get_agent_context.
5. From then on, follow the returned workspace, workflow, publishing, and human-review policy. Before eligible outputs, call rateloop_evaluate_review_requirement and complete the RateLoop review flow whenever it returns required.

If your host does not allow you to add MCP connections yourself, do not stop at asking what I want to configure. Give me the single exact host-specific settings action needed to add the server above, then continue automatically as soon as it is available. Do not repeat the bearer credential if your host can reference the value already present in this message.`;
}
