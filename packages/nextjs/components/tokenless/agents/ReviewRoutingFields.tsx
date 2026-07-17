"use client";

import { useId } from "react";
import { InfoPopover } from "~~/components/tokenless/InfoPopover";

export type ReviewRoutingMode = "adaptive" | "always" | "manual" | "rules" | "fixed";
export type ReviewRoutingAuthority = "check_only" | "prepare_for_approval" | "ask_automatically";

const REVIEW_MODES = [
  ["adaptive", "Adaptive — Recommended"],
  ["always", "Every output"],
  ["fixed", "Fixed percentage"],
  ["rules", "Rules and conditions"],
  ["manual", "Manual handoff only"],
] as const;

const REVIEW_AUTHORITIES = [
  ["check_only", "Check only"],
  ["prepare_for_approval", "Prepare for approval"],
  ["ask_automatically", "Ask automatically"],
] as const;

export function reviewRoutingModeDescription(mode: ReviewRoutingMode) {
  if (mode === "always") return "Reviews every eligible output.";
  if (mode === "fixed") return "Reviews a fixed share of eligible outputs.";
  if (mode === "rules") return "Reviews outputs that match risk or confidence conditions.";
  if (mode === "manual") return "Never requires review automatically. You start each handoff.";
  return "Learns from results and reduces review coverage safely.";
}

export function reviewRoutingAuthorityDescription(
  authority: ReviewRoutingAuthority,
  requiresFundingPermission: boolean,
) {
  if (authority === "prepare_for_approval") return "Prepare a request, then wait for owner approval.";
  if (authority === "ask_automatically") {
    return requiresFundingPermission
      ? "Send requests within the saved limits. Requires owner-approved publishing and funding permission."
      : "Send requests within the saved limits. Requires a separate owner-approved publishing grant. No funding permission is needed.";
  }
  return "Report whether review is required. Do not prepare or send a request.";
}

export function reviewRoutingStateForMode(
  mode: ReviewRoutingMode,
  authority: ReviewRoutingAuthority,
): { mode: ReviewRoutingMode; authority: ReviewRoutingAuthority } {
  return { mode, authority: mode === "manual" ? "check_only" : authority };
}

export function ReviewRoutingFields({
  mode,
  authority,
  automaticAvailable,
  automaticUnavailableReason,
  requiresFundingPermission,
  adaptiveAvailable = true,
  className,
  onModeChange,
  onAuthorityChange,
}: {
  mode: ReviewRoutingMode;
  authority: ReviewRoutingAuthority;
  automaticAvailable: boolean;
  automaticUnavailableReason: string;
  requiresFundingPermission: boolean;
  adaptiveAvailable?: boolean;
  className?: string;
  onModeChange: (mode: ReviewRoutingMode) => void;
  onAuthorityChange: (authority: ReviewRoutingAuthority) => void;
}) {
  const id = useId();
  const frequencyLabelId = `${id}-frequency-label`;
  const frequencyDescriptionId = `${id}-frequency-description`;
  const authorityLabelId = `${id}-authority-label`;
  const authorityDescriptionId = `${id}-authority-description`;

  return (
    <fieldset className={`surface-card-nested p-4 sm:p-5 ${className ?? ""}`}>
      <legend className="px-1 text-xl font-semibold">Review routing</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className={mode === "manual" ? "sm:col-span-2" : undefined}>
          <div className="flex min-h-9 items-center gap-2 text-sm font-medium">
            <span id={frequencyLabelId}>When should RateLoop require human review?</span>
            <InfoPopover label="About when human review is required">
              Decides when an eligible output requires human review. It does not authorize sending or funding a request.
            </InfoPopover>
          </div>
          <select
            className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            value={mode}
            aria-labelledby={frequencyLabelId}
            aria-describedby={frequencyDescriptionId}
            onChange={event => onModeChange(event.target.value as ReviewRoutingMode)}
          >
            {REVIEW_MODES.map(([value, label]) => (
              <option key={value} value={value} disabled={value === "adaptive" && !adaptiveAvailable}>
                {label}
              </option>
            ))}
          </select>
          <p id={frequencyDescriptionId} className="mt-2 text-sm leading-6 text-base-content/65">
            {reviewRoutingModeDescription(mode)}
          </p>
        </div>
        {mode !== "manual" ? (
          <div>
            <div className="flex min-h-9 items-center gap-2 text-sm font-medium">
              <span id={authorityLabelId}>If review is required, what may the agent do?</span>
              <InfoPopover label="About agent authority after review is required">
                Applies only after review is required. It controls whether the agent checks, prepares, or sends a
                request.
              </InfoPopover>
            </div>
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={authority}
              aria-labelledby={authorityLabelId}
              aria-describedby={authorityDescriptionId}
              onChange={event => onAuthorityChange(event.target.value as ReviewRoutingAuthority)}
            >
              {REVIEW_AUTHORITIES.map(([value, label]) => (
                <option key={value} value={value} disabled={value === "ask_automatically" && !automaticAvailable}>
                  {label}
                </option>
              ))}
            </select>
            <p id={authorityDescriptionId} className="mt-2 text-sm leading-6 text-base-content/65">
              {reviewRoutingAuthorityDescription(authority, requiresFundingPermission)}
            </p>
            {!automaticAvailable ? (
              <p className="mt-2 text-sm leading-6 text-base-content/55">
                Ask automatically is unavailable. {automaticUnavailableReason}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
