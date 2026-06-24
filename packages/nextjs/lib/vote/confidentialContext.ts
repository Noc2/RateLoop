"use client";

import type { ContentItem } from "~~/hooks/contentFeed/shared";

export const CONFIDENTIALITY_ACCEPTED_EVENT = "rateloop:confidentiality-accepted";
export const CONFIDENTIALITY_OWNER_SESSION_CONFIRMED_EVENT = "rateloop:confidentiality-owner-session-confirmed";
export const CONFIDENTIALITY_READ_SESSION_CONFIRMED_EVENT = "rateloop:confidentiality-read-session-confirmed";

export type ConfidentialityBondAsset = "LREP" | "USDC";

export interface ConfidentialityBondRequirement {
  amount: bigint;
  asset: ConfidentialityBondAsset;
  isRequired: boolean;
  label: string;
}

type ConfidentialityMetadata = Pick<ContentItem, "confidentiality" | "contextAccess" | "contextVisibility">;

function normalizeBondAsset(value: unknown): ConfidentialityBondAsset {
  return typeof value === "string" && value.trim().toUpperCase() === "USDC" ? "USDC" : "LREP";
}

function normalizeBondAmount(value: unknown): bigint {
  if (typeof value === "bigint") return value > 0n ? value : 0n;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? BigInt(Math.floor(value)) : 0n;
  if (typeof value !== "string") return 0n;

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return 0n;

  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

export function isPrivateContextMetadata(metadata: ConfidentialityMetadata | null | undefined) {
  return (
    metadata?.contextAccess === "gated" ||
    metadata?.contextVisibility === "gated" ||
    metadata?.confidentiality?.visibility === "gated"
  );
}

export function getConfidentialityBondRequirement(
  confidentiality: ContentItem["confidentiality"] | null | undefined,
): ConfidentialityBondRequirement {
  const amount = normalizeBondAmount(confidentiality?.bondAmount);
  const asset = normalizeBondAsset(confidentiality?.bondAsset);

  return {
    amount,
    asset,
    isRequired: amount > 0n,
    label: amount > 0n ? `${formatAtomicTokenAmount6(amount)} ${asset}` : `No ${asset} bond`,
  };
}

export function formatAtomicTokenAmount6(value: bigint | string | number) {
  const amount = normalizeBondAmount(value);
  const whole = amount / 1_000_000n;
  const fractional = amount % 1_000_000n;
  const wholeLabel = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionalLabel = fractional.toString().padStart(6, "0").replace(/0+$/u, "");
  return fractionalLabel ? `${wholeLabel}.${fractionalLabel}` : wholeLabel;
}

export function getConfidentialContextVoteBlocker(params: {
  bondRequirement: ConfidentialityBondRequirement;
  escrowConfigured?: boolean;
  hasActiveBond?: boolean;
  hasActiveHumanCredential?: boolean;
  hasAcceptedTerms?: boolean;
  hasReadSession?: boolean;
  identityResolved?: boolean;
  isBondChecking?: boolean;
  isGated: boolean;
  isSessionChecking?: boolean;
  isTermsChecking?: boolean;
}) {
  if (!params.isGated) return null;

  if (params.isTermsChecking || params.isSessionChecking) {
    return "Checking confidentiality terms acceptance.";
  }

  if (!params.hasAcceptedTerms) {
    return "Accept the confidentiality terms and unlock the private context before voting.";
  }

  if (params.hasReadSession === false) {
    return "Confirm this wallet to unlock private context access before voting.";
  }

  if (!params.identityResolved) {
    return "Checking private-context eligibility.";
  }

  if (!params.hasActiveHumanCredential) {
    return "Private-context questions require an active human credential before voting.";
  }

  if (!params.bondRequirement.isRequired) return null;

  if (!params.escrowConfigured) {
    return `Post the required ${params.bondRequirement.label} confidentiality bond before voting. Bond posting is not configured for this deployment yet.`;
  }

  if (params.isBondChecking) {
    return "Checking confidentiality bond status.";
  }

  if (!params.hasActiveBond) {
    return `Post the required ${params.bondRequirement.label} confidentiality bond before voting.`;
  }

  return null;
}
