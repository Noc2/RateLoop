/**
 * Single source of truth for agent-host compatibility (Phase 0 of
 * docs/tokenless-agent-install-plan-2026-07.md). Message variants, the share-time
 * picker, install affordances, docs pages, and support-tier badges must all render
 * from this registry so capability claims match code by construction.
 *
 * Tier honesty is enforced structurally: a host may carry `supportTier: "verified"`
 * only together with `verifiedAt` and a `verificationEvidence` reference (a green
 * pinned-version smoke run, per the compatibility review's acceptance criteria).
 * Today no host is verified. Install affordances exist only where they are factual
 * now; unverified deep links and config snippets are represented by their absence,
 * per docs/tokenless-mcp-cross-client-compatibility-review-2026-07.md.
 */

export const TOKENLESS_HOST_CATEGORIES = [
  "plugin-host",
  "mcp-ide",
  "mcp-cli",
  "chat-connector",
  "headless-sdk",
] as const;
export type TokenlessHostCategory = (typeof TOKENLESS_HOST_CATEGORIES)[number];

export const TOKENLESS_HOST_SUPPORT_TIERS = ["verified", "supported", "experimental", "unsupported"] as const;
export type TokenlessHostSupportTier = (typeof TOKENLESS_HOST_SUPPORT_TIERS)[number];

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
 * exact artifact or client version it was checked against. Until the Phase 5
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

/**
 * Per-host syntax below was checked against the named vendors' documentation on
 * 2026-07-17 by the compatibility review; the review pins no client versions,
 * so these affordances carry the review reference instead of an invented one.
 */
const COMPAT_REVIEW_CHECKED_AT = "2026-07-17";
const COMPAT_REVIEW_REFERENCE = "docs/tokenless-mcp-cross-client-compatibility-review-2026-07.md";

type TokenlessHostVerification =
  | {
      supportTier: "verified";
      /** ISO date of the green pinned-version smoke run that granted the tier. */
      verifiedAt: string;
      /** Evidence reference (CI run) for the verification; required with the tier. */
      verificationEvidence: string;
    }
  | {
      supportTier: Exclude<TokenlessHostSupportTier, "verified">;
      verifiedAt?: never;
      verificationEvidence?: never;
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
} & TokenlessHostVerification;

export const TOKENLESS_HOST_CAPABILITIES = [
  {
    id: "codex-desktop",
    displayName: "Codex desktop",
    category: "plugin-host",
    supportTier: "supported",
    lanes: ["plugin-with-hooks", "mcp-oauth"],
    installAffordances: [
      {
        kind: "plugin-marketplace",
        label: "RateLoop Workspace plugin from the tokenless-pinned Noc2/RateLoop marketplace",
        value: "plugin://rateloop-workspace@rateloop",
        checkedAt: "2026-07-20",
        clientVersion: "rateloop-workspace@0.1.1+codex.20260720140232",
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
    lanes: ["plugin-with-hooks", "mcp-oauth", "mcp-config"],
    installAffordances: [
      {
        kind: "plugin-marketplace",
        label: "RateLoop Workspace plugin from the tokenless-pinned Noc2/RateLoop marketplace",
        value: "plugin://rateloop-workspace@rateloop",
        checkedAt: "2026-07-17",
        clientVersion: "rateloop-workspace@0.1.1",
      },
      // The org managed-settings snippet is intentionally absent: no repo doc or
      // hooks contract pins its shape yet, and unverified shapes are never published.
      {
        kind: "cli-command",
        label: "Generic remote-server registration without RateLoop's hooks; authorize from /mcp",
        value: `claude mcp add --scope user --transport http rateloop-workspace ${WORKSPACE_MCP_URL}`,
        checkedAt: COMPAT_REVIEW_CHECKED_AT,
        clientVersion: COMPAT_REVIEW_REFERENCE,
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
    lanes: ["mcp-oauth"],
    installAffordances: [
      {
        kind: "settings-instructions",
        label: "Connector setup in the host's settings",
        value:
          "Add the RateLoop connector in this host's settings and approve the OAuth consent; a pasted message alone cannot install it. Details: /docs/connect",
        checkedAt: COMPAT_REVIEW_CHECKED_AT,
        clientVersion: COMPAT_REVIEW_REFERENCE,
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
    lanes: ["mcp-oauth", "mcp-config"],
    installAffordances: [
      {
        kind: "config-snippet",
        label: "Local mcp.json servers entry; leave the optional oauth.clientId unset — none is preregistered",
        value: `{\n  "servers": {\n    "rateloop-workspace": {\n      "type": "http",\n      "url": "${WORKSPACE_MCP_URL}"\n    }\n  }\n}`,
        checkedAt: COMPAT_REVIEW_CHECKED_AT,
        clientVersion: COMPAT_REVIEW_REFERENCE,
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
    lanes: ["mcp-oauth", "mcp-config"],
    installAffordances: [
      {
        kind: "cli-command",
        label: "Register at user scope, then run /mcp auth rateloop-workspace if prompted",
        value: `gemini mcp add --scope user --transport http rateloop-workspace ${WORKSPACE_MCP_URL}`,
        checkedAt: COMPAT_REVIEW_CHECKED_AT,
        clientVersion: COMPAT_REVIEW_REFERENCE,
      },
      {
        kind: "config-snippet",
        label: "settings.json entry; the transport field is httpUrl, not url plus type",
        value: `{\n  "mcpServers": {\n    "rateloop-workspace": {\n      "httpUrl": "${WORKSPACE_MCP_URL}"\n    }\n  }\n}`,
        checkedAt: COMPAT_REVIEW_CHECKED_AT,
        clientVersion: COMPAT_REVIEW_REFERENCE,
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
    lanes: ["mcp-oauth"],
    installAffordances: [
      {
        kind: "settings-instructions",
        label: "Connector setup in the host's connector settings",
        value:
          "Add the RateLoop connector in this host's connector settings and approve the OAuth consent. Details: /docs/connect",
        checkedAt: COMPAT_REVIEW_CHECKED_AT,
        clientVersion: COMPAT_REVIEW_REFERENCE,
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
    lanes: ["device-flow", "cli"],
    installAffordances: [
      {
        kind: "cli-command",
        label: "RateLoop agents CLI with a workspace API key",
        value:
          "export RATELOOP_API_BASE_URL=https://rateloop-tokenless.vercel.app\nexport RATELOOP_AGENT_API_KEY='rlk_...'\nrateloop-agents quote --file quote.json",
        checkedAt: COMPAT_REVIEW_CHECKED_AT,
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
