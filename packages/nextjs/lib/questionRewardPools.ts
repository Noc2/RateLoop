"use client";

import { ContentRegistryAbi, FeedbackBonusEscrowAbi, QuestionRewardPoolEscrowAbi } from "@rateloop/contracts/abis";
import { MIN_NONZERO_CONFIDENTIALITY_BOND, WORLD_CHAIN_USDC_BY_CHAIN_ID } from "@rateloop/contracts/protocol";
import { isAddress, parseUnits } from "viem";
import { contracts } from "~~/utils/scaffold-eth/contract";

const SUBMISSION_REWARD_DECIMALS = 6;
export const MIN_REWARD_POOL_REQUIRED_VOTERS = 3;
export const MIN_REWARD_POOL_SETTLED_ROUNDS = 1;
export const MAX_REWARD_POOL_SETTLED_ROUNDS = 16;
export const DEFAULT_REWARD_POOL_FRONTEND_FEE_BPS = 300;
export const DEFAULT_SUBMISSION_REWARD_POOL = 1_000_000n;
export const SUBMISSION_REWARD_ASSET_LREP = 0;
export const SUBMISSION_REWARD_ASSET_USDC = 1;
export const FEEDBACK_BONUS_ASSET_LREP = SUBMISSION_REWARD_ASSET_LREP;
export const FEEDBACK_BONUS_ASSET_USDC = SUBMISSION_REWARD_ASSET_USDC;
export type SubmissionRewardAsset = "lrep" | "usdc";
export type FeedbackBonusAsset = SubmissionRewardAsset;

export const QUESTION_SUBMISSION_ABI = ContentRegistryAbi;
export const QUESTION_REWARD_POOL_ESCROW_ABI = QuestionRewardPoolEscrowAbi;
export const FEEDBACK_BONUS_ESCROW_ABI = FeedbackBonusEscrowAbi;
export const ERC20_APPROVAL_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const LOCAL_MOCK_USDC_CONTRACT_NAME = "MockERC20";

function normalizeAddress(value: string | undefined): `0x${string}` | undefined {
  const trimmed = value?.trim();
  return trimmed && isAddress(trimmed) ? (trimmed as `0x${string}`) : undefined;
}

function getPublicUsdcAddressOverride(): `0x${string}` | undefined {
  return normalizeAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS);
}

function getPublicX402UsdcAddressOverride(): `0x${string}` | undefined {
  return normalizeAddress(process.env.NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS);
}

function getDeployedContractAddress(chainId: number, contractName: string): `0x${string}` | undefined {
  const deployedAddress = (contracts?.[chainId]?.[contractName] as { address?: string } | undefined)?.address;
  return normalizeAddress(deployedAddress);
}

export function getConfiguredContentRegistryAddress(chainId: number): `0x${string}` | undefined {
  return getDeployedContractAddress(chainId, "ContentRegistry");
}

export function getConfiguredRoundVotingEngineAddress(chainId: number): `0x${string}` | undefined {
  return getDeployedContractAddress(chainId, "RoundVotingEngine");
}

export function getConfiguredQuestionRewardPoolEscrowAddress(chainId: number): `0x${string}` | undefined {
  const envAddress = normalizeAddress(process.env.NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS);
  const deployedAddress = getDeployedContractAddress(chainId, "QuestionRewardPoolEscrow");

  if (envAddress) {
    if (process.env.NODE_ENV === "production") {
      if (!deployedAddress) {
        throw new Error(
          "NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS requires a shared QuestionRewardPoolEscrow deployment in production.",
        );
      }
      if (envAddress.toLowerCase() !== deployedAddress.toLowerCase()) {
        throw new Error(
          "NEXT_PUBLIC_QUESTION_REWARD_POOL_ESCROW_ADDRESS must match the shared QuestionRewardPoolEscrow deployment in production.",
        );
      }
    }
    return envAddress;
  }

  return deployedAddress;
}

export function getConfiguredX402QuestionSubmitterAddress(chainId: number): `0x${string}` | undefined {
  return getDeployedContractAddress(chainId, "X402QuestionSubmitter");
}

export function getConfiguredFeedbackBonusEscrowAddress(chainId: number): `0x${string}` | undefined {
  return getDeployedContractAddress(chainId, "FeedbackBonusEscrow");
}

export function getConfiguredFeedbackRegistryAddress(chainId: number): `0x${string}` | undefined {
  return getDeployedContractAddress(chainId, "FeedbackRegistry");
}

function assertMatchingPublicUsdcOverrides(): void {
  const usdc = getPublicUsdcAddressOverride();
  const x402 = getPublicX402UsdcAddressOverride();
  if (usdc && x402 && usdc.toLowerCase() !== x402.toLowerCase()) {
    throw new Error(
      "NEXT_PUBLIC_USDC_ADDRESS and NEXT_PUBLIC_RATELOOP_X402_USDC_ADDRESS must match when both are set.",
    );
  }
}

export function getDefaultUsdcAddress(chainId: number): `0x${string}` | undefined {
  assertMatchingPublicUsdcOverrides();
  return (
    getPublicUsdcAddressOverride() ??
    getPublicX402UsdcAddressOverride() ??
    getDeployedContractAddress(chainId, LOCAL_MOCK_USDC_CONTRACT_NAME) ??
    WORLD_CHAIN_USDC_BY_CHAIN_ID[chainId]
  );
}

export function getDefaultLrepAddress(chainId: number): `0x${string}` | undefined {
  return getDeployedContractAddress(chainId, "LoopReputation");
}

export function getDefaultUsdcDisplayName(chainId: number): string {
  if (!getPublicUsdcAddressOverride() && getDeployedContractAddress(chainId, LOCAL_MOCK_USDC_CONTRACT_NAME)) {
    return "Mock USDC";
  }

  return "World Chain USDC";
}

export function parseUsdRewardPoolAmount(value: string): bigint | null {
  return parseTokenAmount6(value);
}

export function parseSubmissionRewardAmount(value: string): bigint | null {
  return parseTokenAmount6(value);
}

export function parseFeedbackBonusAmount(value: string): bigint | null {
  return parseTokenAmount6(value);
}

export function parseConfidentialityBondAmount(value: string): bigint | null {
  const parsed = parseTokenAmount6(value, { allowZero: true });
  if (parsed === null) return null;
  if (parsed > 0n && parsed < MIN_NONZERO_CONFIDENTIALITY_BOND) return null;
  return parsed;
}

function parseTokenAmount6(value: string, options: { allowZero?: boolean } = {}): bigint | null {
  const trimmed = value.trim();
  const hasCommas = trimmed.includes(",");
  const normalized = hasCommas ? trimmed.replace(/,/g, "") : trimmed;
  const validGroupedAmount = /^\d{1,3}(?:,\d{3})+(?:\.\d{0,6})?$/.test(trimmed);
  const validPlainAmount = /^\d+(?:\.\d{0,6})?$/.test(trimmed);
  if (hasCommas ? !validGroupedAmount : !validPlainAmount) return null;
  try {
    const parsed = parseUnits(normalized, SUBMISSION_REWARD_DECIMALS);
    if (options.allowZero && parsed === 0n) return parsed;
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function formatTokenAmount6(value: bigint | number | string | undefined | null): string {
  const raw = typeof value === "bigint" ? value : BigInt(value ?? 0);
  const whole = raw / 1_000_000n;
  const fractional = raw % 1_000_000n;
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionalText = fractional.toString().padStart(6, "0").replace(/0+$/, "");
  return fractionalText ? `${groupedWhole}.${fractionalText}` : groupedWhole;
}

export function formatSubmissionRewardAmount(
  value: bigint | number | string | undefined | null,
  asset: SubmissionRewardAsset,
): string {
  return `${formatTokenAmount6(value)} ${asset === "lrep" ? "LREP" : "USDC"}`;
}

export function formatFeedbackBonusAmount(
  value: bigint | number | string | undefined | null,
  asset: FeedbackBonusAsset,
): string {
  return formatSubmissionRewardAmount(value, asset);
}

export function formatUsdAmount(value: bigint | number | string | undefined | null): string {
  const raw = typeof value === "bigint" ? value : BigInt(value ?? 0);
  // L-9 (2026-05-22 audit) follow-up: round to nearest cent and carry into the
  // whole-dollar portion when the rounded cent value rolls past 99 — otherwise
  // 1_999_999 micro-USD would render as "$1.100". Round once in total cents,
  // then split.
  const rawCents = (raw + 5_000n) / 10_000n;
  const wholeCents = rawCents / 100n;
  const cents = rawCents % 100n;
  const groupedWhole = wholeCents.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractional = raw % 1_000_000n;
  return fractional > 0n ? `$${groupedWhole}.${cents.toString().padStart(2, "0")}` : `$${groupedWhole}`;
}
