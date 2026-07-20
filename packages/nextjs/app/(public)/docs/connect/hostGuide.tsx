import type { TokenlessHostCategory, TokenlessHostSupportTier } from "~~/lib/tokenless/hostCapabilities";

/**
 * Presentation-only projection helpers for the generated per-host connection
 * guides (Phase 4 of docs/tokenless-agent-install-plan-2026-07.md). Facts come
 * from lib/tokenless/hostCapabilities; everything here is template prose.
 */

/**
 * Real connection messages end with a single-use link minted per intent by the
 * workspace Agents tab. Docs never fabricate a live link; this elided shape is
 * the same placeholder treatment public/docs/agent-connection.md uses.
 */
export const CONNECTION_MESSAGE_URL_PLACEHOLDER = "/connect/aci_...#...";

export const HOST_CATEGORY_LABELS: Record<TokenlessHostCategory, string> = {
  "plugin-host": "Bundled plugin hosts",
  "mcp-ide": "MCP IDEs and desktop clients",
  "mcp-cli": "MCP command-line clients",
  "chat-connector": "Chat connectors",
  "headless-sdk": "Headless and CI",
};

export const HOST_TIER_BADGES: Record<TokenlessHostSupportTier, { label: string; meaning: string }> = {
  verified: {
    label: "Verified",
    meaning: "A release-gated install, authorization, lifecycle, and tool smoke test passed at a named client version.",
  },
  supported: {
    label: "Supported",
    meaning:
      "The bundled integration path is tested against RateLoop's own contracts; the pinned-client release smoke test is still outstanding.",
  },
  experimental: {
    label: "Experimental",
    meaning:
      "The host documents the required transport and OAuth capabilities, but RateLoop has not exercised this host in a release smoke test.",
  },
  unsupported: {
    label: "Unsupported",
    meaning: "The host lacks a capability the protected workspace connection requires.",
  },
};

const TIER_BADGE_CLASSES: Record<TokenlessHostSupportTier, string> = {
  verified: "bg-emerald-300/10 text-emerald-100",
  supported: "bg-white/[0.08] text-base-content/80",
  experimental: "bg-white/[0.04] text-base-content/60",
  unsupported: "bg-white/[0.04] text-base-content/45",
};

export function HostTierBadge({ tier }: { tier: TokenlessHostSupportTier }) {
  return (
    <span data-tier={tier} className={`badge border-0 text-xs ${TIER_BADGE_CLASSES[tier]}`}>
      {HOST_TIER_BADGES[tier].label}
    </span>
  );
}

export function HostGuideCodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-base-content/10 bg-base-300/50 p-4 text-xs leading-6">
      <code>{children}</code>
    </pre>
  );
}
