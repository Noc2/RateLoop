import { type TokenlessHostMessageVariant, tokenlessHostMessageVariant } from "~~/lib/tokenless/hostCapabilities";

export type AgentConnectionMessageInput = {
  connectionUrl: string;
};

export type AgentConnectionMessageForHostInput = {
  connectionUrl: string;
  hostId: string;
};

/**
 * `universal` is the default when no host is chosen and is the compatibility
 * floor: composing it must reproduce the pre-variant message byte-for-byte.
 */
export type AgentConnectionMessageVariant = TokenlessHostMessageVariant | "universal";

/**
 * Core block shared verbatim by every variant: the skill invocation, deletion
 * semantics, the privacy line, and the interruption rule. The security-relevant
 * sentences stay byte-identical across variants so one test can pin them.
 */
export const AGENT_CONNECTION_MESSAGE_CORE_BLOCK =
  "Use $rateloop-workspace-connection to connect this agent to my workspace and finish automatically in this task. Treat this as a new connection if a previous RateLoop workspace was deleted. Preserve this link privately. Only interrupt me for a host-presented install, trust, or OAuth action.";

/** Plugin block: the structured plugin mention plugin hosts resolve on paste. */
export const AGENT_CONNECTION_MESSAGE_PLUGIN_REFERENCE_BLOCK =
  "[@RateLoop Workspace](plugin://rateloop-workspace@rateloop)";

/** Ongoing review instructions shared by every connection path. */
export const AGENT_CONNECTION_MESSAGE_REVIEW_LOOP_BLOCK =
  "After RateLoop verifies the connection, use $rateloop-human-review-loop before releasing every eligible output. Connection alone does not submit or hold an output; if review is required, request it and wait for a terminal result.";

/** Full install/resume/uninstall choreography for plugin hosts and the universal floor. */
const PLUGIN_RECOVERY_BLOCK =
  "Treat the first missing RateLoop workspace-tool check as activation pending and do not ask me to uninstall then, including when this task resumes after host setup. On that first check, do not tell me to start a new task or paste the link. After I complete the action, resume through the host's Continue action when offered, check for RateLoop workspace tools on the next active turn, and continue automatically. Only if the tools are still missing on a later active turn and the host offers no action, tell me once to uninstall all existing RateLoop plugins, preserve this task, and check again after I return; never tell me to reinstall a plugin, repeat that recovery, paste the link, or approve the same action again.";

/** Shorter OAuth-retry recovery for hosts without plugin install choreography. */
const GENERIC_MCP_RECOVERY_BLOCK =
  "Treat the first missing RateLoop workspace-tool check as activation pending, including when this task resumes after the host's OAuth approval. On that first check, do not tell me to start a new task or paste the link. After I complete the action, check for RateLoop workspace tools on the next active turn and continue automatically. Only if the tools are still missing on a later active turn, tell me once to re-run the host's own OAuth authorization for the rateloop-workspace server and check again after I return; never tell me to paste the link again or approve the same action again.";

/** Chat-connector hosts install RateLoop in their settings surface, not from a pasted message. */
const SETTINGS_ONLY_BLOCK =
  "This host adds RateLoop through its own settings, not through a pasted install step. If the RateLoop workspace tools are unavailable, tell me once to add and authorize the RateLoop connector in this host's settings, then continue after I return.";

/** Headless environments authorize through the OAuth device flow instead of a host UI. */
const HEADLESS_BLOCK =
  "This environment is headless: connect through the RateLoop agents CLI or SDK using the OAuth device authorization flow, and surface the device verification link and user code to me once so I can approve them in a browser.";

/** Core closing shared verbatim by every variant; the URL always ends the message. */
export function agentConnectionMessageCoreClosing({ connectionUrl }: AgentConnectionMessageInput) {
  return `Report success only after RateLoop verifies the connection: ${connectionUrl}`;
}

export function buildAgentConnectionMessageVariant(
  variant: AgentConnectionMessageVariant,
  { connectionUrl }: AgentConnectionMessageInput,
) {
  const closing = agentConnectionMessageCoreClosing({ connectionUrl });
  switch (variant) {
    case "universal":
    case "plugin":
      return [
        AGENT_CONNECTION_MESSAGE_PLUGIN_REFERENCE_BLOCK,
        AGENT_CONNECTION_MESSAGE_CORE_BLOCK,
        PLUGIN_RECOVERY_BLOCK,
        AGENT_CONNECTION_MESSAGE_REVIEW_LOOP_BLOCK,
        closing,
      ].join(" ");
    case "generic-mcp":
      return [
        AGENT_CONNECTION_MESSAGE_CORE_BLOCK,
        GENERIC_MCP_RECOVERY_BLOCK,
        AGENT_CONNECTION_MESSAGE_REVIEW_LOOP_BLOCK,
        closing,
      ].join(" ");
    case "settings-only":
      return [
        SETTINGS_ONLY_BLOCK,
        AGENT_CONNECTION_MESSAGE_CORE_BLOCK,
        AGENT_CONNECTION_MESSAGE_REVIEW_LOOP_BLOCK,
        closing,
      ].join(" ");
    case "headless":
      return [
        HEADLESS_BLOCK,
        AGENT_CONNECTION_MESSAGE_CORE_BLOCK,
        AGENT_CONNECTION_MESSAGE_REVIEW_LOOP_BLOCK,
        closing,
      ].join(" ");
  }
}

/**
 * The only owner-to-agent handoff. The URL is a short-lived activation
 * capability, not an MCP credential; operational credentials are issued to the
 * host through OAuth and never enter the model transcript.
 */
export function buildAgentConnectionMessage({ connectionUrl }: AgentConnectionMessageInput) {
  return buildAgentConnectionMessageVariant("universal", { connectionUrl });
}

/**
 * Host-tuned message selected from the capability registry. An unknown host id
 * falls back to the universal variant, which works on every host.
 */
export function buildAgentConnectionMessageForHost({ connectionUrl, hostId }: AgentConnectionMessageForHostInput) {
  return buildAgentConnectionMessageVariant(tokenlessHostMessageVariant(hostId) ?? "universal", { connectionUrl });
}
