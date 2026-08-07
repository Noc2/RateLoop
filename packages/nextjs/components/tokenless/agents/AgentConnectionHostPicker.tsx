"use client";

import { useEffect, useState } from "react";
import { useAgentLocale, useAgentTranslations } from "./AgentsLocaleProvider";
import { Badge, type BadgeVariant } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import {
  TOKENLESS_HOST_CAPABILITIES,
  type TokenlessHostCapability,
  type TokenlessHostId,
  type TokenlessHostSupportTier,
  type TokenlessInstallAffordance,
  tokenlessHostCapability,
} from "~~/lib/tokenless/hostCapabilities";
import { localizeTokenlessHostCapabilityCopy } from "~~/lib/tokenless/hostCapabilityLocalization";

const HOST_CHOICE_KEY_PREFIX = "rateloop:agent-host-choice:v1:";

function hostChoiceKey(workspaceId: string) {
  return `${HOST_CHOICE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`;
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Remembered per workspace; an unknown or stale host id is discarded, never guessed. */
export function loadAgentConnectionHostChoice(
  workspaceId: string,
  storage: Storage | null = browserStorage(),
): TokenlessHostId | null {
  if (!workspaceId || !storage) return null;
  try {
    const stored = storage.getItem(hostChoiceKey(workspaceId));
    if (!stored) return null;
    if (!tokenlessHostCapability(stored)) {
      storage.removeItem(hostChoiceKey(workspaceId));
      return null;
    }
    return stored as TokenlessHostId;
  } catch {
    return null;
  }
}

export function saveAgentConnectionHostChoice(
  workspaceId: string,
  hostId: TokenlessHostId | null,
  storage: Storage | null = browserStorage(),
) {
  if (!workspaceId || !storage) return;
  try {
    if (hostId && tokenlessHostCapability(hostId)) storage.setItem(hostChoiceKey(workspaceId), hostId);
    else storage.removeItem(hostChoiceKey(workspaceId));
  } catch {
    // The remembered chip is a convenience; storage failures must never block sharing.
  }
}

/** One honest line per tier. Release-tested renders only once a pinned smoke run grants it. */
export function tokenlessSupportTierMeaning(tier: TokenlessHostSupportTier) {
  switch (tier) {
    case "release-tested":
      return "Install, OAuth, and tool smoke tests pass at a pinned client version.";
    case "supported":
      return "Bundled plugin path with tested install and connection contracts.";
    case "experimental":
      return "Protocol-compatible, not yet release-tested.";
    case "unsupported":
      return "Cannot complete the protected workspace connection.";
  }
}

const TIER_BADGE_VARIANT: Record<TokenlessHostSupportTier, BadgeVariant> = {
  "release-tested": "success",
  supported: "success",
  experimental: "warning",
  unsupported: "danger",
};

function InstallAffordanceRow({
  affordance,
  copied,
  onCopy,
}: {
  affordance: TokenlessInstallAffordance;
  copied: boolean;
  onCopy: (value: string) => void;
}) {
  const t = useAgentTranslations("hostPicker");
  const locale = useAgentLocale();
  // Install deep links are never published until verified at a pinned client version.
  if (affordance.kind === "deep-link") return null;
  if (affordance.kind === "settings-instructions") {
    return (
      <p className="text-xs leading-5 text-base-content/60">
        {localizeTokenlessHostCapabilityCopy(affordance.value, locale)}
      </p>
    );
  }
  if (affordance.kind === "plugin-marketplace") {
    return (
      <p className="text-xs leading-5 text-base-content/60">
        {localizeTokenlessHostCapabilityCopy(affordance.label, locale)}:{" "}
        <code className="font-mono">{affordance.value}</code>
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs text-base-content/55">{localizeTokenlessHostCapabilityCopy(affordance.label, locale)}</p>
      <div className="mt-1 flex items-start gap-2">
        <pre className="grow overflow-x-auto rounded-lg bg-base-content/[0.055] p-3 font-mono text-xs leading-5">
          <code>{affordance.value}</code>
        </pre>
        <Button
          variant="secondary"
          size="none"
          className="btn-sm shrink-0"
          type="button"
          onClick={() => onCopy(affordance.value)}
        >
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}

function HostDetail({
  copiedValue,
  host,
  onCopyAffordance,
}: {
  copiedValue: string | null;
  host: TokenlessHostCapability;
  onCopyAffordance: (value: string) => void;
}) {
  const t = useAgentTranslations("hostPicker");
  const locale = useAgentLocale();
  const tierLabel = {
    "release-tested": t("releaseTested"),
    supported: t("supported"),
    experimental: t("experimental"),
    unsupported: t("unsupported"),
  }[host.supportTier];
  const tierMeaning = {
    "release-tested": t("releaseTestedMeaning"),
    supported: t("supportedMeaning"),
    experimental: t("experimentalMeaning"),
    unsupported: t("unsupportedMeaning"),
  }[host.supportTier];
  return (
    <div className="mt-4 space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-base-content/55">
        <Badge variant={TIER_BADGE_VARIANT[host.supportTier]}>{tierLabel}</Badge>
        {tierMeaning}
      </p>
      <ol aria-label={t("prompts")} className="flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5 text-base-content/60">
        {host.humanActions.map((action, index) => (
          <li key={action}>
            {index + 1}. {localizeTokenlessHostCapabilityCopy(action, locale)}
            {index < host.humanActions.length - 1 ? " ·" : ""}
          </li>
        ))}
      </ol>
      {host.installAffordances.map(affordance => (
        <InstallAffordanceRow
          key={`${affordance.kind}:${affordance.label}`}
          affordance={affordance}
          copied={copiedValue === affordance.value}
          onCopy={onCopyAffordance}
        />
      ))}
    </div>
  );
}

/**
 * Optional progressive disclosure below the universal copy action. Selecting a
 * chip tunes the copied message and sets expectations for that host's legitimate
 * prompts; deselecting returns to the universal message. Skipping it always works.
 */
export function AgentConnectionHostPicker({
  onSelectHost,
  selectedHostId,
}: {
  onSelectHost: (hostId: TokenlessHostId | null) => void;
  selectedHostId: TokenlessHostId | null;
}) {
  const t = useAgentTranslations("hostPicker");
  const [expanded, setExpanded] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const selectedHost = selectedHostId ? tokenlessHostCapability(selectedHostId) : undefined;

  useEffect(() => {
    if (selectedHostId) setExpanded(true);
  }, [selectedHostId]);

  async function copyAffordance(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
    } catch {
      setCopiedValue(null);
    }
  }

  return (
    <details
      className="mt-5 border-t border-base-content/10 pt-4"
      open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium text-base-content/65">{t("specificTool")}</summary>
      <div role="group" aria-label={t("hostGroup")} className="mt-3 flex flex-wrap gap-2">
        {TOKENLESS_HOST_CAPABILITIES.map(host => {
          const selected = host.id === selectedHostId;
          return (
            <button
              key={host.id}
              type="button"
              aria-pressed={selected}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${selected ? "pill-active" : "pill-inactive"}`}
              onClick={() => onSelectHost(selected ? null : host.id)}
            >
              {host.displayName}
            </button>
          );
        })}
      </div>
      {selectedHost ? (
        <HostDetail copiedValue={copiedValue} host={selectedHost} onCopyAffordance={copyAffordance} />
      ) : null}
    </details>
  );
}
