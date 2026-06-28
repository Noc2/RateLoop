import {
  X402QuestionInputError,
  type X402QuestionOperation,
  type X402QuestionParserOptions,
  type X402QuestionPayload,
  X402_CONFIDENTIALITY_BOND_UINT64_MAX,
  X402_SUBMISSION_REWARD_ASSET_LREP,
  X402_SUBMISSION_REWARD_ASSET_USDC,
  X402_USDC_BY_CHAIN_ID,
  X402_USDC_DECIMALS,
  assertSupportedX402BundleBounty,
  buildX402QuestionOperation as buildSharedX402QuestionOperation,
  parseX402QuestionRequest as parseSharedX402QuestionRequest,
} from "@rateloop/agents/x402-question-payload";
import { getOptionalAppUrl, getOptionalPonderUrl, getTrustedRateLoopAppUrl } from "~~/lib/env/server";
import { isLocalE2EProductionBuildEnabled } from "~~/utils/env/e2eProduction";

export {
  X402_CONFIDENTIALITY_BOND_UINT64_MAX,
  X402_SUBMISSION_REWARD_ASSET_LREP,
  X402_SUBMISSION_REWARD_ASSET_USDC,
  X402_USDC_DECIMALS,
  X402_USDC_BY_CHAIN_ID,
  X402QuestionInputError,
  assertSupportedX402BundleBounty,
};

export type { X402QuestionOperation, X402QuestionPayload };

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function serverX402QuestionParserOptions(): X402QuestionParserOptions {
  const configuredAppOrigin = normalizeOrigin(getTrustedRateLoopAppUrl());
  return {
    allowedRateLoopAttachmentOrigins: ["https://rateloop.ai", "https://www.rateloop.ai", configuredAppOrigin].filter(
      (origin): origin is string => Boolean(origin),
    ),
    allowLocalhostAttachmentOrigins: process.env.NODE_ENV !== "production" || isLocalE2EProductionBuildEnabled(),
    questionMetadataBaseUrl: getOptionalPonderUrl() ?? getOptionalAppUrl(),
  };
}

export function parseX402QuestionRequest(value: unknown, fallbackChainId?: number): X402QuestionPayload {
  return parseSharedX402QuestionRequest(value, fallbackChainId, serverX402QuestionParserOptions());
}

export function buildX402QuestionOperation(payload: X402QuestionPayload): X402QuestionOperation {
  return buildSharedX402QuestionOperation(payload, serverX402QuestionParserOptions());
}
