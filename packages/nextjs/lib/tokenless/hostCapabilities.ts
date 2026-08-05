/**
 * Single source of truth for agent-host compatibility. Message variants, the
 * share-time picker, install affordances, docs pages, and support-tier badges
 * must all render from this registry so capability claims match code by
 * construction.
 *
 * Tier honesty is enforced structurally: a host may carry `supportTier: "release-tested"`
 * only together with `releaseTestedAt` and a `releaseTestEvidence` reference (a green
 * pinned-version smoke run, per the smoke harness's acceptance criteria). Today
 * no host is release-tested. "Verified" is reserved for delivery-control evidence,
 * which no available host supplies. Install affordances exist only where they are factual now;
 * unverified deep links and config snippets are represented by their absence.
 */

export const TOKENLESS_HOST_CATEGORIES = [
  "plugin-host",
  "mcp-ide",
  "mcp-cli",
  "chat-connector",
  "headless-sdk",
] as const;
export type TokenlessHostCategory = (typeof TOKENLESS_HOST_CATEGORIES)[number];

export const TOKENLESS_HOST_SUPPORT_TIERS = ["release-tested", "supported", "experimental", "unsupported"] as const;
export type TokenlessHostSupportTier = (typeof TOKENLESS_HOST_SUPPORT_TIERS)[number];
export const TOKENLESS_HOST_DELIVERY_ENFORCEMENT_TIERS = ["verified", "advisory"] as const;
export type TokenlessHostDeliveryEnforcement = (typeof TOKENLESS_HOST_DELIVERY_ENFORCEMENT_TIERS)[number];

export const TOKENLESS_CONNECTION_LANES = [
  "plugin-with-hooks",
  "mcp-oauth",
  "mcp-config",
  "device-flow",
  "cli",
] as const;
export type TokenlessConnectionLane = (typeof TOKENLESS_CONNECTION_LANES)[number];

export const TOKENLESS_INSTALL_AFFORDANCE_KINDS = [
  "plugin-marketplace",
  "cli-command",
  "config-snippet",
  "deep-link",
  "settings-instructions",
] as const;
export type TokenlessInstallAffordanceKind = (typeof TOKENLESS_INSTALL_AFFORDANCE_KINDS)[number];

export const TOKENLESS_HOST_MESSAGE_VARIANTS = ["plugin", "generic-mcp", "settings-only", "headless"] as const;
export type TokenlessHostMessageVariant = (typeof TOKENLESS_HOST_MESSAGE_VARIANTS)[number];

/**
 * An install affordance renders only with its own freshness evidence: `checkedAt`
 * is the ISO date the affordance was last checked, and `clientVersion` names the
 * exact artifact or client version it was checked against. Until the smoke
 * harness pins named host versions, the bundled plugin affordances record the
 * plugin bundle version that was checked.
 */
export type TokenlessInstallAffordance = {
  kind: TokenlessInstallAffordanceKind;
  label: string;
  value: string;
  checkedAt: string;
  clientVersion: string;
};

/** The one workspace MCP server URL every documented affordance points at. */
const WORKSPACE_MCP_URL = "https://rateloop-tokenless.vercel.app/api/agent/v1/mcp";

/** Native Codex setup for the protected workspace plugin on the isolated tokenless line. */
export const CODEX_WORKSPACE_PLUGIN_MARKETPLACE_COMMAND =
  "codex plugin marketplace add Noc2/RateLoop@tokenless --sparse .agents/plugins --sparse plugins/rateloop --sparse plugins/rateloop-workspace";
export const CODEX_WORKSPACE_PLUGIN_INSTALL_COMMAND = "codex plugin add rateloop-workspace@rateloop";
export const CODEX_WORKSPACE_PLUGIN_SETUP_COMMAND = `${CODEX_WORKSPACE_PLUGIN_MARKETPLACE_COMMAND}\n${CODEX_WORKSPACE_PLUGIN_INSTALL_COMMAND}`;
export const CODEX_WORKSPACE_PLUGIN_VERSION = "rateloop-workspace@0.1.5+codex.20260805000000";

/**
 * Per-host syntax below was checked against the named vendors' documentation on
 * 2026-07-17. That research did not pin client versions, so these affordances
 * carry an explicit provider-docs snapshot label instead of an invented version.
 */
const PROVIDER_DOCS_CHECKED_AT = "2026-07-17";
const PROVIDER_DOCS_SNAPSHOT = "provider-docs-snapshot@2026-07-17";

type TokenlessHostReleaseTest =
  | {
      supportTier: "release-tested";
      /** ISO date of the green pinned-version smoke run that granted the tier. */
      releaseTestedAt: string;
      /** Evidence reference (CI run) for the release test; required with the tier. */
      releaseTestEvidence: string;
    }
  | {
      supportTier: Exclude<TokenlessHostSupportTier, "release-tested">;
      releaseTestedAt?: never;
      releaseTestEvidence?: never;
    };

type TokenlessHostDeliveryControl =
  | {
      deliveryEnforcement: "verified";
      deliveryEnforcementVerifiedAt: string;
      deliveryEnforcementEvidence: string;
    }
  | {
      deliveryEnforcement: "advisory";
      deliveryEnforcementVerifiedAt?: never;
      deliveryEnforcementEvidence?: never;
    };

export type TokenlessHostCapability = {
  /** Kebab-case host identifier used by variants, the picker, and docs routes. */
  id: string;
  displayName: string;
  category: TokenlessHostCategory;
  /** Connection lanes available on this host, best lane first. */
  lanes: readonly [TokenlessConnectionLane, ...TokenlessConnectionLane[]];
  /** Only affordances that are factual today; future ones are absent, never guessed. */
  installAffordances: readonly TokenlessInstallAffordance[];
  /** The ordered host-presented actions the owner should expect, for the picker and docs. */
  humanActions: readonly [string, ...string[]];
  /** Known quirks: schema sanitization, config field shapes, resume semantics. */
  notes?: string;
  /** Which connection-message template this host receives. */
  messageVariant: TokenlessHostMessageVariant;
} & TokenlessHostReleaseTest &
  TokenlessHostDeliveryControl;

export const TOKENLESS_HOST_CAPABILITIES = [
  {
    id: "codex-desktop",
    displayName: "Codex desktop",
    category: "plugin-host",
    supportTier: "supported",
    deliveryEnforcement: "advisory",
    lanes: ["plugin-with-hooks", "mcp-oauth"],
    installAffordances: [
      {
        kind: "plugin-marketplace",
        label: "RateLoop Workspace plugin from the tokenless-pinned Noc2/RateLoop marketplace",
        value: "plugin://rateloop-workspace@rateloop",
        checkedAt: "2026-08-03",
        clientVersion: CODEX_WORKSPACE_PLUGIN_VERSION,
      },
      {
        kind: "cli-command",
        label: "Install the protected workspace plugin from the tokenless-pinned marketplace",
        value: CODEX_WORKSPACE_PLUGIN_SETUP_COMMAND,
        checkedAt: "2026-08-03",
        clientVersion: CODEX_WORKSPACE_PLUGIN_VERSION,
      },
    ],
    humanActions: [
      "Approve the RateLoop Workspace plugin install",
      "Approve the host trust prompt if one appears",
      "Approve the RateLoop OAuth consent screen",
    ],
    notes:
      "Primary path. Marketplace authentication runs during install so a fresh task normally starts with workspace tools available. Existing or revoked installs may still need the host's Continue action.",
    messageVariant: "plugin",
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    category: "plugin-host",
    supportTier: "supported",
    deliveryEnforcement: "advisory",
    lanes: ["plugin-with-hooks", "mcp-oauth", "mcp-config"],
    installAffordances: [
      {
        kind: "plugin-marketplace",
        label: "RateLoop Workspace plugin from the tokenless-pinned Noc2/RateLoop marketplace",
        value: "plugin://rateloop-workspace@rateloop",
        checkedAt: "2026-08-03",
        clientVersion: "rateloop-workspace@0.1.3",
      },
      // The org managed-settings snippet is intentionally absent: no repo doc or
      // hooks contract pins its shape yet, and unverified shapes are never published.
      {
        kind: "cli-command",
        label: "Generic remote-server registration without RateLoop's hooks; authorize from /mcp",
        value: `claude mcp add --scope user --transport http rateloop-workspace ${WORKSPACE_MCP_URL}`,
        checkedAt: PROVIDER_DOCS_CHECKED_AT,
        clientVersion: PROVIDER_DOCS_SNAPSHOT,
      },
    ],
    humanActions: [
      "Approve the RateLoop Workspace plugin install",
      "Approve the RateLoop OAuth authorization in the browser",
    ],
    notes:
      "Direct remote-server registration exists but does not install RateLoop's hooks; the plugin lane is preferred so the host keeps the bundled skill and stop-gate hooks.",
    messageVariant: "plugin",
  },
  {
    id: "claude-desktop",
    displayName: "Claude Desktop",
    category: "chat-connector",
    supportTier: "experimental",
    deliveryEnforcement: "advisory",
    lanes: ["mcp-oauth"],
    installAffordances: [
      {
        kind: "settings-instructions",
        label: "Connector setup in the host's settings",
        value:
          "Add the RateLoop connector in this host's settings and approve the OAuth consent; a pasted message alone cannot install it. Details: /docs/connect",
        checkedAt: PROVIDER_DOCS_CHECKED_AT,
        clientVersion: PROVIDER_DOCS_SNAPSHOT,
      },
    ],
    humanActions: ["Add the RateLoop connector in the host's settings", "Approve the RateLoop OAuth consent screen"],
    notes:
      "Connector setup happens in the host's own settings surface; a pasted message alone cannot install the workspace server.",
    messageVariant: "settings-only",
  },
  {
    id: "vscode-copilot-chat",
    displayName: "Copilot Chat in local VS Code",
    category: "mcp-ide",
    supportTier: "experimental",
    deliveryEnforcement: "advisory",
    lanes: ["mcp-oauth", "mcp-config"],
    installAffordances: [
      {
        kind: "config-snippet",
        label: "Local mcp.json servers entry; leave the optional oauth.clientId unset — none is preregistered",
        value: `{\n  "servers": {\n    "rateloop-workspace": {\n      "type": "http",\n      "url": "${WORKSPACE_MCP_URL}"\n    }\n  }\n}`,
        checkedAt: PROVIDER_DOCS_CHECKED_AT,
        clientVersion: PROVIDER_DOCS_SNAPSHOT,
      },
    ],
    humanActions: [
      "Add the server entry to the local mcp.json and start it",
      "Use the host's Auth action when it appears",
      "Approve the RateLoop OAuth consent screen",
    ],
    notes:
      "Uses a top-level servers object, not mcpServers. No RateLoop OAuth client ID or redirect URI is preregistered or guessed; distinct from GitHub's cloud agent, which lacks remote OAuth MCP.",
    messageVariant: "generic-mcp",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    category: "mcp-ide",
    supportTier: "experimental",
    deliveryEnforcement: "advisory",
    lanes: ["mcp-oauth", "mcp-config"],
    installAffordances: [],
    humanActions: ["Add the server entry to the host's MCP settings", "Approve the RateLoop OAuth consent screen"],
    notes:
      "No install deep link or copied configuration is published until the current deep-link format is verified at a pinned version.",
    messageVariant: "generic-mcp",
  },
  {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    category: "mcp-cli",
    supportTier: "experimental",
    deliveryEnforcement: "advisory",
    lanes: ["mcp-oauth", "mcp-config"],
    installAffordances: [
      {
        kind: "cli-command",
        label: "Register at user scope, then run /mcp auth rateloop-workspace if prompted",
        value: `gemini mcp add --scope user --transport http rateloop-workspace ${WORKSPACE_MCP_URL}`,
        checkedAt: PROVIDER_DOCS_CHECKED_AT,
        clientVersion: PROVIDER_DOCS_SNAPSHOT,
      },
      {
        kind: "config-snippet",
        label: "settings.json entry; the transport field is httpUrl, not url plus type",
        value: `{\n  "mcpServers": {\n    "rateloop-workspace": {\n      "httpUrl": "${WORKSPACE_MCP_URL}"\n    }\n  }\n}`,
        checkedAt: PROVIDER_DOCS_CHECKED_AT,
        clientVersion: PROVIDER_DOCS_SNAPSHOT,
      },
    ],
    humanActions: [
      "Register the server with gemini mcp add",
      "Run /mcp auth rateloop-workspace if authentication is required",
      "Approve the RateLoop OAuth consent screen",
    ],
    notes:
      "JSON configuration uses httpUrl, not url plus type, and the host documents schema sanitization before tools reach the model.",
    messageVariant: "generic-mcp",
  },
  {
    id: "chatgpt-connectors",
    displayName: "ChatGPT connectors",
    category: "chat-connector",
    supportTier: "experimental",
    deliveryEnforcement: "advisory",
    lanes: ["mcp-oauth"],
    installAffordances: [
      {
        kind: "settings-instructions",
        label: "Connector setup in the host's connector settings",
        value:
          "Add the RateLoop connector in this host's connector settings and approve the OAuth consent. Details: /docs/connect",
        checkedAt: PROVIDER_DOCS_CHECKED_AT,
        clientVersion: PROVIDER_DOCS_SNAPSHOT,
      },
    ],
    humanActions: ["Add the RateLoop connector in the host's settings", "Approve the RateLoop OAuth consent screen"],
    notes:
      "Hosted connector surface; authorization capabilities differ from an interactive desktop host and are not the plugin connection flow.",
    messageVariant: "settings-only",
  },
  {
    id: "generic-mcp",
    displayName: "Other MCP client",
    category: "mcp-ide",
    supportTier: "experimental",
    deliveryEnforcement: "advisory",
    lanes: ["mcp-oauth", "mcp-config"],
    installAffordances: [],
    humanActions: [
      "Register the RateLoop workspace MCP server in the client",
      "Approve the RateLoop OAuth consent screen",
    ],
    notes:
      "Universal fallback for any client with Streamable HTTP plus OAuth discovery and dynamic client registration; advisory only, with no host hooks.",
    messageVariant: "generic-mcp",
  },
  {
    id: "headless-sdk",
    displayName: "Headless SDK or CI",
    category: "headless-sdk",
    supportTier: "experimental",
    deliveryEnforcement: "advisory",
    lanes: ["device-flow", "cli"],
    installAffordances: [
      {
        kind: "cli-command",
        label: "RateLoop agents CLI with a workspace API key",
        value:
          "export RATELOOP_API_BASE_URL=https://rateloop-tokenless.vercel.app\nexport RATELOOP_AGENT_API_KEY='rlk_...'\nrateloop-agents quote --file quote.json",
        checkedAt: PROVIDER_DOCS_CHECKED_AT,
        clientVersion: "@rateloop/agents@0.2.0",
      },
    ],
    humanActions: [
      "Open the device authorization link the environment reports",
      "Approve the RateLoop OAuth consent screen",
    ],
    notes:
      "Application-managed: the embedding application or CLI completes the OAuth device authorization flow; no interactive host UI exists.",
    messageVariant: "headless",
  },
] as const satisfies readonly TokenlessHostCapability[];

export type TokenlessHostId = (typeof TOKENLESS_HOST_CAPABILITIES)[number]["id"];

export function tokenlessHostCapability(hostId: string): TokenlessHostCapability | undefined {
  return TOKENLESS_HOST_CAPABILITIES.find(host => host.id === hostId);
}

export function tokenlessHostMessageVariant(hostId: string): TokenlessHostMessageVariant | undefined {
  return tokenlessHostCapability(hostId)?.messageVariant;
}
