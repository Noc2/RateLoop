"use client";

import { ContentRegistryAbi, QuestionRewardPoolEscrowAbi } from "@rateloop/contracts/abis";
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

export type SubmissionRewardAsset = "lrep" | "usdc";

export const QUESTION_SUBMISSION_ABI = ContentRegistryAbi;
export const QUESTION_REWARD_POOL_ESCROW_ABI = QuestionRewardPoolEscrowAbi;
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

const WORLD_CHAIN_USDC_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  480: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  4801: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
};

const LOCAL_MOCK_USDC_CONTRACT_NAME = "MockERC20";

function normalizeAddress(value: string | undefined): `0x${string}` | undefined {
  const trimmed = value?.trim();
  return trimmed && isAddress(trimmed) ? (trimmed as `0x${string}`) : undefined;
}

function getPublicUsdcAddressOverride(): `0x${string}` | undefined {
  return normalizeAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS);
}

function getDeployedContractAddress(chainId: number, contractName: string): `0x${string}` | undefined {
  const deployedAddress = (contracts?.[chainId]?.[contractName] as { address?: string } | undefined)?.address;
  return normalizeAddress(deployedAddress);
}

export function getConfiguredContentRegistryAddress(chainId: number): `0x${string}` | undefined {
  return getDeployedContractAddress(chainId, "ContentRegistry");
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

export function getDefaultUsdcAddress(chainId: number): `0x${string}` | undefined {
  return (
    getPublicUsdcAddressOverride() ??
    getDeployedContractAddress(chainId, LOCAL_MOCK_USDC_CONTRACT_NAME) ??
    WORLD_CHAIN_USDC_BY_CHAIN_ID[chainId]
  );
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

function parseTokenAmount6(value: string): bigint | null {
  const trimmed = value.trim();
  const hasCommas = trimmed.includes(",");
  const normalized = hasCommas ? trimmed.replace(/,/g, "") : trimmed;
  const validGroupedAmount = /^\d{1,3}(?:,\d{3})+(?:\.\d{0,6})?$/.test(trimmed);
  const validPlainAmount = /^\d+(?:\.\d{0,6})?$/.test(trimmed);
  if (hasCommas ? !validGroupedAmount : !validPlainAmount) return null;
  try {
    const parsed = parseUnits(normalized, SUBMISSION_REWARD_DECIMALS);
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

export function formatUsdAmount(value: bigint | number | string | undefined | null): string {
  const raw = typeof value === "bigint" ? value : BigInt(value ?? 0);
  const whole = raw / 1_000_000n;
  const fractional = raw % 1_000_000n;
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Round to nearest cent so 0.005 USD -> "$0.01" rather than "$0.00".
  const cents = ((fractional + 5_000n) / 10_000n).toString().padStart(2, "0");
  return fractional > 0n ? `$${groupedWhole}.${cents}` : `$${groupedWhole}`;
}
