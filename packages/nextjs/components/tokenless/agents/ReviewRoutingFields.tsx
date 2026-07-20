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
  ["ask_automatically", "Send automatically"],
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
  if (authority === "prepare_for_approval") {
    return "Create a draft request, then wait for a workspace owner to approve and send it.";
  }
  if (authority === "ask_automatically") {
    return requiresFundingPermission
      ? "Create and send requests within the saved limits. Owner-approved publishing and funding permission are required."
      : "Create and send requests within the saved limits. An owner-approved publishing grant is required; funding permission is not.";
  }
  return "Report that review is required without creating or sending a request.";
}

export function reviewRoutingStateForMode(
  mode: ReviewRoutingMode,
  authority: ReviewRoutingAuthority,
): { mode: ReviewRoutingMode; authority: ReviewRoutingAuthority } {
  return { mode, authority: mode === "manual" ? "check_only" : authority };
}

type ReviewFrequencyFieldsProps = {
  mode: ReviewRoutingMode;
  adaptiveAvailable?: boolean;
  className?: string;
  onModeChange: (mode: ReviewRoutingMode) => void;
};

export function ReviewFrequencyFields({
  mode,
  adaptiveAvailable = true,
  className,
  onModeChange,
}: ReviewFrequencyFieldsProps) {
  const id = useId();
  const frequencyLabelId = `${id}-frequency-label`;
  const frequencyDescriptionId = `${id}-frequency-description`;

  return (
    <div className={className}>
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
  );
}

type ReviewAuthorityFieldsProps = {
  authority: ReviewRoutingAuthority;
  automaticAvailable: boolean;
  automaticUnavailableReason: string;
  requiresFundingPermission: boolean;
  className?: string;
  prominent?: boolean;
  onAuthorityChange: (authority: ReviewRoutingAuthority) => void;
};

export function ReviewAuthorityFields({
  authority,
  automaticAvailable,
  automaticUnavailableReason,
  requiresFundingPermission,
  className,
  prominent = false,
  onAuthorityChange,
}: ReviewAuthorityFieldsProps) {
  const id = useId();
  const authorityUnavailableId = `${id}-authority-automatic-unavailable`;

  return (
    <fieldset className={className} aria-describedby={automaticAvailable ? undefined : authorityUnavailableId}>
      <legend className={prominent ? "px-1 text-xl font-semibold" : "text-sm font-medium"}>
        If review is required, what may the agent do?
      </legend>
      <div className="mt-1 flex items-center gap-2 text-sm text-base-content/65">
        <span>Choose the furthest step the agent may take.</span>
        <InfoPopover label="About agent authority after review is required">
          Applies only after review is required. It controls whether the agent checks, prepares, or sends a request.
        </InfoPopover>
      </div>
      <div className="mt-3 grid gap-2">
        {REVIEW_AUTHORITIES.map(([value, label]) => {
          const inputId = `${id}-authority-${value}`;
          const descriptionId = `${id}-authority-${value}-description`;
          const automaticUnavailable = value === "ask_automatically" && !automaticAvailable;
          const describedBy = automaticUnavailable ? `${descriptionId} ${authorityUnavailableId}` : descriptionId;

          return (
            <div
              key={value}
              className={`flex gap-3 rounded-box border px-3 py-3 ${
                authority === value ? "border-primary/40 bg-primary/10" : "border-white/10 bg-[var(--rateloop-field)]"
              } ${automaticUnavailable ? "cursor-not-allowed opacity-65" : "cursor-pointer"}`}
            >
              <input
                id={inputId}
                className="radio radio-primary radio-sm mt-0.5 shrink-0"
                type="radio"
                name={`${id}-authority`}
                value={value}
                checked={authority === value}
                disabled={automaticUnavailable}
                aria-describedby={describedBy}
                onChange={() => onAuthorityChange(value)}
              />
              <span className="min-w-0">
                <label className={automaticUnavailable ? "cursor-not-allowed" : "cursor-pointer"} htmlFor={inputId}>
                  <span className="block text-sm font-medium text-base-content">{label}</span>
                </label>
                <span id={descriptionId} className="mt-1 block text-sm leading-5 text-base-content/65">
                  {reviewRoutingAuthorityDescription(value, requiresFundingPermission)}
                </span>
                {automaticUnavailable ? (
                  <span id={authorityUnavailableId} className="mt-1 block text-sm leading-5 text-warning/90">
                    {automaticUnavailableReason}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
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
  return (
    <fieldset className={`surface-card-nested p-4 sm:p-5 ${className ?? ""}`}>
      <legend className="px-1 text-xl font-semibold">Review routing</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        <ReviewFrequencyFields
          mode={mode}
          adaptiveAvailable={adaptiveAvailable}
          className={mode === "manual" ? "sm:col-span-2" : undefined}
          onModeChange={onModeChange}
        />
        {mode !== "manual" ? (
          <ReviewAuthorityFields
            authority={authority}
            automaticAvailable={automaticAvailable}
            automaticUnavailableReason={automaticUnavailableReason}
            requiresFundingPermission={requiresFundingPermission}
            onAuthorityChange={onAuthorityChange}
          />
        ) : null}
      </div>
    </fieldset>
  );
}
